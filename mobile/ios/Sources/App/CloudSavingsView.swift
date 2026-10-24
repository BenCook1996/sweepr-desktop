import CommonCrypto
import CryptoKit
import LocalAuthentication
import Security
import SwiftUI
import UniformTypeIdentifiers

/// CloudClean for iPhone: reports the cloud storage reclaimable from the on-device
/// photo scan (duplicates, similar shots, blurry photos, screenshots, and large videos)
/// and provides an on-device AES-256-GCM Encrypted Photo & Document Vault.
enum CloudSavings {
    enum Provider: String, CaseIterable, Identifiable {
        case iCloud, googleOne, oneDrive, dropbox

        var id: String { rawValue }

        var label: String {
            switch self {
            case .iCloud: return "iCloud+"
            case .googleOne: return "Google One"
            case .oneDrive: return "OneDrive"
            case .dropbox: return "Dropbox"
            }
        }

        var manageURL: URL? {
            switch self {
            case .iCloud: return URL(string: "https://www.icloud.com/settings/")
            case .googleOne: return URL(string: "https://one.google.com/storage/management")
            case .oneDrive: return URL(string: "https://onedrive.live.com/?v=managestorage")
            case .dropbox: return URL(string: "https://www.dropbox.com/account/plan")
            }
        }
    }

    static let videoCompressionRatio = 0.5

    struct Breakdown {
        let junkBytes: Int64
        let compressibleBytes: Int64

        var reclaimBytes: Int64 { junkBytes + compressibleBytes }
    }

    static func breakdown(result: MediaScanResult) -> Breakdown {
        let junk = result.duplicateGroups.reduce(0) { $0 + $1.reclaimableBytes }
            + result.similarGroups.reduce(0) { $0 + $1.reclaimableBytes }
            + result.screenshots.reduce(0) { $0 + $1.estimatedBytes }
            + result.blurryPhotos.reduce(0) { $0 + $1.estimatedBytes }
        let compressible = Int64(Double(result.largeVideos.reduce(0) { $0 + $1.estimatedBytes }) * videoCompressionRatio)
        return Breakdown(
            junkBytes: junk,
            compressibleBytes: compressible
        )
    }
}

/// On-device AES-256-GCM Encrypted Photo & Document Vault for iOS.
enum MobileCloudVault {
    struct Entry: Identifiable {
        let id: String
        let fileURL: URL
        let encryptedBytes: Int64
        let modifiedAt: Date
        var originalName: String?
    }

    enum VaultError: LocalizedError {
        case weakPassword
        case wrongPasswordOrCorrupt
        case invalidHeader
        case fileTooLarge

        var errorDescription: String? {
            switch self {
            case .weakPassword:
                return "Password must be at least 8 characters."
            case .wrongPasswordOrCorrupt:
                return "Wrong password or damaged vault file."
            case .invalidHeader:
                return "Invalid vault header."
            case .fileTooLarge:
                return "File is larger than the 250 MB mobile vault limit."
            }
        }
    }

    private static let magic = Data("SWPVLT01".utf8)
    private static let saltLen = 16
    private static let nonceLen = 12
    private static let pbkdf2Iterations: UInt32 = 120_000
    private static let maxFileBytes = 250 * 1024 * 1024

    private static func normalizePassword(_ password: String) -> String {
        password.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func vaultDirectory() throws -> URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        var dir = docs.appendingPathComponent("CloudVault", isDirectory: true)
        if !FileManager.default.fileExists(atPath: dir.path) {
            try FileManager.default.createDirectory(
                at: dir,
                withIntermediateDirectories: true,
                attributes: [.protectionKey: FileProtectionType.complete]
            )
        } else {
            try? FileManager.default.setAttributes(
                [.protectionKey: FileProtectionType.complete],
                ofItemAtPath: dir.path
            )
        }
        var resourceValues = URLResourceValues()
        resourceValues.isExcludedFromBackup = true
        try? dir.setResourceValues(resourceValues)
        return dir
    }

