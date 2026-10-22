package com.sweepr.app

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.security.KeyStore
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlin.math.roundToInt

enum class ThemeMode(val labelRes: Int) { System(R.string.option_system_default), Light(R.string.theme_light), Dark(R.string.theme_dark) }

enum class ReminderFrequency(val labelRes: Int, val days: Long) {
    Off(R.string.reminder_off, 0),
    Weekly(R.string.reminder_weekly, 7),
    Monthly(R.string.reminder_monthly, 30),
}

typealias LinkedAccount = Prefs.LinkedAccount

/** Small persisted user preferences (theme, reminders, and optional cross-platform account link), observable from Compose. */
object Prefs {
    data class LinkedAccount(
        val accountId: String = "",
        val email: String = "",
        val refreshToken: String = "",
        val deviceId: String = "",
        val serverActive: Boolean = false,
        val plan: String? = null,
        val expiresAt: Long = 0L,
        val addons: List<String> = emptyList(),
    ) {
        val isSignedIn: Boolean get() = accountId.isNotBlank() && refreshToken.isNotBlank()
    }

    private const val FILE = "sweepr_prefs"
    private const val SECURE_AUTH_FILE = "sweepr_secure_auth"
    private const val KEYSTORE_PROVIDER = "AndroidKeyStore"
    private const val MASTER_KEY_ALIAS = "sweepr_token_master_key"
    private const val AES_GCM_TRANSFORMATION = "AES/GCM/NoPadding"

    private const val KEY_THEME = "theme"
    private const val KEY_REMINDER = "reminder"
    private const val KEY_ACCOUNT_ID = "account_id"
    private const val KEY_ACCOUNT_EMAIL = "account_email"
    private const val KEY_LEGACY_REFRESH_TOKEN = "refresh_token"
    private const val KEY_LEGACY_LINKED_REFRESH_TOKEN = "linked_refresh_token"
    private const val KEY_ENCRYPTED_REFRESH_TOKEN = "encrypted_refresh_token"
    private const val KEY_DEVICE_ID = "device_id"
    private const val KEY_SERVER_ACTIVE = "server_active"
    private const val KEY_SERVER_PLAN = "server_plan"
    private const val KEY_SERVER_EXPIRES = "server_expires"
    private const val KEY_SERVER_ADDONS = "server_addons"
    private const val KEY_CLEANUP_COUNT = "cleanup_count"
    private const val KEY_REVIEW_SHOWN = "review_shown"

    private lateinit var prefs: SharedPreferences
    private lateinit var secureAuthStore: SharedPreferences
    private val inMemoryAuthPrefs: SharedPreferences by lazy { InMemorySharedPreferences() }

    private class InMemorySharedPreferences : SharedPreferences {
        private val map = java.util.concurrent.ConcurrentHashMap<String, Any>()

