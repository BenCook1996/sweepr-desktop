@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)

package com.sweepr.app

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/**
 * CloudClean & Encrypted Photo Vault for phones:
 * 1. Shows exact storage reclaimable across backed-up photos, screenshots, large videos,
 *    and messenger/email attachments (no hardcoded subscription price estimates).
 * 2. Provides an on-device AES-256-GCM + PBKDF2-HMAC-SHA256 Photo & Document Vault so
 *    sensitive photos, IDs, and documents can be encrypted before syncing to cloud storage.
 */
object CloudSavings {
    enum class Provider(val labelRes: Int) {
        GOOGLE_ONE(R.string.cloud_provider_google),
        ICLOUD(R.string.cloud_provider_icloud),
        ONEDRIVE(R.string.cloud_provider_onedrive),
        DROPBOX(R.string.cloud_provider_dropbox),
    }

    /** Re-encoding phone videos with the built-in compressor typically halves them. */
    const val VIDEO_COMPRESSION_RATIO = 0.5
    private const val MIN_COMPRESSIBLE_VIDEO = 100L * 1024 * 1024

    data class Breakdown(
        val junkBytes: Long,
        val compressibleBytes: Long,
        val attachmentBytes: Long,
        val duplicateCount: Int,
        val screenshotCount: Int,
        val largeVideoCount: Int,
        val attachmentCount: Int,
    ) {
        val reclaimBytes: Long get() = junkBytes + compressibleBytes + attachmentBytes
    }

    fun breakdown(media: MediaScanResult): Breakdown {
        val junk = media.reclaimableBytes
        val largeVids = media.videos.filter { it.size >= MIN_COMPRESSIBLE_VIDEO }
        val compressible = largeVids.sumOf { (it.size * VIDEO_COMPRESSION_RATIO).toLong() }
        val attachments = media.messengerMedia.sumOf { it.size }
        val dupCount = (media.duplicateGroups + media.similarGroups).sumOf { it.extras.size }
        return Breakdown(
            junkBytes = junk,
            compressibleBytes = compressible,
            attachmentBytes = attachments,
            duplicateCount = dupCount,
            screenshotCount = media.screenshots.size,
            largeVideoCount = largeVids.size,
            attachmentCount = media.messengerMedia.size,
        )
    }

    private const val PREFS = "cloud_savings"

    fun loadProvider(context: Context): Provider {
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return runCatching { Provider.valueOf(p.getString("provider", null) ?: "") }
            .getOrDefault(Provider.GOOGLE_ONE)
    }

    fun saveProvider(context: Context, provider: Provider) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString("provider", provider.name)
            .apply()
    }
}

/**
 * On-device AES-256-GCM + PBKDF2-HMAC-SHA256 encrypted container for mobile photos & documents.
 * Header format: "SWMVAULT" (8B) | salt (16B) | iv (12B) | ciphertext(nameLen(2B) + nameUTF8 + payload) + GCM tag (16B).
 */
object MobileCloudVault {
    private val MAGIC = "SWMVAULT".toByteArray(Charsets.US_ASCII)
    private const val SALT_LEN = 16
    private const val IV_LEN = 12
    private const val PBKDF2_ITERATIONS = 120_000
    private const val GCM_TAG_BITS = 128

    data class VaultItem(
        val file: File,
        val unlockedName: String?,
        val sizeBytes: Long,
        val modifiedAt: Long,
    )

    private fun vaultDir(context: Context): File =
        File(context.filesDir, "cloud_vault").apply { mkdirs() }

    private fun deriveKey(password: String, salt: ByteArray): SecretKeySpec {
        val spec = PBEKeySpec(password.toCharArray(), salt, PBKDF2_ITERATIONS, 256)
        val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        val raw = factory.generateSecret(spec).encoded
        spec.clearPassword()
        return SecretKeySpec(raw, "AES")
    }

    fun list(context: Context, password: String? = null): List<VaultItem> =
        listInDir(vaultDir(context), password)