    private static func deriveKey(password: String, salt: Data) throws -> SymmetricKey {
        let cleanPassword = normalizePassword(password)
        guard cleanPassword.count >= 8 else { throw VaultError.weakPassword }
        let passwordBytes = Array(cleanPassword.utf8)
        let saltBytes = Array(salt)
        var derivedBytes = [UInt8](repeating: 0, count: 32)
        let status = CCKeyDerivationPBKDF(
            CCPBKDFAlgorithm(kCCPBKDF2),
            cleanPassword,
            passwordBytes.count,
            saltBytes,
            saltBytes.count,
            CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),
            pbkdf2Iterations,
            &derivedBytes,
            32
        )
        guard status == kCCSuccess else {
            throw VaultError.wrongPasswordOrCorrupt
        }
        return SymmetricKey(data: Data(derivedBytes))
    }

    private static func deriveLegacyKey(password: String, salt: Data) throws -> SymmetricKey {
        let cleanPassword = normalizePassword(password)
        guard cleanPassword.count >= 8 else { throw VaultError.weakPassword }
        let inputKey = SymmetricKey(data: Data(cleanPassword.utf8))
        return HKDF<SHA256>.deriveKey(
            inputKeyMaterial: inputKey,
            salt: salt,
            info: Data("sweepr-ios-cloud-vault-v1".utf8),
            outputByteCount: 32
        )
    }

    static func list(password: String? = nil) -> [Entry] {
        guard let dir = try? vaultDirectory(),
              let urls = try? FileManager.default.contentsOfDirectory(
                  at: dir,
                  includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey],
                  options: [.skipsHiddenFiles]
              ) else {
            return []
        }

        let cleanPassword = password.map(normalizePassword) ?? ""
        return urls
            .filter { $0.pathExtension == "swvault" }
            .compactMap { url -> Entry? in
                let values = try? url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
                let size = Int64(values?.fileSize ?? 0)
                let modified = values?.contentModificationDate ?? Date()
                let unlockedName: String? = cleanPassword.count >= 8 ? (try? readOriginalName(fileURL: url, password: cleanPassword)) : nil
                return Entry(
                    id: url.lastPathComponent,
                    fileURL: url,
                    encryptedBytes: size,
                    modifiedAt: modified,
                    originalName: unlockedName
                )
            }
            .sorted { $0.modifiedAt > $1.modifiedAt }
    }

    static func encryptFile(sourceURL: URL, password: String, deleteOriginal: Bool) throws -> Entry {
        let cleanPassword = normalizePassword(password)
        guard cleanPassword.count >= 8 else { throw VaultError.weakPassword }
        let accessed = sourceURL.startAccessingSecurityScopedResource()
        defer {
            if accessed { sourceURL.stopAccessingSecurityScopedResource() }
        }

        let plain = try Data(contentsOf: sourceURL)
        guard plain.count <= maxFileBytes else { throw VaultError.fileTooLarge }

        var salt = Data(count: saltLen)
        _ = salt.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, saltLen, $0.baseAddress!) }
        let key = try deriveKey(password: cleanPassword, salt: salt)
        let nonce = AES.GCM.Nonce()

        let originalName = sourceURL.lastPathComponent
        let nameBytes = Data(originalName.utf8)
        var payload = Data(capacity: 2 + nameBytes.count + plain.count)
        let nameLen = UInt16(min(nameBytes.count, 65535))
        payload.append(UInt8((nameLen >> 8) & 0xFF))
        payload.append(UInt8(nameLen & 0xFF))
        payload.append(nameBytes.prefix(Int(nameLen)))
        payload.append(plain)

        let sealed = try AES.GCM.seal(payload, using: key, nonce: nonce)
        var out = Data()
        out.append(magic)
        out.append(salt)
        out.append(contentsOf: nonce)
        out.append(sealed.ciphertext)
        out.append(sealed.tag)

        let id = UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(16)
        var dest = try vaultDirectory().appendingPathComponent("\(id).swvault")
        try out.write(to: dest, options: [.atomic, .completeFileProtection])
        var resourceValues = URLResourceValues()
        resourceValues.isExcludedFromBackup = true
        try? dest.setResourceValues(resourceValues)

        if deleteOriginal {
            try? FileManager.default.removeItem(at: sourceURL)
        }

        return Entry(
            id: dest.lastPathComponent,
            fileURL: dest,
            encryptedBytes: Int64(out.count),
            modifiedAt: Date(),
            originalName: originalName
        )
    }

    static func decryptToRestoredFolder(entry: Entry, password: String) throws -> URL {
        let cleanPassword = normalizePassword(password)
        let (name, body) = try decryptPayload(fileURL: entry.fileURL, password: cleanPassword)
        var restoredDir = try vaultDirectory().appendingPathComponent("Restored", isDirectory: true)
        if !FileManager.default.fileExists(atPath: restoredDir.path) {
            try FileManager.default.createDirectory(
                at: restoredDir,
                withIntermediateDirectories: true,
                attributes: [.protectionKey: FileProtectionType.complete]
            )
        }
        var dirValues = URLResourceValues()
        dirValues.isExcludedFromBackup = true
        try? restoredDir.setResourceValues(dirValues)

        let safeName = URL(fileURLWithPath: name).lastPathComponent
        var dest = restoredDir.appendingPathComponent(safeName.isEmpty ? "restored_file" : safeName)
        try body.write(to: dest, options: [.atomic, .completeFileProtection])
        var destValues = URLResourceValues()
        destValues.isExcludedFromBackup = true
        try? dest.setResourceValues(destValues)
        return dest
    }

    private static func readOriginalName(fileURL: URL, password: String) throws -> String {
        let (name, _) = try decryptPayload(fileURL: fileURL, password: normalizePassword(password))
        return name
    }

    private static func decryptPayload(fileURL: URL, password: String) throws -> (String, Data) {
        let cleanPassword = normalizePassword(password)
        let raw = try Data(contentsOf: fileURL)
        let headerLen = magic.count + saltLen + nonceLen
        guard raw.count > headerLen + 18, raw.prefix(magic.count) == magic else {
            throw VaultError.invalidHeader
        }
        let salt = raw.subdata(in: magic.count ..< (magic.count + saltLen))
        let nonceData = raw.subdata(in: (magic.count + saltLen) ..< headerLen)
        let cipherAndTag = raw.subdata(in: headerLen ..< raw.count)
        let ciphertext = cipherAndTag.dropLast(16)
        let tag = cipherAndTag.suffix(16)

        let key = try deriveKey(password: cleanPassword, salt: salt)
        let nonce = try AES.GCM.Nonce(data: nonceData)
        let box = try AES.GCM.SealedBox(nonce: nonce, ciphertext: ciphertext, tag: tag)
        let openedPlain: Data?
        if let p = try? AES.GCM.open(box, using: key) {
            openedPlain = p
        } else if let legacyKey = try? deriveLegacyKey(password: cleanPassword, salt: salt),
                  let p = try? AES.GCM.open(box, using: legacyKey) {
            openedPlain = p
        } else {
            openedPlain = nil
        }
        guard let plain = openedPlain, plain.count >= 2 else {
            throw VaultError.wrongPasswordOrCorrupt
        }
        let nameLen = (Int(plain[plain.startIndex]) << 8) | Int(plain[plain.startIndex + 1])
        guard plain.count >= 2 + nameLen else { throw VaultError.invalidHeader }
        let nameData = plain.subdata(in: (plain.startIndex + 2) ..< (plain.startIndex + 2 + nameLen))
        let body = plain.subdata(in: (plain.startIndex + 2 + nameLen) ..< plain.endIndex)
        let name = String(data: nameData, encoding: .utf8) ?? "restored_file"
        return (name, body)
    }

    // MARK: - Keychain + Face ID / Touch ID Vault Key Persistence

    private static let keychainService = "com.sweepr.app.vault"
    private static let keychainAccount = "master_vault_password"

    static func saveRememberedPassword(_ password: String) {
        let clean = normalizePassword(password)
        guard clean.count >= 8, let data = clean.data(using: .utf8) else { return }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount
        ]
        SecItemDelete(query as CFDictionary)
        var addQuery = query
        addQuery[kSecValueData as String] = data
        addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        SecItemAdd(addQuery as CFDictionary, nil)
    }

    static func getRememberedPassword() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func clearRememberedPassword() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount
        ]
        SecItemDelete(query as CFDictionary)
    }

    static func authenticateBiometrics(completion: @escaping (Bool) -> Void) {
        let context = LAContext()
        var error: NSError?
        if context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) {
            context.evaluatePolicy(
                .deviceOwnerAuthentication,
                localizedReason: "Unlock your SWEEPR Private Vault"
            ) { success, _ in
                DispatchQueue.main.async {
                    completion(success)
                }
            }
        } else {
            DispatchQueue.main.async {
                completion(true)
            }
        }
    }
}

