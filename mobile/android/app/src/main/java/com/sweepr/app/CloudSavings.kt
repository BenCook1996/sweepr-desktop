@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)

package com.sweepr.app

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.nio.ByteBuffer
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import javax.crypto.Cipher
import javax.crypto.CipherInputStream
import javax.crypto.CipherOutputStream
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
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
 *
 * V2 Streaming Format ("SWMVLT02"):
 * - Fixed 512-byte encrypted file header:
 *   "SWMVLT02" (8B) | salt (16B) | headerIv (12B) | bodyIv (12B) | AES-GCM(448B metadata) + tag (16B) = 512B
 * - Encrypted index file (`vault_index.json`) in the vault directory encrypted with a cached session
 *   `SecretKey` (derived once per unlock session via PBKDF2-HMAC-SHA256) so `listInDir()` reads only
 *   the index/header in <5ms instead of decrypting multi-megabyte file bodies.
 * - Streaming body encryption/decryption via `CipherOutputStream` / `CipherInputStream` with a 64 KB buffer.
 */
object MobileCloudVault {
    private val MAGIC_V1 = "SWMVAULT".toByteArray(Charsets.US_ASCII)
    private val MAGIC_V2 = "SWMVLT02".toByteArray(Charsets.US_ASCII)
    private val HEADER_AAD = "SWMHDR02".toByteArray(Charsets.US_ASCII)
    private val INDEX_AAD = "SWMINDEX".toByteArray(Charsets.US_ASCII)
    private const val INDEX_FILE_NAME = "vault_index.json"
    private const val SALT_LEN = 16
    private const val IV_LEN = 12
    private const val HEADER_PLAIN_LEN = 448
    private const val HEADER_CIPHER_LEN = HEADER_PLAIN_LEN + 16 // 464 bytes
    internal const val FIXED_HEADER_BYTES = 8 + SALT_LEN + IV_LEN + IV_LEN + HEADER_CIPHER_LEN // 512 bytes
    internal const val STREAM_BUFFER_SIZE = 64 * 1024 // 64 KB streaming buffer
    private const val PBKDF2_ITERATIONS = 120_000
    private const val GCM_TAG_BITS = 128
    private const val MAX_IN_MEMORY_BYTES = 25L * 1024L * 1024L
    private const val MAX_VAULT_FILE_BYTES = 500L * 1024L * 1024L

    /** Cached session SecretKeys keyed by SHA-256(password + ":" + base64(salt)) so PBKDF2 runs once per session. */
    private val sessionKeyCache = ConcurrentHashMap<String, SecretKeySpec>()
    private val dirSaltCache = ConcurrentHashMap<String, ByteArray>()

    data class VaultMetadata(
        val fileName: String,
        val originalName: String,
        val size: Long,
        val mimeType: String,
        val createdAt: Long,
        val saltB64: String,
        val headerIvB64: String,
    )

    data class VaultItem(
        val file: File,
        val unlockedName: String?,
        val sizeBytes: Long,
        val modifiedAt: Long,
        val mimeType: String = "application/octet-stream",
    )

    private fun vaultDir(context: Context): File =
        File(context.filesDir, "cloud_vault").apply { mkdirs() }

    private fun b64Encode(bytes: ByteArray): String =
        java.util.Base64.getEncoder().encodeToString(bytes)

    private fun b64Decode(str: String): ByteArray =
        java.util.Base64.getDecoder().decode(str.trim())

    private fun cacheKeyFor(password: String, salt: ByteArray): String {
        val md = MessageDigest.getInstance("SHA-256")
        md.update(password.toByteArray(Charsets.UTF_8))
        md.update(0.toByte())
        md.update(salt)
        return b64Encode(md.digest())
    }

    /** Derives (or returns cached session) AES-256 SecretKey via PBKDF2-HMAC-SHA256 once per unlock session. */
    internal fun deriveKey(password: String, salt: ByteArray): SecretKeySpec {
        val lookupKey = cacheKeyFor(password, salt)
        sessionKeyCache[lookupKey]?.let { return it }
        val spec = PBEKeySpec(password.toCharArray(), salt, PBKDF2_ITERATIONS, 256)
        val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        val raw = factory.generateSecret(spec).encoded
        spec.clearPassword()
        val secretKey = SecretKeySpec(raw, "AES")
        sessionKeyCache[lookupKey] = secretKey
        return secretKey
    }

    fun clearSessionCache() {
        sessionKeyCache.clear()
    }