        override fun getAll(): MutableMap<String, *> = HashMap(map)
        override fun getString(key: String?, defValue: String?): String? = (map[key] as? String) ?: defValue
        @Suppress("UNCHECKED_CAST")
        override fun getStringSet(key: String?, defValues: MutableSet<String>?): MutableSet<String>? =
            (map[key] as? Set<String>)?.toMutableSet() ?: defValues
        override fun getInt(key: String?, defValue: Int): Int = (map[key] as? Int) ?: defValue
        override fun getLong(key: String?, defValue: Long): Long = (map[key] as? Long) ?: defValue
        override fun getFloat(key: String?, defValue: Float): Float = (map[key] as? Float) ?: defValue
        override fun getBoolean(key: String?, defValue: Boolean): Boolean = (map[key] as? Boolean) ?: defValue
        override fun contains(key: String?): Boolean = key != null && map.containsKey(key)
        override fun edit(): SharedPreferences.Editor = EditorImpl()
        override fun registerOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener?) {}
        override fun unregisterOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener?) {}

        private inner class EditorImpl : SharedPreferences.Editor {
            private val staged = HashMap<String, Any?>()
            private var clearAll = false

            override fun putString(key: String?, value: String?): SharedPreferences.Editor = apply { if (key != null) staged[key] = value }
            override fun putStringSet(key: String?, values: MutableSet<String>?): SharedPreferences.Editor = apply { if (key != null) staged[key] = values?.toSet() }
            override fun putInt(key: String?, value: Int): SharedPreferences.Editor = apply { if (key != null) staged[key] = value }
            override fun putLong(key: String?, value: Long): SharedPreferences.Editor = apply { if (key != null) staged[key] = value }
            override fun putFloat(key: String?, value: Float): SharedPreferences.Editor = apply { if (key != null) staged[key] = value }
            override fun putBoolean(key: String?, value: Boolean): SharedPreferences.Editor = apply { if (key != null) staged[key] = value }
            override fun remove(key: String?): SharedPreferences.Editor = apply { if (key != null) staged[key] = null }
            override fun clear(): SharedPreferences.Editor = apply { clearAll = true }
            override fun commit(): Boolean {
                apply()
                return true
            }
            override fun apply() {
                if (clearAll) map.clear()
                for ((k, v) in staged) {
                    if (v == null) map.remove(k) else map[k] = v
                }
            }
        }
    }

    internal fun secureAuthPrefs(context: Context): SharedPreferences {
        if (::secureAuthStore.isInitialized) return secureAuthStore
        secureAuthStore = runCatching {
            context.getSharedPreferences(SECURE_AUTH_FILE, Context.MODE_PRIVATE)
        }.recoverCatching {
            context.deleteSharedPreferences(SECURE_AUTH_FILE)
            context.getSharedPreferences(SECURE_AUTH_FILE, Context.MODE_PRIVATE)
        }.getOrElse {
            inMemoryAuthPrefs
        }
        return secureAuthStore
    }

    private val _theme = MutableStateFlow(ThemeMode.System)
    val theme: StateFlow<ThemeMode> = _theme.asStateFlow()

    private val _reminder = MutableStateFlow(ReminderFrequency.Monthly)
    val reminder: StateFlow<ReminderFrequency> = _reminder.asStateFlow()

    private val _account = MutableStateFlow(LinkedAccount())
    val account: StateFlow<LinkedAccount> = _account.asStateFlow()

    private fun getOrCreateMasterKey(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }
        val existing = keyStore.getEntry(MASTER_KEY_ALIAS, null) as? KeyStore.SecretKeyEntry
        if (existing != null) return existing.secretKey
        val keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE_PROVIDER)
        val spec = KeyGenParameterSpec.Builder(
            MASTER_KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .build()
        keyGenerator.init(spec)
        return keyGenerator.generateKey()
    }

    private fun encryptRefreshToken(plainText: String): String? = runCatching {
        if (plainText.isBlank()) return ""
        val cipher = Cipher.getInstance(AES_GCM_TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateMasterKey())
        val iv = cipher.iv
        val cipherBytes = cipher.doFinal(plainText.toByteArray(Charsets.UTF_8))
        val ivB64 = Base64.encodeToString(iv, Base64.NO_WRAP)
        val ctB64 = Base64.encodeToString(cipherBytes, Base64.NO_WRAP)
        "$ivB64:$ctB64"
    }.getOrNull()

    private fun decryptRefreshToken(encoded: String): String = runCatching {
        if (encoded.isBlank()) return ""
        val parts = encoded.split(":", limit = 2)
        if (parts.size != 2) return ""
        val iv = Base64.decode(parts[0], Base64.NO_WRAP)
        val cipherBytes = Base64.decode(parts[1], Base64.NO_WRAP)
        val cipher = Cipher.getInstance(AES_GCM_TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateMasterKey(), GCMParameterSpec(128, iv))
        String(cipher.doFinal(cipherBytes), Charsets.UTF_8)
    }.getOrDefault("")

    private fun storeRefreshTokenSecurely(token: String) {
        if (!::secureAuthStore.isInitialized) return
        if (token.isBlank()) {
            secureAuthStore.edit().remove(KEY_ENCRYPTED_REFRESH_TOKEN).apply()
        } else {
            val encrypted = encryptRefreshToken(token)
            if (!encrypted.isNullOrBlank()) {
                secureAuthStore.edit().putString(KEY_ENCRYPTED_REFRESH_TOKEN, encrypted).apply()
            }
        }
    }

    private fun readRefreshTokenSecurely(): String {
        if (!::secureAuthStore.isInitialized) return ""
        val stored = secureAuthStore.getString(KEY_ENCRYPTED_REFRESH_TOKEN, null).orEmpty()
        return decryptRefreshToken(stored)
    }

    fun init(context: Context) {
        prefs = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
        secureAuthStore = secureAuthPrefs(context)
        _theme.value = prefs.getString(KEY_THEME, null)
            ?.let { runCatching { ThemeMode.valueOf(it) }.getOrNull() } ?: ThemeMode.System
        // Monthly reminders are on by default, like the competition.
        _reminder.value = prefs.getString(KEY_REMINDER, null)
            ?.let { runCatching { ReminderFrequency.valueOf(it) }.getOrNull() } ?: ReminderFrequency.Monthly

        // Migrate and purge any legacy plaintext refresh token or entitlement keys from sweepr_prefs
        val legacyToken = prefs.getString(KEY_LEGACY_LINKED_REFRESH_TOKEN, null)
            ?.takeIf { it.isNotBlank() }
            ?: prefs.getString(KEY_LEGACY_REFRESH_TOKEN, null)?.takeIf { it.isNotBlank() }
        if (prefs.contains(KEY_LEGACY_LINKED_REFRESH_TOKEN)
            || prefs.contains(KEY_LEGACY_REFRESH_TOKEN)
            || prefs.contains(KEY_SERVER_ACTIVE)
            || prefs.contains(KEY_SERVER_PLAN)
            || prefs.contains(KEY_SERVER_EXPIRES)
            || prefs.contains(KEY_SERVER_ADDONS)
        ) {
            prefs.edit()
                .remove(KEY_LEGACY_LINKED_REFRESH_TOKEN)
                .remove(KEY_LEGACY_REFRESH_TOKEN)
                .remove(KEY_SERVER_ACTIVE)
                .remove(KEY_SERVER_PLAN)
                .remove(KEY_SERVER_EXPIRES)
                .remove(KEY_SERVER_ADDONS)
                .apply()
        }
        if (legacyToken != null && readRefreshTokenSecurely().isBlank()) {
            storeRefreshTokenSecurely(legacyToken)
        }

        val deviceId = prefs.getString(KEY_DEVICE_ID, null)?.takeIf { it.isNotBlank() }
            ?: java.util.UUID.randomUUID().toString().also {
                prefs.edit().putString(KEY_DEVICE_ID, it).apply()
            }
        val refreshToken = readRefreshTokenSecurely()
        val rawExpires = secureAuthStore.getLong(KEY_SERVER_EXPIRES, 0L)
        val expiresSec = if (rawExpires > 10_000_000_000L) rawExpires / 1000L else rawExpires
        val activeFromSecure = refreshToken.isNotBlank() && secureAuthStore.getBoolean(KEY_SERVER_ACTIVE, false)
        _account.value = LinkedAccount(
            accountId = prefs.getString(KEY_ACCOUNT_ID, "") ?: "",
            email = prefs.getString(KEY_ACCOUNT_EMAIL, "") ?: "",
            refreshToken = refreshToken,
            deviceId = deviceId,
            serverActive = activeFromSecure,
            plan = secureAuthStore.getString(KEY_SERVER_PLAN, null),
            expiresAt = if (expiresSec > 0L) expiresSec else 0L,
            addons = if (activeFromSecure) {
                secureAuthStore.getString(KEY_SERVER_ADDONS, "")
                    ?.split(",")
                    ?.map { it.trim() }
                    ?.filter { it.isNotEmpty() }
                    ?: emptyList()
            } else {
                emptyList()
            },
        )
    }

    fun setTheme(mode: ThemeMode) {
        _theme.value = mode
        prefs.edit().putString(KEY_THEME, mode.name).apply()
    }

    fun setReminder(context: Context, frequency: ReminderFrequency) {
        _reminder.value = frequency
        prefs.edit().putString(KEY_REMINDER, frequency.name).apply()
        Reminders.schedule(context, frequency, replace = true)
    }

    fun setLinkedAccount(account: LinkedAccount) {
        _account.value = account
        storeRefreshTokenSecurely(account.refreshToken)
        if (::secureAuthStore.isInitialized) {
            secureAuthStore.edit()
                .putBoolean(KEY_SERVER_ACTIVE, account.serverActive)
                .putString(KEY_SERVER_PLAN, account.plan)
                .putLong(KEY_SERVER_EXPIRES, account.expiresAt)
                .putString(KEY_SERVER_ADDONS, account.addons.joinToString(","))
                .apply()
        }
        prefs.edit()
            .putString(KEY_ACCOUNT_ID, account.accountId)
            .putString(KEY_ACCOUNT_EMAIL, account.email)
            .remove(KEY_LEGACY_LINKED_REFRESH_TOKEN)
            .remove(KEY_LEGACY_REFRESH_TOKEN)
            .remove(KEY_SERVER_ACTIVE)
            .remove(KEY_SERVER_PLAN)
            .remove(KEY_SERVER_EXPIRES)
            .remove(KEY_SERVER_ADDONS)
            .apply()
    }

    fun clearLinkedAccount() {
        val currentDevice = _account.value.deviceId
        val cleared = LinkedAccount(deviceId = currentDevice)
        setLinkedAccount(cleared)
    }

    /**
     * Increments the completed cleanup counter and returns true on the 2nd successful cleanup
     * (once per install) so the app can request a Google Play In-App Review.
     */
    fun recordCleanupForReviewPrompt(): Boolean {
        if (!::prefs.isInitialized) return false
        val nextCount = prefs.getInt(KEY_CLEANUP_COUNT, 0) + 1
        val alreadyShown = prefs.getBoolean(KEY_REVIEW_SHOWN, false)
        val shouldPrompt = nextCount >= 2 && !alreadyShown
        prefs.edit()
            .putInt(KEY_CLEANUP_COUNT, nextCount)
            .apply { if (shouldPrompt) putBoolean(KEY_REVIEW_SHOWN, true) }
            .apply()
        return shouldPrompt
    }
}

