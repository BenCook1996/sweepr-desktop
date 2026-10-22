import CommonCrypto
import CryptoKit
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
    @State private var deleteOriginalAfterVault = false
    @State private var vaultEntries: [MobileCloudVault.Entry] = MobileCloudVault.list()
    @State private var vaultStatus: String?
    @State private var showingFileImporter = false

    private var provider: CloudSavings.Provider {
        CloudSavings.Provider(rawValue: providerRaw) ?? .iCloud
    }

    var body: some View {
        let info = CloudSavings.breakdown(result: vm.mediaResult)
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                vaultSection
                headline(info)
                pickers
                breakdown(info)
                actions
            }
            .padding()
        }
        .navigationTitle("Private Vault & Cloud")
        .navigationBarTitleDisplayMode(.inline)
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
                    let entry = try MobileCloudVault.encryptFile(
                        sourceURL: url,
                        password: vaultPassword,
                        deleteOriginal: deleteOriginalAfterVault
                    )
                    vaultEntries = MobileCloudVault.list(password: vaultPassword)
                    vaultStatus = "Locked \(entry.originalName ?? "file") in your Private Vault."
                } catch {
                    vaultStatus = error.localizedDescription
                }
            case .failure(let error):
                vaultStatus = error.localizedDescription
            }
        }
    }

    private func headline(_ info: CloudSavings.Breakdown) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("CLOUDCLEAN · STORAGE BREAKDOWN")
                .font(.caption2.weight(.bold))
                .foregroundColor(.sweeprEmerald)
            Text("\(formatByteCount(info.reclaimBytes)) reclaimable")
                .font(.title.bold())
            Text("With cloud photo backup enabled, every duplicate photo, screenshot, and oversized video on this iPhone also consumes your \(provider.label) storage.")
                .font(.subheadline)
                .foregroundColor(.secondary)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.cardBackground)
        .cornerRadius(20)
    }

    private var pickers: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Where do your photos back up?").font(.headline)
            Picker("Service", selection: $providerRaw) {
                ForEach(CloudSavings.Provider.allCases) { Text($0.label).tag($0.rawValue) }
            }
            .pickerStyle(.segmented)
        }
    }

    private func breakdown(_ info: CloudSavings.Breakdown) -> some View {
        VStack(spacing: 10) {
            row("Duplicates, similar, blurry & screenshots", formatByteCount(info.junkBytes))
            row("Saved by compressing large videos (est.)", formatByteCount(info.compressibleBytes))
            row("Total cloud storage reclaimable", formatByteCount(info.reclaimBytes), highlight: true)
        }
        .padding(16)
        .background(Color.cardBackground)
        .cornerRadius(16)
    }

    private func row(_ label: String, _ value: String, highlight: Bool = false) -> some View {
        HStack {
            Text(label).font(.subheadline)
            Spacer()
            Text(value)
                .font(.subheadline.weight(.semibold))
                .foregroundColor(highlight ? .sweeprEmerald : .primary)
        }
        .accessibilityElement(children: .combine)
    }

    private var actions: some View {
        VStack(spacing: 10) {
            NavigationLink(destination: DuplicateReviewView(vm: vm)) {
                Text("Review duplicates & similar photos")
                    .fontWeight(.bold)
                    .frame(maxWidth: .infinity, minHeight: 48)
                    .background(Color.sweeprEmerald)
                    .foregroundColor(.white)
                    .cornerRadius(14)
            }
            NavigationLink(destination: LargeVideosDetailView(vm: vm, onShowPaywall: onShowPaywall)) {
                Text("Compress large videos").frame(maxWidth: .infinity, minHeight: 48)
            }
            .buttonStyle(.bordered)
            NavigationLink(destination: SingleMediaListView(vm: vm, title: "Screenshots", items: vm.mediaResult.screenshots)) {
                Text("Clear old screenshots").frame(maxWidth: .infinity, minHeight: 48)
            }
            .buttonStyle(.bordered)
            if let url = provider.manageURL {
                Button {
                    openURL(url)
                } label: {
                    Text("Open \(provider.label) storage settings").frame(maxWidth: .infinity, minHeight: 48)
                }
                .buttonStyle(.bordered)
            }
        }
        .tint(.sweeprEmerald)
    }

    private var vaultSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: "lock.shield.fill")
                    .foregroundColor(.sweeprEmerald)
                Text("Private Photo & Document Vault")
                    .font(.headline)
            }
            Text("Lock sensitive photos, IDs, and documents with a password on your iPhone. Only your password can unlock them.")
                .font(.caption)
                .foregroundColor(.secondary)

            SecureField("Choose a vault password (min. 8 characters)", text: $vaultPassword)
                .textFieldStyle(.roundedBorder)
                .onChange(of: vaultPassword) { newValue in
                    if newValue.count >= 8 {
                        vaultEntries = MobileCloudVault.list(password: newValue)
                    }
                }

            Toggle("Remove original after locking in Vault", isOn: $deleteOriginalAfterVault)
                .font(.subheadline)

            Button {
                guard vm.hasPremium else {
                    onShowPaywall()
                    return
                }
                showingFileImporter = true
            } label: {
                Label("Lock a File in Vault…", systemImage: "plus.circle.fill")
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.borderedProminent)
            .tint(.sweeprEmerald)
            .disabled(vaultPassword.count < 8)

            if let status = vaultStatus {
                Text(status)
                    .font(.caption.weight(.semibold))
                    .foregroundColor(.sweeprEmerald)
            }

            if vaultEntries.isEmpty {
                Text("No locked files in your Private Vault yet.")
                    .font(.caption)
                    .foregroundColor(.secondary)
            } else {
                ForEach(vaultEntries) { entry in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(entry.originalName ?? "Locked Vault Item")
                                .font(.subheadline.weight(.semibold))
                            Text(formatByteCount(entry.encryptedBytes))
                                .font(.caption2)
                                .foregroundColor(.secondary)
                        }
                        Spacer()
                        Button("Save to Phone") {
                            do {
                                let dest = try MobileCloudVault.decryptToRestoredFolder(entry: entry, password: vaultPassword)
                                vaultStatus = "Saved \(dest.lastPathComponent) to your iPhone Files."
                            } catch {
                                vaultStatus = error.localizedDescription
                            }
                        }
                        .font(.caption.weight(.semibold))
                        .disabled(vaultPassword.count < 8)

                        Button(role: .destructive) {
                            try? FileManager.default.removeItem(at: entry.fileURL)
                            vaultEntries = MobileCloudVault.list(password: vaultPassword)
                        } label: {
                            Image(systemName: "trash")
                                .font(.caption)
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
        }
        .padding(16)
        .background(Color.cardBackground)
        .cornerRadius(16)
    }
}