    fun listInDir(dir: File, password: String? = null): List<VaultItem> {
        val files = dir
            .listFiles { f -> f.isFile && f.name.endsWith(".swvault") }
            ?.sortedByDescending { it.lastModified() }
            ?: emptyList()
        return files.map { file ->
            val unlocked = if (!password.isNullOrEmpty()) {
                runCatching { decrypt(file, password).first }.getOrNull()
            } else {
                null
            }
            VaultItem(
                file = file,
                unlockedName = unlocked,
                sizeBytes = file.length(),
                modifiedAt = file.lastModified(),
            )
        }
    }

    fun encryptUri(context: Context, uri: Uri, password: String): VaultItem {
        require(password.length >= 8) { "Password must be at least 8 characters" }
        val resolver = context.contentResolver
        var displayName = "protected_file"
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) {
                val idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (idx >= 0 && !c.isNull(idx)) {
                    displayName = c.getString(idx).take(200)
                }
            }
        }
        val payload = resolver.openInputStream(uri)?.use { it.readBytes() }
            ?: error("Could not read selected file")
        return encryptBytesToDir(vaultDir(context), displayName, payload, password)
    }

    fun encryptBytesToDir(dir: File, displayName: String, payload: ByteArray, password: String): VaultItem {
        require(password.length >= 8) { "Password must be at least 8 characters" }
        dir.mkdirs()
        val rng = SecureRandom()
        val salt = ByteArray(SALT_LEN).also(rng::nextBytes)
        val iv = ByteArray(IV_LEN).also(rng::nextBytes)
        val key = deriveKey(password, salt)

        val nameBytes = displayName.toByteArray(Charsets.UTF_8)
        val plain = ByteBuffer.allocate(2 + nameBytes.size + payload.size)
            .putShort(nameBytes.size.toShort())
            .put(nameBytes)
            .put(payload)
            .array()

        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))
        cipher.updateAAD(MAGIC)
        val cipherBytes = cipher.doFinal(plain)

        val outBytes = ByteArrayOutputStream(MAGIC.size + SALT_LEN + IV_LEN + cipherBytes.size).apply {
            write(MAGIC)
            write(salt)
            write(iv)
            write(cipherBytes)
        }.toByteArray()

        val idHex = ByteArray(8).also(rng::nextBytes).joinToString("") { "%02x".format(it) }
        val target = File(dir, "vault_$idHex.swvault")
        target.writeBytes(outBytes)
        return VaultItem(target, displayName, target.length(), target.lastModified())
    }

    fun decrypt(file: File, password: String): Pair<String, ByteArray> {
        val all = file.readBytes()
        require(all.size > MAGIC.size + SALT_LEN + IV_LEN + 18) { "Invalid vault file" }
        val header = all.copyOfRange(0, MAGIC.size)
        require(header.contentEquals(MAGIC)) { "Not a SWEEPR Vault file" }
        val salt = all.copyOfRange(MAGIC.size, MAGIC.size + SALT_LEN)
        val iv = all.copyOfRange(MAGIC.size + SALT_LEN, MAGIC.size + SALT_LEN + IV_LEN)
        val cipherBytes = all.copyOfRange(MAGIC.size + SALT_LEN + IV_LEN, all.size)

        val key = deriveKey(password, salt)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))
        cipher.updateAAD(MAGIC)
        val plain = cipher.doFinal(cipherBytes)

        val buf = ByteBuffer.wrap(plain)
        val nameLen = buf.short.toInt() and 0xFFFF
        require(nameLen in 1..(plain.size - 2)) { "Corrupted vault entry" }
        val nameBytes = ByteArray(nameLen).also { buf.get(it) }
        val body = ByteArray(buf.remaining()).also { buf.get(it) }
        return String(nameBytes, Charsets.UTF_8) to body
    }

    fun restoreToDownloads(context: Context, item: VaultItem, password: String): File {
        val (origName, bytes) = decrypt(item.file, password)
        val safeName = origName.replace(Regex("[\\\\/:*?\"<>|]"), "_")
        val outDir = File(context.getExternalFilesDir(null) ?: context.filesDir, "Restored").apply { mkdirs() }
        val outFile = File(outDir, safeName)
        outFile.writeBytes(bytes)
        return outFile
    }
}