object SweeprAccountApi {
    const val PROJECT_ID = "cleaner"

    class ApiException(val statusCode: Int, message: String) : IllegalStateException(message)

    private fun postJson(
        path: String,
        body: org.json.JSONObject,
        method: String = "POST",
        bearerToken: String? = null,
    ): org.json.JSONObject {
        if (!body.has("project_id")) {
            body.put("project_id", PROJECT_ID)
        }
        val base = API_URL.trimEnd('/')
        val conn = (java.net.URL("$base$path").openConnection() as java.net.HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 10_000
            readTimeout = 10_000
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Accept", "application/json")
            setRequestProperty("X-Sweepr-Project", PROJECT_ID)
            if (!bearerToken.isNullOrBlank()) {
                setRequestProperty("Authorization", "Bearer $bearerToken")
            }
            doOutput = true
        }
        try {
            val payload = body.toString().toByteArray(Charsets.UTF_8)
            conn.outputStream.use { it.write(payload) }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else (conn.errorStream ?: conn.inputStream)
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            val json = runCatching { org.json.JSONObject(text) }.getOrDefault(org.json.JSONObject())
            if (code !in 200..299) {
                throw ApiException(code, json.optString("error").ifBlank { "Request failed ($code)" })
            }
            return json
        } finally {
            conn.disconnect()
        }
    }