    private fun getOrCreateDirSalt(dir: File): ByteArray {
        val dirKey = dir.absolutePath
        dirSaltCache[dirKey]?.let { return it }
        val indexFile = File(dir, INDEX_FILE_NAME)
        if (indexFile.isFile) {
            runCatching {
                val text = indexFile.readText(Charsets.UTF_8)
                val saltMatch = Regex(""""salt"\s*:\s*"([^"]+)"""").find(text)?.groupValues?.get(1)
                if (!saltMatch.isNullOrBlank()) {
                    val decoded = b64Decode(saltMatch)
                    if (decoded.size == SALT_LEN) {
                        dirSaltCache[dirKey] = decoded
                        return decoded
                    }
                }
            }
        }
        val existingVaultFile = dir.listFiles { f -> f.isFile && f.name.endsWith(".swvault") }?.firstOrNull()
        if (existingVaultFile != null && existingVaultFile.length() >= 8 + SALT_LEN) {
            runCatching {
                FileInputStream(existingVaultFile).use { fis ->
                    val hdr = ByteArray(8 + SALT_LEN)
                    if (fis.read(hdr) == hdr.size) {
                        val s = hdr.copyOfRange(8, 8 + SALT_LEN)
                        dirSaltCache[dirKey] = s
                        return s
                    }
                }
            }
        }
        val fresh = ByteArray(SALT_LEN).also { SecureRandom().nextBytes(it) }
        dirSaltCache[dirKey] = fresh
        return fresh
    }

    private fun jsonEscape(value: String): String = buildString(value.length + 8) {
        for (ch in value) {
            when (ch) {
                '\\' -> append("\\\\")
                '"' -> append("\\\"")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                else -> append(ch)
            }
        }
    }

    private fun jsonUnescape(raw: String): String = buildString(raw.length) {
        var i = 0
        while (i < raw.length) {
            val ch = raw[i]
            if (ch == '\\' && i + 1 < raw.length) {
                when (val next = raw[i + 1]) {
                    '\\' -> append('\\')
                    '"' -> append('"')
                    'n' -> append('\n')
                    'r' -> append('\r')
                    't' -> append('\t')
                    else -> append(next)
                }
                i += 2
            } else {
                append(ch)
                i += 1
            }
        }
    }

    private fun serializeIndexEntries(entries: Collection<VaultMetadata>): String =
        entries.joinToString(prefix = "[", postfix = "]", separator = ",") { e ->
            """{"fileName":"${jsonEscape(e.fileName)}","originalName":"${jsonEscape(e.originalName)}","size":${e.size},"mimeType":"${jsonEscape(e.mimeType)}","createdAt":${e.createdAt},"salt":"${jsonEscape(e.saltB64)}","headerIv":"${jsonEscape(e.headerIvB64)}"}"""
        }

    private fun parseIndexEntries(json: String): Map<String, VaultMetadata> {
        val map = LinkedHashMap<String, VaultMetadata>()
        val objRegex = Regex("""\{([^{}]+)\}""")
        fun strField(body: String, key: String): String =
            Regex(""""$key"\s*:\s*"((?:\\.|[^"\\])*)"""").find(body)?.groupValues?.get(1)?.let(::jsonUnescape).orEmpty()
        fun longField(body: String, key: String): Long =
            Regex(""""$key"\s*:\s*(-?\d+)""").find(body)?.groupValues?.get(1)?.toLongOrNull() ?: 0L

        for (match in objRegex.findAll(json)) {
            val body = match.groupValues[1]
            val fn = strField(body, "fileName")
            val orig = strField(body, "originalName")
            if (fn.isNotEmpty() && orig.isNotEmpty()) {
                map[fn] = VaultMetadata(
                    fileName = fn,
                    originalName = orig,
                    size = longField(body, "size"),
                    mimeType = strField(body, "mimeType").ifEmpty { "application/octet-stream" },
                    createdAt = longField(body, "createdAt"),
                    saltB64 = strField(body, "salt"),
                    headerIvB64 = strField(body, "headerIv"),
                )
            }
        }
        return map
    }

    internal fun readEncryptedIndex(dir: File, password: String): Map<String, VaultMetadata>? = runCatching {
        val indexFile = File(dir, INDEX_FILE_NAME)
        if (!indexFile.isFile) return null
        val content = indexFile.readText(Charsets.UTF_8)
        val saltB64 = Regex(""""salt"\s*:\s*"([^"]+)"""").find(content)?.groupValues?.get(1) ?: return null
        val ivB64 = Regex(""""iv"\s*:\s*"([^"]+)"""").find(content)?.groupValues?.get(1) ?: return null
        val ctB64 = Regex(""""ciphertext"\s*:\s*"([^"]+)"""").find(content)?.groupValues?.get(1) ?: return null
        val salt = b64Decode(saltB64)
        val iv = b64Decode(ivB64)
        val ct = b64Decode(ctB64)
        val key = deriveKey(password, salt)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))
        cipher.updateAAD(INDEX_AAD)
        val plainJson = String(cipher.doFinal(ct), Charsets.UTF_8)
        parseIndexEntries(plainJson)
    }.getOrNull()

    internal fun writeEncryptedIndex(dir: File, password: String, entries: Map<String, VaultMetadata>) {
        runCatching {
            dir.mkdirs()
            val salt = getOrCreateDirSalt(dir)
            val iv = ByteArray(IV_LEN).also { SecureRandom().nextBytes(it) }
            val key = deriveKey(password, salt)
            val plainBytes = serializeIndexEntries(entries.values).toByteArray(Charsets.UTF_8)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))
            cipher.updateAAD(INDEX_AAD)
            val ct = cipher.doFinal(plainBytes)
            val json = """{"version":2,"salt":"${b64Encode(salt)}","iv":"${b64Encode(iv)}","ciphertext":"${b64Encode(ct)}"}"""
            File(dir, INDEX_FILE_NAME).writeText(json, Charsets.UTF_8)
        }
    }

    /** Packs metadata into a fixed 448-byte buffer and encrypts to a 464-byte GCM block (total header = 512B). */
    private fun packAndEncryptFixedHeader(
        originalName: String,
        originalSize: Long,
        createdAt: Long,
        mimeType: String,
        key: SecretKeySpec,
        headerIv: ByteArray,
    ): ByteArray {
        val rawName = originalName.toByteArray(Charsets.UTF_8)
        val nameBytes = if (rawName.size > 200) rawName.copyOf(200) else rawName
        val rawMime = mimeType.toByteArray(Charsets.UTF_8)
        val mimeBytes = if (rawMime.size > 120) rawMime.copyOf(120) else rawMime

        val plainBuf = ByteBuffer.allocate(HEADER_PLAIN_LEN)
        plainBuf.putShort(nameBytes.size.toShort())
        plainBuf.put(nameBytes)
        plainBuf.putLong(originalSize)
        plainBuf.putLong(createdAt)
        plainBuf.putShort(mimeBytes.size.toShort())
        plainBuf.put(mimeBytes)

        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, headerIv))
        cipher.updateAAD(HEADER_AAD)
        return cipher.doFinal(plainBuf.array())
    }

    /** Reads and decrypts ONLY the 512-byte header of a V2 `.swvault` file without reading the file body. */
    internal fun readHeaderMetadata(file: File, password: String): Pair<VaultMetadata, ByteArray>? {
        if (!file.isFile || file.length() < FIXED_HEADER_BYTES) return null
        val headerBytes = ByteArray(FIXED_HEADER_BYTES)
        FileInputStream(file).use { fis ->
            var offset = 0
            while (offset < FIXED_HEADER_BYTES) {
                val r = fis.read(headerBytes, offset, FIXED_HEADER_BYTES - offset)
                if (r < 0) return null
                offset += r
            }
        }
        val magic = headerBytes.copyOfRange(0, 8)
        if (!magic.contentEquals(MAGIC_V2)) return null
        val salt = headerBytes.copyOfRange(8, 8 + SALT_LEN)
        val headerIv = headerBytes.copyOfRange(8 + SALT_LEN, 8 + SALT_LEN + IV_LEN)
        val bodyIv = headerBytes.copyOfRange(8 + SALT_LEN + IV_LEN, 8 + SALT_LEN + IV_LEN + IV_LEN)
        val encryptedMeta = headerBytes.copyOfRange(8 + SALT_LEN + IV_LEN + IV_LEN, FIXED_HEADER_BYTES)

        val key = deriveKey(password, salt)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, headerIv))
        cipher.updateAAD(HEADER_AAD)
        val plain = cipher.doFinal(encryptedMeta)
        val buf = ByteBuffer.wrap(plain)
        val nameLen = buf.short.toInt() and 0xFFFF
        require(nameLen in 1..200) { "Corrupted vault header filename length" }
        val nameBytes = ByteArray(nameLen).also { buf.get(it) }
        val origSize = buf.long
        val createdAt = buf.long
        val mimeLen = buf.short.toInt() and 0xFFFF
        val mimeType = if (mimeLen in 1..120) {
            ByteArray(mimeLen).also { buf.get(it) }.toString(Charsets.UTF_8)
        } else {
            "application/octet-stream"
        }
        val meta = VaultMetadata(
            fileName = file.name,
            originalName = String(nameBytes, Charsets.UTF_8),
            size = origSize,
            mimeType = mimeType,
            createdAt = createdAt,
            saltB64 = b64Encode(salt),
            headerIvB64 = b64Encode(headerIv),
        )
        return meta to bodyIv
    }

    fun list(context: Context, password: String? = null): List<VaultItem> =
        listInDir(vaultDir(context), password)

    fun listInDir(dir: File, password: String? = null): List<VaultItem> {
        val files = dir
            .listFiles { f -> f.isFile && f.name.endsWith(".swvault") }
            ?.sortedByDescending { it.lastModified() }
            ?: emptyList()
        if (files.isEmpty()) return emptyList()
        if (password.isNullOrEmpty()) {
            return files.map { file ->
                VaultItem(
                    file = file,
                    unlockedName = null,
                    sizeBytes = file.length(),
                    modifiedAt = file.lastModified(),
                )
            }
        }

        val indexed = readEncryptedIndex(dir, password)?.toMutableMap() ?: LinkedHashMap()
        var indexDirty = false

        val items = files.map { file ->
            val cachedMeta = indexed[file.name]
            if (cachedMeta != null) {
                VaultItem(
                    file = file,
                    unlockedName = cachedMeta.originalName,
                    sizeBytes = file.length(),
                    modifiedAt = file.lastModified(),
                    mimeType = cachedMeta.mimeType,
                )
            } else {
                val fromHeader = runCatching { readHeaderMetadata(file, password)?.first }.getOrNull()
                if (fromHeader != null) {
                    indexed[file.name] = fromHeader
                    indexDirty = true
                    VaultItem(
                        file = file,
                        unlockedName = fromHeader.originalName,
                        sizeBytes = file.length(),
                        modifiedAt = file.lastModified(),
                        mimeType = fromHeader.mimeType,
                    )
                } else {
                    val legacyName = runCatching { decrypt(file, password).first }.getOrNull()
                    if (legacyName != null) {
                        indexed[file.name] = VaultMetadata(
                            fileName = file.name,
                            originalName = legacyName,
                            size = file.length(),
                            mimeType = "application/octet-stream",
                            createdAt = file.lastModified(),
                            saltB64 = "",
                            headerIvB64 = "",
                        )
                        indexDirty = true
                    }
                    VaultItem(
                        file = file,
                        unlockedName = legacyName,
                        sizeBytes = file.length(),
                        modifiedAt = file.lastModified(),
                    )
                }
            }
        }

        if (indexDirty && indexed.isNotEmpty()) {
            writeEncryptedIndex(dir, password, indexed)
        }
        return items
    }

    /**
     * Streams file encryption directly from `uri` into a `.swvault` container using `CipherOutputStream`
     * with a 64 KB buffer so importing a 250 MB video never allocates 1 GB on the Android heap.
     */
    fun importUri(context: Context, uri: Uri, password: String): VaultItem {
        require(password.length >= 8) { "Password must be at least 8 characters" }
        val resolver = context.contentResolver
        var displayName = "protected_file"
        var declaredSize = -1L
        val mimeType = resolver.getType(uri) ?: "application/octet-stream"
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
            if (c.moveToFirst()) {
                val idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (idx >= 0 && !c.isNull(idx)) {
                    displayName = c.getString(idx).take(200)
                }
                val sizeIdx = c.getColumnIndex(OpenableColumns.SIZE)
                if (sizeIdx >= 0 && !c.isNull(sizeIdx)) {
                    declaredSize = c.getLong(sizeIdx)
                }
            }
        }
        require(declaredSize <= MAX_VAULT_FILE_BYTES) { "File exceeds the 500 MB vault size limit." }
        return resolver.openInputStream(uri)?.use { input ->
            encryptStreamToDir(
                dir = vaultDir(context),
                displayName = displayName,
                inputStream = input,
                password = password,
                mimeType = mimeType,
                declaredSize = declaredSize,
            )
        } ?: error("Could not read selected file")
    }

    fun encryptUri(context: Context, uri: Uri, password: String): VaultItem =
        importUri(context, uri, password)

    fun encryptStreamToDir(
        dir: File,
        displayName: String,
        inputStream: InputStream,
        password: String,
        mimeType: String = "application/octet-stream",
        declaredSize: Long = -1L,
    ): VaultItem {
        require(password.length >= 8) { "Password must be at least 8 characters" }
        dir.mkdirs()
        val rng = SecureRandom()
        val salt = getOrCreateDirSalt(dir)
        val headerIv = ByteArray(IV_LEN).also(rng::nextBytes)
        val bodyIv = ByteArray(IV_LEN).also(rng::nextBytes)
        val key = deriveKey(password, salt)

        val rawNameBytes = displayName.toByteArray(Charsets.UTF_8)
        val nameBytes = if (rawNameBytes.size > 200) rawNameBytes.copyOf(200) else rawNameBytes
        val safeDisplayName = String(nameBytes, Charsets.UTF_8)
        val createdAt = System.currentTimeMillis()

        val idHex = ByteArray(8).also(rng::nextBytes).joinToString("") { "%02x".format(it) }
        val target = File(dir, "vault_$idHex.swvault")

        var totalBytesWritten = 0L
        try {
            FileOutputStream(target).use { fos ->
                // Reserve 512 bytes for the fixed encrypted header (written once exact stream size is known)
                fos.write(ByteArray(FIXED_HEADER_BYTES))

                val bodyCipher = Cipher.getInstance("AES/GCM/NoPadding")
                bodyCipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, bodyIv))
                CipherOutputStream(BufferedOutputStream(fos, STREAM_BUFFER_SIZE), bodyCipher).use { cos ->
                    val buf = ByteArray(STREAM_BUFFER_SIZE)
                    while (true) {
                        val read = inputStream.read(buf)
                        if (read < 0) break
                        totalBytesWritten += read
                        require(totalBytesWritten <= MAX_VAULT_FILE_BYTES) { "File exceeds the 500 MB vault size limit." }
                        cos.write(buf, 0, read)
                    }
                }
            }

            val finalSize = if (declaredSize >= 0L && totalBytesWritten == 0L) declaredSize else totalBytesWritten
            val encryptedMeta = packAndEncryptFixedHeader(
                originalName = safeDisplayName,
                originalSize = finalSize,
                createdAt = createdAt,
                mimeType = mimeType,
                key = key,
                headerIv = headerIv,
            )
            java.io.RandomAccessFile(target, "rw").use { raf ->
                raf.seek(0L)
                raf.write(MAGIC_V2)
                raf.write(salt)
                raf.write(headerIv)
                raf.write(bodyIv)
                raf.write(encryptedMeta)
            }
        } catch (t: Throwable) {
            target.delete()
            throw t
        }

        val meta = VaultMetadata(
            fileName = target.name,
            originalName = safeDisplayName,
            size = totalBytesWritten,
            mimeType = mimeType,
            createdAt = createdAt,
            saltB64 = b64Encode(salt),
            headerIvB64 = b64Encode(headerIv),
        )
        val existingIndex = readEncryptedIndex(dir, password)?.toMutableMap() ?: LinkedHashMap()
        existingIndex[target.name] = meta
        writeEncryptedIndex(dir, password, existingIndex)

        return VaultItem(target, safeDisplayName, target.length(), target.lastModified(), mimeType)
    }

    fun encryptBytesToDir(dir: File, displayName: String, payload: ByteArray, password: String): VaultItem {
        require(payload.size.toLong() <= MAX_IN_MEMORY_BYTES) {
            "In-memory buffer exceeds 25 MB limit; use importUri / encryptStreamToDir for large files."
        }
        return ByteArrayInputStream(payload).use { bais ->
            encryptStreamToDir(
                dir = dir,
                displayName = displayName,
                inputStream = bais,
                password = password,
                declaredSize = payload.size.toLong(),
            )
        }
    }

    /**
     * Streams decryption of a `.swvault` container into `outputStream` using `CipherInputStream`
     * with a 64 KB buffer, returning the authenticated original filename.
     */
    fun decryptToStream(file: File, password: String, outputStream: OutputStream): String {
        require(file.isFile && file.length() > MAGIC_V1.size + SALT_LEN + IV_LEN + 16) { "Invalid vault file" }
        val fileMagic = ByteArray(8)
        FileInputStream(file).use { fis ->
            if (fis.read(fileMagic) != 8) error("Invalid vault file")
        }
        if (fileMagic.contentEquals(MAGIC_V2)) {
            val (meta, bodyIv) = readHeaderMetadata(file, password) ?: error("Invalid or corrupted vault header")
            val salt = b64Decode(meta.saltB64)
            val key = deriveKey(password, salt)
            val bodyCipher = Cipher.getInstance("AES/GCM/NoPadding")
            bodyCipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, bodyIv))

            var totalDecrypted = 0L
            FileInputStream(file).use { fis ->
                var skipped = 0L
                while (skipped < FIXED_HEADER_BYTES) {
                    val s = fis.skip(FIXED_HEADER_BYTES - skipped)
                    if (s <= 0) break
                    skipped += s
                }
                require(skipped == FIXED_HEADER_BYTES.toLong()) { "Truncated vault file" }
                CipherInputStream(BufferedInputStream(fis, STREAM_BUFFER_SIZE), bodyCipher).use { cis ->
                    val buf = ByteArray(STREAM_BUFFER_SIZE)
                    while (true) {
                        val read = cis.read(buf)
                        if (read < 0) break
                        totalDecrypted += read
                        outputStream.write(buf, 0, read)
                    }
                }
            }
            if (meta.size >= 0L && totalDecrypted != meta.size) {
                throw SecurityException("Vault GCM authentication failed or file was truncated")
            }
            return meta.originalName
        }

        // Legacy V1 ("SWMVAULT") fallback
        val (origName, plainBytes) = decryptLegacyV1(file, password)
        outputStream.write(plainBytes)
        return origName
    }

    private fun decryptLegacyV1(file: File, password: String): Pair<String, ByteArray> {
        require(file.length() <= MAX_IN_MEMORY_BYTES) { "Legacy vault file exceeds 25 MB in-memory cap" }
        val all = file.readBytes()
        require(all.size > MAGIC_V1.size + SALT_LEN + IV_LEN + 18) { "Invalid vault file" }
        val header = all.copyOfRange(0, MAGIC_V1.size)
        require(header.contentEquals(MAGIC_V1)) { "Not a SWEEPR Vault file" }
        val salt = all.copyOfRange(MAGIC_V1.size, MAGIC_V1.size + SALT_LEN)
        val iv = all.copyOfRange(MAGIC_V1.size + SALT_LEN, MAGIC_V1.size + SALT_LEN + IV_LEN)
        val cipherBytes = all.copyOfRange(MAGIC_V1.size + SALT_LEN + IV_LEN, all.size)

        val key = deriveKey(password, salt)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))
        cipher.updateAAD(MAGIC_V1)
        val plain = cipher.doFinal(cipherBytes)

        val buf = ByteBuffer.wrap(plain)
        val nameLen = buf.short.toInt() and 0xFFFF
        if (nameLen <= 0 || nameLen > 1024 || nameLen > buf.remaining()) {
            error("Corrupted vault entry header.")
        }
        val nameBytes = ByteArray(nameLen).also { buf.get(it) }
        val body = ByteArray(buf.remaining()).also { buf.get(it) }
        return String(nameBytes, Charsets.UTF_8) to body
    }

    fun decrypt(file: File, password: String): Pair<String, ByteArray> {
        require(file.length() <= MAX_IN_MEMORY_BYTES + FIXED_HEADER_BYTES) {
            "Vault file exceeds 25 MB in-memory cap; use exportToDownloads / decryptToStream."
        }
        val out = ByteArrayOutputStream()
        val name = decryptToStream(file, password, out)
        return name to out.toByteArray()
    }

    internal fun sanitizeRestoreFileName(originalName: String): String =
        File(originalName).name.replace(Regex("[\\\\/:*?\"<>|]"), "_").trim('.').ifBlank { "restored_file" }

    /**
     * Streams decryption directly into the user's Downloads folder using `CipherInputStream`
     * with a 64 KB buffer so restoring a 250 MB video never buffers the file in heap memory.
     */
    fun exportToDownloads(context: Context, item: VaultItem, password: String): File {
        val headerMeta = readHeaderMetadata(item.file, password)?.first
        val initialName = headerMeta?.originalName
            ?: decryptLegacyV1(item.file, password).first
        val safeName = sanitizeRestoreFileName(initialName)

        if (android.os.Build.VERSION.SDK_INT >= 29) {
            val mediaStoreFile = runCatching {
                val values = android.content.ContentValues().apply {
                    put(android.provider.MediaStore.Downloads.DISPLAY_NAME, safeName)
                    put(android.provider.MediaStore.Downloads.RELATIVE_PATH, "${android.os.Environment.DIRECTORY_DOWNLOADS}/SWEEPR Restored")
                    put(android.provider.MediaStore.Downloads.IS_PENDING, 1)
                }
                val resolver = context.contentResolver
                val uri = resolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                if (uri != null) {
                    try {
                        val out = resolver.openOutputStream(uri) ?: error("Could not open MediaStore output stream")
                        BufferedOutputStream(out, STREAM_BUFFER_SIZE).use { bos ->
                            decryptToStream(item.file, password, bos)
                        }
                        values.clear()
                        values.put(android.provider.MediaStore.Downloads.IS_PENDING, 0)
                        resolver.update(uri, values, null, null)
                        File(
                            android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOWNLOADS),
                            "SWEEPR Restored/$safeName",
                        )
                    } catch (t: Throwable) {
                        runCatching { resolver.delete(uri, null, null) }
                        throw t
                    }
                } else {
                    null
                }
            }.getOrNull()
            if (mediaStoreFile != null) return mediaStoreFile
        }
        val publicDownloads = runCatching {
            val dir = File(
                android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOWNLOADS),
                "SWEEPR Restored",
            )
            if (dir.exists() || dir.mkdirs()) {
                val f = File(dir, safeName)
                try {
                    BufferedOutputStream(FileOutputStream(f), STREAM_BUFFER_SIZE).use { bos ->
                        decryptToStream(item.file, password, bos)
                    }
                    f
                } catch (t: Throwable) {
                    f.delete()
                    throw t
                }
            } else null
        }.getOrNull()
        if (publicDownloads != null) return publicDownloads

        val outDir = File(
            context.getExternalFilesDir(android.os.Environment.DIRECTORY_DOWNLOADS) ?: context.filesDir,
            "Restored",
        ).apply { mkdirs() }
        val outFile = File(outDir, safeName)
        try {
            BufferedOutputStream(FileOutputStream(outFile), STREAM_BUFFER_SIZE).use { bos ->
                decryptToStream(item.file, password, bos)
            }
            return outFile
        } catch (t: Throwable) {
            outFile.delete()
            throw t
        }
    }

    fun restoreToDownloads(context: Context, item: VaultItem, password: String): File =
        exportToDownloads(context, item, password)

    private const val KEYSTORE_ALIAS = "sweepr_vault_master_key"
    private const val VAULT_PREFS = "sweepr_vault_keystore"

    private fun getOrCreateKeystoreSecret(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val existing = ks.getEntry(KEYSTORE_ALIAS, null) as? KeyStore.SecretKeyEntry
        if (existing != null) return existing.secretKey
        val kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        kg.init(
            KeyGenParameterSpec.Builder(
                KEYSTORE_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return kg.generateKey()
    }

    /** Hardware-backed Android Keystore persistence for 1-tap Quick Unlock. */
    fun saveRememberedPassword(context: Context, password: String) {
        runCatching {
            val secret = getOrCreateKeystoreSecret()
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, secret)
            val ct = cipher.doFinal(password.toByteArray(Charsets.UTF_8))
            context.getSharedPreferences(VAULT_PREFS, Context.MODE_PRIVATE).edit()
                .putString("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
                .putString("ct", Base64.encodeToString(ct, Base64.NO_WRAP))
                .apply()
        }
    }

    fun getRememberedPassword(context: Context): String? = runCatching {
        val sp = context.getSharedPreferences(VAULT_PREFS, Context.MODE_PRIVATE)
        val ivB64 = sp.getString("iv", null) ?: return null
        val ctB64 = sp.getString("ct", null) ?: return null
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val secret = (ks.getEntry(KEYSTORE_ALIAS, null) as? KeyStore.SecretKeyEntry)?.secretKey ?: return null
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, secret, GCMParameterSpec(128, Base64.decode(ivB64, Base64.NO_WRAP)))
        String(cipher.doFinal(Base64.decode(ctB64, Base64.NO_WRAP)), Charsets.UTF_8)
    }.getOrNull()

    fun clearRememberedPassword(context: Context) {
        clearSessionCache()
        context.getSharedPreferences(VAULT_PREFS, Context.MODE_PRIVATE).edit().clear().apply()
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
    var rememberedPassword by remember { mutableStateOf<String?>(null) }
    var rememberInKeystore by remember { mutableStateOf(true) }
    var showPassword by remember { mutableStateOf(false) }
    var showPasswordModal by remember { mutableStateOf(false) }
    var pendingEncryptAfterModal by remember { mutableStateOf(false) }
    var vaultItems by remember { mutableStateOf<List<MobileCloudVault.VaultItem>>(emptyList()) }
    var vaultUnlocked by remember { mutableStateOf(false) }
    var vaultBusy by remember { mutableStateOf(false) }
    var vaultStatus by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        val savedPw = withContext(Dispatchers.IO) { MobileCloudVault.getRememberedPassword(context) }
        rememberedPassword = savedPw
        if (!savedPw.isNullOrEmpty()) {
            vaultPassword = savedPw
        }
        val list = withContext(Dispatchers.IO) { MobileCloudVault.list(context, savedPw) }
        vaultItems = list
        if (!savedPw.isNullOrEmpty() && list.any { it.unlockedName != null }) {
            vaultUnlocked = true
        }
    }

    val filePicker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenMultipleDocuments(),
    ) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        if (!(state.hasPremium || state.hasCloudVault)) {
            onShowPaywall {}
            return@rememberLauncherForActivityResult
        }
        vaultBusy = true
        vaultStatus = null
        scope.launch {
            val result = runCatching {
                withContext(Dispatchers.IO) {
                    if (rememberInKeystore && vaultPassword.length >= 8) {
                        MobileCloudVault.saveRememberedPassword(context, vaultPassword)
                        rememberedPassword = vaultPassword
                    }
                    uris.forEach { u -> MobileCloudVault.importUri(context, u, vaultPassword) }
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

    if (showPasswordModal) {
        AlertDialog(
            onDismissRequest = {
                showPasswordModal = false
                pendingEncryptAfterModal = false
            },
            title = {
                Text(
                    if (pendingEncryptAfterModal) "Set Vault Password (8+ chars)" else "Unlock Private Vault",
                    fontWeight = FontWeight.ExtraBold,
                )
            },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(
                        "Files are encrypted locally with AES-256-GCM before cloud sync.",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
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
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Checkbox(
                            checked = rememberInKeystore,
                            onCheckedChange = { rememberInKeystore = it },
                        )
                        Text(
                            "Remember key in Android Hardware Keystore for 1-tap unlock",
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            },
            confirmButton = {
                Button(
                    enabled = vaultPassword.length >= 8,
                    colors = ButtonDefaults.buttonColors(containerColor = SweeprGreen),
                    onClick = {
                        val shouldLaunchPicker = pendingEncryptAfterModal
                        showPasswordModal = false
                        pendingEncryptAfterModal = false
                        scope.launch {
                            if (rememberInKeystore) {
                                withContext(Dispatchers.IO) {
                                    MobileCloudVault.saveRememberedPassword(context, vaultPassword)
                                }
                                rememberedPassword = vaultPassword
                            } else {
                                MobileCloudVault.clearRememberedPassword(context)
                                rememberedPassword = null
                            }
                            if (shouldLaunchPicker) {
                                filePicker.launch(arrayOf("image/*", "application/pdf", "*/*"))
                            } else {
                                val list = withContext(Dispatchers.IO) { MobileCloudVault.list(context, vaultPassword) }
                                vaultItems = list
                                vaultUnlocked = list.any { it.unlockedName != null }
                                vaultStatus = if (vaultUnlocked || list.isEmpty()) {
                                    context.getString(R.string.vault_msg_unlocked)
                                } else {
                                    context.getString(R.string.vault_msg_wrong_pw)
                                }
                            }
                        }
                    },
                ) {
                    Text(
                        if (pendingEncryptAfterModal) "Continue & Pick File" else "Unlock Vault",
                        fontWeight = FontWeight.Bold,
                    )
                }
            },
            dismissButton = {
                TextButton(
                    onClick = {
                        showPasswordModal = false
                        pendingEncryptAfterModal = false
                    },
                ) {
                    Text(stringResource(R.string.action_cancel))
                }
            },
        )
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
                BatteryVaultSegmentedBar(
                    isBatterySelected = false,
                    onSelectBattery = onOpenBattery,
                    onSelectVault = {},
                )
            }

            // 1. Private Photo & Document Vault (Top Card — Zero-Friction Modal / Keystore Flow)
            SweeprPanel(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Row(
                            modifier = Modifier
                                .weight(1f)
                                .padding(end = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            SweeprIconBadge(
                                kind = SweeprIconKind.VAULT_SHIELD,
                                tint = SweeprGreen,
                                badgeSize = 40.dp,
                                iconSize = 20.dp,
                            )
                            Column(Modifier.weight(1f)) {
                                Text(
                                    stringResource(R.string.vault_eyebrow),
                                    color = emeraldText(),
                                    fontSize = 10.5.sp,
                                    fontWeight = FontWeight.ExtraBold,
                                    letterSpacing = 0.8.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Text(
                                    stringResource(R.string.vault_title),
                                    fontSize = 17.sp,
                                    fontWeight = FontWeight.ExtraBold,
                                    color = MaterialTheme.colorScheme.onSurface,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                        SizeBadge(
                            text = when {
                                vaultUnlocked -> "Unlocked"
                                rememberedPassword != null -> "Keystore Ready"
                                else -> "AES-256"
                            },
                        )
                    }

                    Text(
                        stringResource(R.string.vault_subtitle),
                        fontSize = 12.5.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        lineHeight = 18.sp,
                    )

                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = {
                                val runEncrypt = {
                                    if (vaultPassword.length >= 8) {
                                        filePicker.launch(arrayOf("image/*", "application/pdf", "*/*"))
                                    } else {
                                        pendingEncryptAfterModal = true
                                        showPasswordModal = true
                                    }
                                }
                                if (state.hasPremium || state.hasCloudVault) runEncrypt() else onShowPaywall(runEncrypt)
                            },
                            enabled = !vaultBusy,
                            modifier = Modifier.weight(1f).heightIn(min = 48.dp),
                            shape = RoundedCornerShape(14.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = SweeprGreen),
                        ) {
                            Text(
                                stringResource(R.string.vault_btn_encrypt),
                                fontWeight = FontWeight.ExtraBold,
                                color = Color.White,
                            )
                        }

                        if (vaultItems.isNotEmpty() && !vaultUnlocked) {
                            OutlinedButton(
                                onClick = {
                                    val saved = rememberedPassword
                                    if (!saved.isNullOrEmpty() && saved.length >= 8) {
                                        vaultPassword = saved
                                        scope.launch {
                                            val list = withContext(Dispatchers.IO) { MobileCloudVault.list(context, saved) }
                                            vaultItems = list
                                            vaultUnlocked = list.any { it.unlockedName != null }
                                            vaultStatus = if (vaultUnlocked) {
                                                context.getString(R.string.vault_msg_unlocked)
                                            } else {
                                                pendingEncryptAfterModal = false
                                                showPasswordModal = true
                                                null
                                            }
                                        }
                                    } else {
                                        pendingEncryptAfterModal = false
                                        showPasswordModal = true
                                    }
                                },
                                enabled = !vaultBusy,
                                shape = RoundedCornerShape(14.dp),
                                modifier = Modifier.heightIn(min = 48.dp),
                            ) {
                                Text(
                                    if (rememberedPassword != null) "Quick Unlock" else stringResource(R.string.vault_btn_unlock),
                                    fontWeight = FontWeight.Bold,
                                )
                            }
                        } else if (vaultPassword.isNotEmpty()) {
                            OutlinedButton(
                                onClick = {
                                    pendingEncryptAfterModal = false
                                    showPasswordModal = true
                                },
                                shape = RoundedCornerShape(14.dp),
                                modifier = Modifier.heightIn(min = 48.dp),
                            ) {
                                Text("Key", fontWeight = FontWeight.Bold)
                            }
                        }
                    }

                    vaultStatus?.let { msg ->
                        Text(msg, fontSize = 12.sp, color = emeraldText(), fontWeight = FontWeight.SemiBold)
                    }

                    if (vaultItems.isEmpty()) {
                        Surface(
                            shape = RoundedCornerShape(12.dp),
                            color = MaterialTheme.colorScheme.background,
                            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text(
                                stringResource(R.string.vault_empty),
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(12.dp),
                            )
                        }
                    } else {
                        vaultItems.forEach { item ->
                            Surface(
                                shape = RoundedCornerShape(12.dp),
                                color = MaterialTheme.colorScheme.background,
                                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Row(
                                    modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Column(Modifier.weight(1f)) {
                                        Text(
                                            item.unlockedName ?: stringResource(R.string.vault_locked_file),
                                            fontWeight = FontWeight.Bold,
                                            fontSize = 13.sp,
                                            maxLines = 1,
                                            overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                                        )
                                        Text(formatBytes(item.sizeBytes), fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                    TextButton(
                                        onClick = {
                                            if (vaultPassword.length < 8) {
                                                pendingEncryptAfterModal = false
                                                showPasswordModal = true
                                                return@TextButton
                                            }
                                            scope.launch {
                                                runCatching {
                                                    withContext(Dispatchers.IO) {
                                                        val restored = MobileCloudVault.exportToDownloads(context, item, vaultPassword)
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
                                        Text(stringResource(R.string.vault_btn_restore), fontWeight = FontWeight.Bold)
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
                                        Text(stringResource(R.string.swipe_delete), color = DangerRed, fontWeight = FontWeight.Bold)
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // 2. Compact Cloud Backup Savings Card (Consolidated — no duplicate Home nav buttons)
            SweeprPanel(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(
                        stringResource(R.string.cloud_eyebrow),
                        color = emeraldText(),
                        fontSize = 11.sp,
                        fontWeight = FontWeight.ExtraBold,
                        letterSpacing = 0.8.sp,
                    )
                    Text(
                        stringResource(R.string.cloud_headline, formatBytes(bd.reclaimBytes)),
                        fontSize = 19.sp,
                        fontWeight = FontWeight.ExtraBold,
                        lineHeight = 24.sp,
                    )
                    Text(
                        stringResource(R.string.cloud_headline_body),
                        fontSize = 12.5.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        lineHeight = 18.sp,
                    )

                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        CloudSavings.Provider.entries.forEach { p ->
                            FilterChip(
                                selected = provider == p,
                                onClick = {
                                    provider = p
                                    CloudSavings.saveProvider(context, p)
                                },
                                label = { Text(stringResource(p.labelRes), fontSize = 12.sp) },
                                colors = FilterChipDefaults.filterChipColors(selectedContainerColor = SweeprGreen.copy(alpha = 0.18f)),
                            )
                        }
                    }

                    Surface(
                        shape = RoundedCornerShape(12.dp),
                        color = MaterialTheme.colorScheme.background,
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            BreakdownRow(stringResource(R.string.cloud_row_junk), formatBytes(bd.junkBytes))
                            BreakdownRow(stringResource(R.string.cloud_row_videos), formatBytes(bd.compressibleBytes))
                            BreakdownRow(stringResource(R.string.cloud_row_attachments), formatBytes(bd.attachmentBytes))
                            BreakdownRow(stringResource(R.string.cloud_row_total_reclaimable), formatBytes(bd.reclaimBytes), highlight = true)
                        }
                    }

                    OutlinedButton(
                        onClick = { context.openUrl(manageUrl(provider)) },
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.fillMaxWidth().heightIn(min = 46.dp),
                    ) {
                        Text(
                            stringResource(R.string.cloud_action_manage, stringResource(provider.labelRes)),
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }
            }
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