/** Dashboard banner shown right after a scan. */
@Composable
fun CloudSavingsBanner(state: DashboardState, onOpen: () -> Unit) {
    val context = LocalContext.current
    val provider = remember(state.media) { CloudSavings.loadProvider(context) }
    val bd = remember(state.media) { CloudSavings.breakdown(state.media) }
    val title = stringResource(R.string.cloud_banner_title, formatBytes(bd.reclaimBytes))
    val body = stringResource(R.string.cloud_banner_body, formatBytes(bd.reclaimBytes), stringResource(provider.labelRes))
    Card(
        onClick = onOpen,
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = "$title. $body" },
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = SweeprGreen.copy(alpha = 0.12f)),
    ) {
        Column(Modifier.padding(16.dp)) {
            Text(stringResource(R.string.cloud_eyebrow), color = SweeprGreenDark, fontSize = 11.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(4.dp))
            Text(title, fontWeight = FontWeight.Bold, fontSize = 17.sp)
            Spacer(Modifier.height(2.dp))
            Text(body, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, lineHeight = 18.sp)
        }
    }
}

@Composable
fun CloudSavingsScreen(
    state: DashboardState,
    onOpenPhotosTab: (Int) -> Unit,
    onOpen: (Screen) -> Unit,
    onShowPaywall: (then: () -> Unit) -> Unit = {},
    onOpenBattery: (() -> Unit)? = null,
    onBack: (() -> Unit)? = null,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var provider by remember { mutableStateOf(CloudSavings.loadProvider(context)) }
    val bd = remember(state.media) { CloudSavings.breakdown(state.media) }

    // Vault state
    var vaultPassword by remember { mutableStateOf("") }
    var showPassword by remember { mutableStateOf(false) }
    var vaultItems by remember { mutableStateOf<List<MobileCloudVault.VaultItem>>(emptyList()) }
    var vaultUnlocked by remember { mutableStateOf(false) }
    var vaultBusy by remember { mutableStateOf(false) }
    var vaultStatus by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        vaultItems = withContext(Dispatchers.IO) { MobileCloudVault.list(context) }
    }

    val filePicker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenMultipleDocuments(),
    ) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        vaultBusy = true
        vaultStatus = null
        scope.launch {
            val result = runCatching {
                withContext(Dispatchers.IO) {
                    uris.forEach { u -> MobileCloudVault.encryptUri(context, u, vaultPassword) }
                    MobileCloudVault.list(context, vaultPassword)
                }
            }
            vaultBusy = false
            result.onSuccess { list ->
                vaultItems = list
                vaultUnlocked = true
                vaultStatus = context.getString(R.string.vault_msg_encrypted, uris.size)
            }.onFailure { err ->
                vaultStatus = err.message ?: context.getString(R.string.vault_msg_error)
            }
        }
    }

    Scaffold(topBar = { SweeprTopBar(stringResource(R.string.cloud_title), onBack = onBack) }) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .background(MaterialTheme.colorScheme.background)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            if (onOpenBattery != null) {
                Surface(
                    shape = RoundedCornerShape(24.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(4.dp),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Surface(
                            onClick = onOpenBattery,
                            shape = RoundedCornerShape(20.dp),
                            color = Color.Transparent,
                            modifier = Modifier.weight(1f),
                        ) {
                            Text(
                                text = "🔋 Battery Saver",
                                color = MaterialTheme.colorScheme.onSurface,
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 13.sp,
                                modifier = Modifier.padding(vertical = 10.dp),
                                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                            )
                        }
                        Surface(
                            onClick = {},
                            shape = RoundedCornerShape(20.dp),
                            color = SweeprGreen,
                            modifier = Modifier.weight(1f),
                        ) {
                            Text(
                                text = "🔒 Private Vault & Cloud",
                                color = Color.White,
                                fontWeight = FontWeight.Bold,
                                fontSize = 13.sp,
                                modifier = Modifier.padding(vertical = 10.dp),
                                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                            )
                        }
                    }
                }
            }

            // 1. Private Photo & Document Vault (Top Card)
            Card(shape = RoundedCornerShape(20.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Column(Modifier.fillMaxWidth()) {
                        Text(stringResource(R.string.vault_eyebrow), color = SweeprGreen, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                        Text(stringResource(R.string.vault_title), fontSize = 19.sp, fontWeight = FontWeight.Bold)
                    }
                    Text(
                        stringResource(R.string.vault_subtitle),
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        lineHeight = 18.sp,
                    )

                    OutlinedTextField(
                        value = vaultPassword,
                        onValueChange = { vaultPassword = it },
                        label = { Text(stringResource(R.string.vault_password_label)) },
                        singleLine = true,
                        visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                        trailingIcon = {
                            TextButton(onClick = { showPassword = !showPassword }) {
                                Text(if (showPassword) stringResource(R.string.vault_hide) else stringResource(R.string.vault_show))
                            }
                        },
                        modifier = Modifier.fillMaxWidth(),
                    )

                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = {
                                val runEncrypt = {
                                    if (vaultPassword.length < 8) {
                                        vaultStatus = context.getString(R.string.vault_msg_short_pw)
                                    } else {
                                        filePicker.launch(arrayOf("image/*", "application/pdf", "*/*"))
                                    }
                                }
                                if (state.hasPremium) runEncrypt() else onShowPaywall(runEncrypt)
                            },
                            enabled = !vaultBusy,
                            modifier = Modifier.weight(1f).heightIn(min = 46.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = SweeprGreen),
                        ) {
                            Text(stringResource(R.string.vault_btn_encrypt))
                        }

                        if (vaultItems.isNotEmpty() && !vaultUnlocked) {
                            OutlinedButton(
                                onClick = {
                                    if (vaultPassword.isBlank()) {
                                        vaultStatus = context.getString(R.string.vault_msg_short_pw)
                                        return@OutlinedButton
                                    }
                                    scope.launch {
                                        val list = withContext(Dispatchers.IO) { MobileCloudVault.list(context, vaultPassword) }
                                        vaultItems = list
                                        vaultUnlocked = list.any { it.unlockedName != null }
                                        vaultStatus = if (vaultUnlocked || list.isEmpty()) {
                                            context.getString(R.string.vault_msg_unlocked)
                                        } else {
                                            context.getString(R.string.vault_msg_wrong_pw)
                                        }
                                    }
                                },
                                enabled = !vaultBusy,
                                modifier = Modifier.heightIn(min = 46.dp),
                            ) {
                                Text(stringResource(R.string.vault_btn_unlock))
                            }
                        }
                    }

                    vaultStatus?.let { msg ->
                        Text(msg, fontSize = 12.sp, color = SweeprGreen, fontWeight = FontWeight.Medium)
                    }

                    if (vaultItems.isEmpty()) {
                        Text(stringResource(R.string.vault_empty), fontSize = 12.sp, color = Color.Gray)
                    } else {
                        vaultItems.forEach { item ->
                            Row(
                                modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(Modifier.weight(1f)) {
                                    Text(
                                        item.unlockedName ?: stringResource(R.string.vault_locked_file),
                                        fontWeight = FontWeight.SemiBold,
                                        fontSize = 13.sp,
                                    )
                                    Text(formatBytes(item.sizeBytes), fontSize = 11.sp, color = Color.Gray)
                                }
                                TextButton(
                                    onClick = {
                                        if (vaultPassword.isBlank()) {
                                            vaultStatus = context.getString(R.string.vault_msg_short_pw)
                                            return@TextButton
                                        }
                                        scope.launch {
                                            runCatching {
                                                withContext(Dispatchers.IO) {
                                                    val restored = MobileCloudVault.restoreToDownloads(context, item, vaultPassword)
                                                    val list = MobileCloudVault.list(context, vaultPassword)
                                                    restored to list
                                                }
                                            }.onSuccess { (out, list) ->
                                                vaultItems = list
                                                vaultUnlocked = true
                                                vaultStatus = context.getString(R.string.vault_msg_restored, out.name)
                                            }.onFailure {
                                                vaultStatus = context.getString(R.string.vault_msg_wrong_pw)
                                            }
                                        }
                                    },
                                ) {
                                    Text(stringResource(R.string.vault_btn_restore))
                                }
                                TextButton(
                                    onClick = {
                                        scope.launch {
                                            withContext(Dispatchers.IO) { item.file.delete() }
                                            vaultItems = withContext(Dispatchers.IO) {
                                                MobileCloudVault.list(context, if (vaultUnlocked) vaultPassword else null)
                                            }
                                        }
                                    },
                                ) {
                                    Text(stringResource(R.string.swipe_delete), color = DangerRed)
                                }
                            }
                        }
                    }
                }
            }

            // 2. Cloud Space Finder Card
            Card(shape = RoundedCornerShape(20.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Column(Modifier.padding(20.dp)) {
                    Text(stringResource(R.string.cloud_eyebrow), color = SweeprGreen, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(6.dp))
                    Text(
                        stringResource(R.string.cloud_headline, formatBytes(bd.reclaimBytes)),
                        fontSize = 22.sp, fontWeight = FontWeight.Bold, lineHeight = 28.sp,
                    )
                    Spacer(Modifier.height(6.dp))
                    Text(stringResource(R.string.cloud_headline_body), fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, lineHeight = 20.sp)
                }
            }

            // Provider selector
            Text(stringResource(R.string.cloud_which_service), fontWeight = FontWeight.Bold)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                CloudSavings.Provider.entries.forEach { p ->
                    FilterChip(
                        selected = provider == p,
                        onClick = {
                            provider = p
                            CloudSavings.saveProvider(context, p)
                        },
                        label = { Text(stringResource(p.labelRes)) },
                        modifier = Modifier.heightIn(min = 44.dp),
                        colors = FilterChipDefaults.filterChipColors(selectedContainerColor = SweeprGreen.copy(alpha = 0.18f)),
                    )
                }
            }

            // Storage Breakdown
            Card(shape = RoundedCornerShape(16.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    BreakdownRow(stringResource(R.string.cloud_row_junk), formatBytes(bd.junkBytes))
                    BreakdownRow(stringResource(R.string.cloud_row_videos), formatBytes(bd.compressibleBytes))
                    BreakdownRow(stringResource(R.string.cloud_row_attachments), formatBytes(bd.attachmentBytes))
                    BreakdownRow(stringResource(R.string.cloud_row_total_reclaimable), formatBytes(bd.reclaimBytes), highlight = true)
                }
            }
            Text(stringResource(R.string.cloud_estimate_note), fontSize = 12.sp, color = Color.Gray, lineHeight = 16.sp)

            // Actions
            Button(
                onClick = { onOpenPhotosTab(0) },
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                colors = ButtonDefaults.buttonColors(containerColor = SweeprGreen),
            ) { Text(stringResource(R.string.cloud_action_duplicates)) }
            OutlinedButton(onClick = { onOpenPhotosTab(3) }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                Text(stringResource(R.string.cloud_action_videos))
            }
            OutlinedButton(onClick = { onOpen(Screen.Screenshots) }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                Text(stringResource(R.string.cloud_action_screenshots))
            }
            OutlinedButton(onClick = { onOpenPhotosTab(5) }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                Text(stringResource(R.string.cloud_action_attachments))
            }
            OutlinedButton(onClick = { context.openUrl(manageUrl(provider)) }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                Text(stringResource(R.string.cloud_action_manage, stringResource(provider.labelRes)))
            }

            Text(stringResource(R.string.cloud_sync_note), fontSize = 12.sp, color = Color.Gray, lineHeight = 16.sp)
            Spacer(Modifier.height(24.dp))
        }
    }
}

private fun manageUrl(provider: CloudSavings.Provider): String = when (provider) {
    CloudSavings.Provider.GOOGLE_ONE -> "https://one.google.com/storage/management"
    CloudSavings.Provider.ICLOUD -> "https://www.icloud.com/settings/"
    CloudSavings.Provider.ONEDRIVE -> "https://onedrive.live.com/?v=managestorage"
    CloudSavings.Provider.DROPBOX -> "https://www.dropbox.com/account/plan"
}

@Composable
private fun BreakdownRow(label: String, value: String, highlight: Boolean = false) {
    Row(Modifier.fillMaxWidth()) {
        Text(label, modifier = Modifier.weight(1f), fontSize = 14.sp)
        Text(value, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = if (highlight) SweeprGreen else MaterialTheme.colorScheme.onSurface)
    }
}