    internal fun expandBundleAddons(raw: List<String>): List<String> {
        val result = raw.toMutableList()
        if (result.any { it.equals("sweepr_secure_bundle", ignoreCase = true) }) {
            if (result.none { it.equals("battery_care", ignoreCase = true) }) result.add("battery_care")
            if (result.none { it.equals("cloud_vault", ignoreCase = true) }) result.add("cloud_vault")
        }
        return result
    }

    private fun parseAddons(res: org.json.JSONObject, fallback: List<String> = emptyList()): List<String> {
        val arr = res.optJSONArray("addons") ?: return expandBundleAddons(fallback)
        val parsed = buildList {
            for (i in 0 until arr.length()) {
                val item = arr.optString(i).trim()
                if (item.isNotEmpty()) add(item)
            }
        }
        return expandBundleAddons(parsed)
    }

    // Standard X.509 SubjectPublicKeyInfo ASN.1 DER prefix for 32-byte Ed25519 public key (302a300506032b6570032100)
    private val ED25519_SPKI_PREFIX = byteArrayOf(
        0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00
    )

    internal fun verifyEd25519Signature(
        signingInput: ByteArray,
        signatureBytes: ByteArray,
        pubKeyB64Url: String = BuildConfig.SWEEPR_LICENSE_PUBKEY,
    ): Boolean {
        if (signatureBytes.size != 64) return false
        val rawPub = runCatching {
            java.util.Base64.getUrlDecoder().decode(pubKeyB64Url.trim())
        }.getOrNull() ?: return false
        if (rawPub.size != 32) return false
        val spki = ED25519_SPKI_PREFIX + rawPub
        val spec = java.security.spec.X509EncodedKeySpec(spki)
        var providerFound = false
        for (alg in listOf("Ed25519", "EdDSA", "1.3.101.112")) {
            try {
                val kf = java.security.KeyFactory.getInstance(alg)
                val pubKey = kf.generatePublic(spec)
                val sig = java.security.Signature.getInstance(alg)
                providerFound = true
                sig.initVerify(pubKey)
                sig.update(signingInput)
                return sig.verify(signatureBytes)
            } catch (_: java.security.NoSuchAlgorithmException) {
                continue
            } catch (_: Throwable) {
                return false
            }
        }
        return !providerFound
    }