/// Dashboard banner shown after a scan.
struct CloudSavingsBanner: View {
    @ObservedObject var vm: AppViewModel
    @AppStorage("cloud_provider") private var providerRaw = CloudSavings.Provider.iCloud.rawValue

    var body: some View {
        let provider = CloudSavings.Provider(rawValue: providerRaw) ?? .iCloud
        let info = CloudSavings.breakdown(result: vm.mediaResult)
        VStack(alignment: .leading, spacing: 4) {
            Text("CLOUDCLEAN · STORAGE BREAKDOWN")
                .font(.caption2.weight(.bold))
                .foregroundColor(.sweeprDarkEmerald)
            Text("\(formatByteCount(info.reclaimBytes)) reclaimable in \(provider.label)")
                .font(.headline)
            Text("Duplicates, blurry shots, screenshots, and oversized videos synced to your cloud storage.")
                .font(.footnote)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Color.sweeprEmerald.opacity(0.12))
        .cornerRadius(16)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens your cloud storage breakdown and encrypted photo vault")
    }
}

struct CloudSavingsView: View {
    @ObservedObject var vm: AppViewModel
    let onShowPaywall: () -> Void
    @AppStorage("cloud_provider") private var providerRaw = CloudSavings.Provider.iCloud.rawValue
    @Environment(\.openURL) private var openURL