    internal fun verifyTokenClaimsForProject(
        token: String?,
        expectedProject: String = PROJECT_ID,
        expectedDeviceId: String? = null,
        pubKeyB64Url: String = BuildConfig.SWEEPR_LICENSE_PUBKEY,
    ): Boolean {
        if (token.isNullOrBlank()) return false
        val parts = token.trim().split(".")
        if (parts.size != 3) return false
        return runCatching {
            val sigBytes = java.util.Base64.getUrlDecoder().decode(parts[2])
            val signingInput = "${parts[0]}.${parts[1]}".toByteArray(Charsets.UTF_8)
            if (!verifyEd25519Signature(signingInput, sigBytes, pubKeyB64Url)) {
                return@runCatching false
            }
            val decoded = java.util.Base64.getUrlDecoder().decode(parts[1])
            val claims = org.json.JSONObject(String(decoded, Charsets.UTF_8))
            val exp = claims.optLong("exp", 0L)
            val nowSec = System.currentTimeMillis() / 1000L
            if (exp <= nowSec) return@runCatching false
            if (!expectedDeviceId.isNullOrBlank()) {
                val tokenDev = claims.optString("device_id", "")
                if (tokenDev.isNotBlank() && tokenDev != expectedDeviceId) {
                    return@runCatching false
                }
            }
            val proj = claims.optString("project_id", expectedProject).ifBlank { expectedProject }
            val addonsArr = claims.optJSONArray("addons")
            var hasBundle = false
            if (addonsArr != null) {
                for (i in 0 until addonsArr.length()) {
                    if (addonsArr.optString(i).equals("sweepr_secure_bundle", ignoreCase = true)) {
                        hasBundle = true
                        break
                    }
                }
            }
            if (proj != expectedProject && proj != "all" && !hasBundle) return@runCatching false
            val status = claims.optString("status", "")
            status == "active" || status == "trialing"
        }.getOrDefault(false)
    }

    fun sendOtp(email: String) {
        val body = org.json.JSONObject()
            .put("email", email.trim())
            .put("project_id", PROJECT_ID)
        postJson("/v1/account/send-otp", body)
    }

    fun verifyOtp(email: String, code: String, deviceId: String): LinkedAccount {
        val body = org.json.JSONObject()
            .put("email", email.trim())
            .put("code", code.trim())
            .put("device_id", deviceId)
            .put("platform", "android")
            .put("project_id", PROJECT_ID)
            .put("device_label", "${Build.MANUFACTURER} ${Build.MODEL}".trim())
        val res = postJson("/v1/account/verify-otp", body)
        val expiresSec = res.optLong("expires_at", 0L)
        val token = res.optString("token", "").trim()
        val rawActive = res.optBoolean("active", true)
        val isActive = rawActive && token.isNotEmpty() && verifyTokenClaimsForProject(token, PROJECT_ID, deviceId)
        return LinkedAccount(
            accountId = res.getString("account_id"),
            email = res.optString("email", email.trim().lowercase()),
            refreshToken = res.getString("refresh_token"),
            deviceId = deviceId,
            serverActive = isActive,
            plan = res.optString("plan").takeIf { it.isNotBlank() },
            expiresAt = if (expiresSec > 0L) expiresSec else 0L,
            addons = if (isActive) parseAddons(res) else emptyList(),
        )
    }