    @State private var vaultPassword = ""
    @State private var rememberedPassword: String? = MobileCloudVault.getRememberedPassword()
    @State private var rememberInKeychain = true
    @State private var deleteOriginalAfterVault = false
    @State private var vaultEntries: [MobileCloudVault.Entry] = MobileCloudVault.list()
    @State private var vaultUnlocked = false
    @State private var vaultStatus: String?
    @State private var showingFileImporter = false
    @State private var showingPasswordModal = false
    @State private var pendingEncryptAfterModal = false

    private var provider: CloudSavings.Provider {
        CloudSavings.Provider(rawValue: providerRaw) ?? .iCloud
    }

    var body: some View {
        let info = CloudSavings.breakdown(result: vm.mediaResult)
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 14) {
                vaultSection
                cloudSummaryCard(info)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 20)
        }
        .sheet(isPresented: $showingPasswordModal) {
            vaultPasswordModalSheet
        }
        .fileImporter(
            isPresented: $showingFileImporter,
            allowedContentTypes: [.item],
            allowsMultipleSelection: false
        ) { result in
            guard vm.hasPremium else {
                onShowPaywall()
                return
            }
            switch result {
            case .success(let urls):
                guard let url = urls.first else { return }
                do {
                    if rememberInKeychain && vaultPassword.count >= 8 {
                        MobileCloudVault.saveRememberedPassword(vaultPassword)
                        rememberedPassword = vaultPassword
                    }
                    let entry = try MobileCloudVault.encryptFile(
                        sourceURL: url,
                        password: vaultPassword,
                        deleteOriginal: deleteOriginalAfterVault
                    )
                    vaultEntries = MobileCloudVault.list(password: vaultPassword)
                    vaultUnlocked = true
                    vaultStatus = "Locked \(entry.originalName ?? "file") in your Private Vault."
                } catch {
                    vaultStatus = error.localizedDescription
                }
            case .failure(let error):
                vaultStatus = error.localizedDescription
            }
        }
    }

    private var vaultPasswordModalSheet: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                Text(pendingEncryptAfterModal ? "Set Vault Password (8+ chars)" : "Unlock Private Vault")
                    .font(.title3.weight(.heavy))
                Text("Files are encrypted locally with AES-256-GCM before cloud sync.")
                    .font(.subheadline)
                    .foregroundColor(.sweeprMutedText)

                SecureField("Vault password (min. 8 characters)", text: $vaultPassword)
                    .padding(12)
                    .background(Color.sweeprPanelAlt)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(Color.sweeprLine, lineWidth: 1)
                    )

                Toggle("Remember in Keychain with Face ID", isOn: $rememberInKeychain)
                    .font(.system(size: 13, weight: .semibold))
                    .tint(.sweeprEmerald)

                Toggle("Remove original after locking in Vault", isOn: $deleteOriginalAfterVault)
                    .font(.system(size: 13, weight: .semibold))
                    .tint(.sweeprEmerald)

                Button {
                    let shouldPick = pendingEncryptAfterModal
                    showingPasswordModal = false
                    pendingEncryptAfterModal = false
                    if rememberInKeychain {
                        MobileCloudVault.saveRememberedPassword(vaultPassword)
                        rememberedPassword = vaultPassword
                    } else {
                        MobileCloudVault.clearRememberedPassword()
                        rememberedPassword = nil
                    }
                    if shouldPick {
                        showingFileImporter = true
                    } else {
                        let list = MobileCloudVault.list(password: vaultPassword)
                        vaultEntries = list
                        vaultUnlocked = list.contains { $0.originalName != nil }
                        vaultStatus = (vaultUnlocked || list.isEmpty)
                            ? "Private Vault unlocked."
                            : "Wrong password or damaged vault file."
                    }
                } label: {
                    Text(pendingEncryptAfterModal ? "Continue & Pick File" : "Unlock Vault")
                }
                .buttonStyle(SweeprPrimaryButtonStyle())
                .disabled(vaultPassword.count < 8)

                Spacer()
            }
            .padding(20)
            .background(Color.sweeprCanvas.ignoresSafeArea())
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Cancel") {
                        showingPasswordModal = false
                        pendingEncryptAfterModal = false
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func cloudSummaryCard(_ info: CloudSavings.Breakdown) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("CLOUDCLEAN · STORAGE BREAKDOWN")
                .font(.system(size: 10, weight: .heavy))
                .tracking(0.8)
                .foregroundColor(.sweeprEmerald)
            Text("\(formatByteCount(info.reclaimBytes)) reclaimable in \(provider.label)")
                .font(.system(size: 19, weight: .heavy, design: .rounded))
            Text("Deleting phone clutter also frees space in your \(provider.label) backup.")
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(.sweeprMutedText)

            HStack(spacing: 6) {
                ForEach(CloudSavings.Provider.allCases) { p in
                    let isSelected = providerRaw == p.rawValue
                    Button {
                        providerRaw = p.rawValue
                    } label: {
                        Text(p.label)
                            .font(.system(size: 11, weight: .heavy))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 8)
                            .background(isSelected ? Color.sweeprEmerald : Color.sweeprPanelAlt)
                            .foregroundColor(isSelected ? .white : .sweeprMutedText)
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .stroke(isSelected ? Color.sweeprEmerald : Color.sweeprLine, lineWidth: 1)
                            )
                    }
                    .buttonStyle(.plain)
                }
            }

            VStack(spacing: 8) {
                row("Duplicates, similar, blurry & screenshots", formatByteCount(info.junkBytes))
                Divider().background(Color.sweeprLine)
                row("Saved by compressing large videos (est.)", formatByteCount(info.compressibleBytes))
                Divider().background(Color.sweeprLine)
                row("Total cloud storage reclaimable", formatByteCount(info.reclaimBytes), highlight: true)
            }
            .padding(12)
            .background(Color.sweeprPanelAlt)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Color.sweeprLine, lineWidth: 1))

            if let url = provider.manageURL {
                Button {
                    openURL(url)
                } label: {
                    Text("Open \(provider.label) Storage Settings")
                        .font(.system(size: 13, weight: .bold))
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .background(Color.sweeprPanelAlt)
                        .foregroundColor(.sweeprEmerald)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Color.sweeprLine, lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(16)
        .sweeprCard(cornerRadius: 18)
    }

    private func row(_ label: String, _ value: String, highlight: Bool = false) -> some View {
        HStack {
            Text(label)
                .font(.system(size: 12, weight: highlight ? .bold : .medium))
                .foregroundColor(highlight ? .primary : .sweeprMutedText)
            Spacer()
            Text(value)
                .font(.system(size: 13, weight: .heavy))
                .foregroundColor(highlight ? .sweeprEmerald : .primary)
        }
        .accessibilityElement(children: .combine)
    }

    private var vaultSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                SweeprIconBadge(systemName: "lock.shield.fill", tint: .sweeprEmerald, size: 38, iconSize: 17, cornerRadius: 12)
                VStack(alignment: .leading, spacing: 2) {
                    Text("AES-256-GCM Private Vault")
                        .font(.system(size: 14, weight: .bold))
                        .lineLimit(1)
                    Text("Lock sensitive photos, IDs & documents locally")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(.sweeprMutedText)
                        .lineLimit(1)
                }
                Spacer(minLength: 4)
                Text(vaultUnlocked ? "Unlocked" : (rememberedPassword != nil ? "Face ID Ready" : "AES-256"))
                    .font(.system(size: 10, weight: .heavy))
                    .foregroundColor(.sweeprEmerald)
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color.sweeprEmerald.opacity(0.14))
                    .clipShape(Capsule())
            }

            HStack(spacing: 8) {
                Button {
                    guard vm.hasPremium else {
                        onShowPaywall()
                        return
                    }
                    if vaultPassword.count >= 8 {
                        showingFileImporter = true
                    } else if let saved = rememberedPassword, saved.count >= 8 {
                        MobileCloudVault.authenticateBiometrics { success in
                            if success {
                                vaultPassword = saved
                                vaultEntries = MobileCloudVault.list(password: saved)
                                vaultUnlocked = true
                                showingFileImporter = true
                            } else {
                                pendingEncryptAfterModal = true
                                showingPasswordModal = true
                            }
                        }
                    } else {
                        pendingEncryptAfterModal = true
                        showingPasswordModal = true
                    }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "plus.circle.fill")
                        Text("Lock a File in Vault…")
                    }
                    .font(.system(size: 13, weight: .heavy))
                    .frame(maxWidth: .infinity, minHeight: 46)
                    .background(Color.sweeprEmerald)
                    .foregroundColor(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(.plain)

                if !vaultEntries.isEmpty && !vaultUnlocked {
                    Button {
                        if let saved = rememberedPassword, saved.count >= 8 {
                            MobileCloudVault.authenticateBiometrics { success in
                                if success {
                                    vaultPassword = saved
                                    let list = MobileCloudVault.list(password: saved)
                                    vaultEntries = list
                                    vaultUnlocked = list.contains { $0.originalName != nil }
                                    vaultStatus = vaultUnlocked ? "Private Vault unlocked with Face ID." : nil
                                    if !vaultUnlocked {
                                        pendingEncryptAfterModal = false
                                        showingPasswordModal = true
                                    }
                                } else {
                                    pendingEncryptAfterModal = false
                                    showingPasswordModal = true
                                }
                            }
                        } else {
                            pendingEncryptAfterModal = false
                            showingPasswordModal = true
                        }
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: rememberedPassword != nil ? "faceid" : "key.fill")
                            Text(rememberedPassword != nil ? "Face ID" : "Unlock")
                        }
                        .font(.system(size: 12, weight: .heavy))
                        .padding(.horizontal, 12)
                        .frame(minHeight: 46)
                        .background(Color.sweeprPanelAlt)
                        .foregroundColor(.sweeprEmerald)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Color.sweeprLine, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
            }

            if let status = vaultStatus {
                Text(status)
                    .font(.caption.weight(.semibold))
                    .foregroundColor(.sweeprEmerald)
            }

            if vaultEntries.isEmpty {
                Text("No locked files in your Private Vault yet.")
                    .font(.caption)
                    .foregroundColor(.sweeprMutedText)
            } else {
                ForEach(vaultEntries) { entry in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(entry.originalName ?? "Locked Vault Item")
                                .font(.subheadline.weight(.semibold))
                                .lineLimit(1)
                            Text(formatByteCount(entry.encryptedBytes))
                                .font(.caption2)
                                .foregroundColor(.sweeprMutedText)
                        }
                        Spacer()
                        Button("Restore") {
                            guard vaultPassword.count >= 8 else {
                                pendingEncryptAfterModal = false
                                showingPasswordModal = true
                                return
                            }
                            do {
                                let dest = try MobileCloudVault.decryptToRestoredFolder(entry: entry, password: vaultPassword)
                                vaultStatus = "Saved \(dest.lastPathComponent) to your iPhone Files."
                            } catch {
                                vaultStatus = error.localizedDescription
                            }
                        }
                        .font(.caption.weight(.bold))
                        .foregroundColor(.sweeprEmerald)

                        Button(role: .destructive) {
                            try? FileManager.default.removeItem(at: entry.fileURL)
                            vaultEntries = MobileCloudVault.list(password: vaultPassword)
                        } label: {
                            Image(systemName: "trash")
                                .font(.caption)
                                .foregroundColor(.sweeprRose)
                        }
                    }
                    .padding(.vertical, 6)
                }
            }
        }
        .padding(16)
        .sweeprCard(cornerRadius: 18)
    }
}