    fun refreshEntitlement(current: LinkedAccount): LinkedAccount {
        if (!current.isSignedIn) return current
        val body = org.json.JSONObject()
            .put("device_id", current.deviceId)
            .put("device_type", "mobile")
            .put("project_id", PROJECT_ID)
        val res = try {
            postJson("/v1/entitlement", body, bearerToken = current.refreshToken)
        } catch (e: ApiException) {
            if (e.statusCode == 401 || e.statusCode == 403) {
                return current.copy(serverActive = false, expiresAt = 0L, addons = emptyList())
            }
            throw e
        }
        val status = res.optString("status", "")
        val token = res.optString("token", "").trim()
        val rawActive = res.optBoolean("active", status == "active" || status == "trialing")
        val isActive = rawActive && token.isNotEmpty() && verifyTokenClaimsForProject(token, PROJECT_ID, current.deviceId)
        val expiresSec = res.optLong("expires_at", 0L)
        return current.copy(
            email = res.optString("email", current.email).ifBlank { current.email },
            serverActive = isActive,
            plan = res.optString("plan").takeIf { it.isNotBlank() } ?: current.plan,
            expiresAt = if (expiresSec > 0L) expiresSec else 0L,
            addons = if (isActive) parseAddons(res, current.addons) else emptyList(),
        )
    }

    fun fetchEntitlement(current: LinkedAccount): LinkedAccount = refreshEntitlement(current)

    fun deleteAccount(current: LinkedAccount) {
        val body = org.json.JSONObject()
            .put("device_id", current.deviceId)
            .put("project_id", PROJECT_ID)
        postJson("/v1/account", body, method = "DELETE", bearerToken = current.refreshToken)
    }
}

object Reminders {
    const val CHANNEL_ID = "cleanup_reminders"
    private const val WORK_NAME = "sweepr_cleanup_reminder"
    private const val NOTIFICATION_ID = 4201

    fun createChannel(context: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            context.getString(R.string.notif_channel_name),
            NotificationManager.IMPORTANCE_DEFAULT,
        ).apply { description = context.getString(R.string.notif_channel_desc) }
        context.getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
    }

    /**
     * Schedules (or cancels) the repeating reminder. [replace] = false keeps an existing
     * schedule so app launches don't keep pushing the next reminder back.
     */
    fun schedule(context: Context, frequency: ReminderFrequency, replace: Boolean) {
        val wm = WorkManager.getInstance(context)
        if (frequency == ReminderFrequency.Off) {
            wm.cancelUniqueWork(WORK_NAME)
            return
        }
        val request = PeriodicWorkRequestBuilder<ReminderWorker>(frequency.days, TimeUnit.DAYS)
            .setInitialDelay(frequency.days, TimeUnit.DAYS)
            .build()
        wm.enqueueUniquePeriodicWork(
            WORK_NAME,
            if (replace) ExistingPeriodicWorkPolicy.CANCEL_AND_REENQUEUE else ExistingPeriodicWorkPolicy.KEEP,
            request,
        )
    }

    fun canNotify(context: Context): Boolean =
        Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED

    fun show(context: Context) {
        if (!canNotify(context)) return
        val storage = readStorage()
        val percent = (storage.fraction * 100).roundToInt()
        val text = if (storage.total > 0) {
            context.getString(R.string.notif_text_percent, percent)
        } else {
            context.getString(R.string.notif_text)
        }
        val open = PendingIntent.getActivity(
            context,
            0,
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setColor(0xFF10B981.toInt())
            .setContentTitle(context.getString(R.string.notif_title))
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        try {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
        } catch (_: SecurityException) {
            // Permission revoked between the check and the call – nothing to do.
        }
    }
}

class ReminderWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        Reminders.show(applicationContext)
        return Result.success()
    }
}
