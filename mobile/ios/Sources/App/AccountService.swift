import CryptoKit
import Foundation
import Security
import UIKit

struct LinkedSweeprAccount: Codable, Equatable {
    var accountId: String = ""
    var email: String = ""
    var refreshToken: String = ""
    var deviceId: String = ""
    var serverActive: Bool = false
    var plan: String? = nil
    var expiresAt: Int64 = 0
    var addons: [String] = []
    var referralCode: String = ""
    var redeemedReferralCode: String? = nil
    var signedToken: String? = nil

    var isSignedIn: Bool {
        !accountId.isEmpty && !refreshToken.isEmpty
    }
}

enum AppConfig {
    static let projectId = "cleaner"

    static var websiteURL: String {
        (Bundle.main.object(forInfoDictionaryKey: "SWEEPR_WEBSITE_URL") as? String) ?? "https://sweeprcleaner.com"
    }

    static var supportEmail: String {
        (Bundle.main.object(forInfoDictionaryKey: "SWEEPR_SUPPORT_EMAIL") as? String) ?? "support@sweeprcleaner.com"
    }

    static var apiURL: String {
        if let crmUrl = Bundle.main.object(forInfoDictionaryKey: "SWEEPR_CRM_URL") as? String,
           !crmUrl.isEmpty, !crmUrl.hasPrefix("$(") {
            return crmUrl
        }
        return (Bundle.main.object(forInfoDictionaryKey: "SWEEPR_API_URL") as? String) ?? "https://sweeprcleaner.com"
    }
}

/// On-device crash and diagnostic log capture for Sweepr iOS.
enum CrashLogger {
    private static let maxLogBytes = 256 * 1024

    private static var logFileURL: URL {
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        return dir.appendingPathComponent("sweepr_crash_diagnostics.log")
    }

    static func install() {
        NSSetUncaughtExceptionHandler { exception in
            let stack = exception.callStackSymbols.joined(separator: "\n")
            let entry = """
            [\(ISO8601DateFormatter().string(from: Date()))] UNCAUGHT EXCEPTION: \(exception.name.rawValue)
            Reason: \(exception.reason ?? "Unknown")
            Stack:
            \(stack)
            ----------------------------------------
            """
            CrashLogger.appendEntry(entry)
        }
    }

    static func recordError(_ context: String, error: Error) {
        let entry = "[\(ISO8601DateFormatter().string(from: Date()))] ERROR (\(context)): \(error.localizedDescription)\n"
        appendEntry(entry)
    }

    static func redact(_ text: String) -> String {
        var result = text
        let patterns: [(String, String)] = [
            ("(?i)Bearer\\s+[A-Za-z0-9._~+/-]+=*", "Bearer [REDACTED]"),
            ("\\b(ptk|chk|rtk)_[A-Za-z0-9_-]+", "[REDACTED]"),
            ("[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}", "[REDACTED_EMAIL]")
        ]
        for (pattern, replacement) in patterns {
            if let regex = try? NSRegularExpression(pattern: pattern) {
                let range = NSRange(result.startIndex..<result.endIndex, in: result)
                result = regex.stringByReplacingMatches(in: result, options: [], range: range, withTemplate: replacement)
            }
        }
        return result
    }

    static func appendEntry(_ text: String) {
        let url = logFileURL
        let sanitized = redact(text)
        guard let data = sanitized.data(using: .utf8) else { return }
        if FileManager.default.fileExists(atPath: url.path) {
            let existing = (try? Data(contentsOf: url)) ?? Data()
            var combined = existing + data
            if combined.count > maxLogBytes {
                combined = combined.suffix(maxLogBytes)
            }
            try? combined.write(to: url, options: [.atomic, .completeFileProtection])
        } else {
            let bounded = data.count > maxLogBytes ? data.suffix(maxLogBytes) : data
            try? bounded.write(to: url, options: [.atomic, .completeFileProtection])
        }
    }

    static func readLogs() -> String {
        (try? String(contentsOf: logFileURL, encoding: .utf8)) ?? ""
    }

    static func clearLogs() {
        try? FileManager.default.removeItem(at: logFileURL)
    }
}

enum AccountService {
    static let projectId = AppConfig.projectId
    private static let licensePubKeyB64 = "t04hn-7TfW5RIemEhi4mKbZy6rHRYBO6HxeN5OOIR_8"
    private static let storageKey = "sweepr_linked_account_v1"
    private static let deviceKey = "sweepr_device_id_v1"
    private static let legacyRefreshTokenKey = "sweepr_refresh_token"
    private static let keychainService = "com.sweepr.app.auth"
    private static let keychainAccount = "refresh_token"

    struct VerifiedTokenClaims {
        let expiresAt: Int64
        let plan: String?
        let addons: [String]
        let deviceId: String
        let projectId: String
        let status: String
    }

    private static func saveRefreshTokenToKeychain(_ token: String) {
        let deleteQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount
        ]
        SecItemDelete(deleteQuery as CFDictionary)
        guard !token.isEmpty, let data = token.data(using: .utf8) else { return }
        let addQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]
        SecItemAdd(addQuery as CFDictionary, nil)
    }

    private static func readRefreshTokenFromKeychain() -> String {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess,
              let data = result as? Data,
              let token = String(data: data, encoding: .utf8) else {
            return ""
        }
        return token
    }

    private static func deleteRefreshTokenFromKeychain() {
        let deleteQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount
        ]
        SecItemDelete(deleteQuery as CFDictionary)
    }

    private static func readDeviceIdFromKeychain() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: deviceKey,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess,
              let data = result as? Data,
              let id = String(data: data, encoding: .utf8),
              !id.isEmpty else {
            return nil
        }
        return id
    }

    private static func saveDeviceIdToKeychain(_ deviceId: String) {
        guard !deviceId.isEmpty, let data = deviceId.data(using: .utf8) else { return }
        let deleteQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: deviceKey
        ]
        SecItemDelete(deleteQuery as CFDictionary)
        let addQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: deviceKey,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]
        SecItemAdd(addQuery as CFDictionary, nil)
    }

    static func currentDeviceId() -> String {
        if let existing = readDeviceIdFromKeychain() {
            if UserDefaults.standard.object(forKey: deviceKey) != nil {
                UserDefaults.standard.removeObject(forKey: deviceKey)
            }
            return existing
        }
        if let migrated = UserDefaults.standard.string(forKey: deviceKey), !migrated.isEmpty {
            saveDeviceIdToKeychain(migrated)
            UserDefaults.standard.removeObject(forKey: deviceKey)
            return migrated
        }
        let created = UUID().uuidString
        saveDeviceIdToKeychain(created)
        UserDefaults.standard.removeObject(forKey: deviceKey)
        return created
    }

    static func defaultReferralCode(for deviceId: String, accountId: String = "") -> String {
        let seed = accountId.isEmpty ? deviceId : accountId
        let clean = seed.replacingOccurrences(of: "-", with: "").uppercased()
        let suffix = String(clean.prefix(6))
        return "SWEEPR-\(suffix.isEmpty ? "PRO26" : suffix)"
    }

    static func loadAccount() -> LinkedSweeprAccount {
        let devId = currentDeviceId()
        if let legacyToken = UserDefaults.standard.string(forKey: legacyRefreshTokenKey), !legacyToken.isEmpty {
            if readRefreshTokenFromKeychain().isEmpty {
                saveRefreshTokenToKeychain(legacyToken)
            }
            UserDefaults.standard.removeObject(forKey: legacyRefreshTokenKey)
        } else {
            UserDefaults.standard.removeObject(forKey: legacyRefreshTokenKey)
        }

        guard let data = UserDefaults.standard.data(forKey: storageKey),
              var decoded = try? JSONDecoder().decode(LinkedSweeprAccount.self, from: data) else {
            return LinkedSweeprAccount(
                refreshToken: readRefreshTokenFromKeychain(),
                deviceId: devId,
                referralCode: defaultReferralCode(for: devId)
            )
        }
        if !decoded.refreshToken.isEmpty {
            if readRefreshTokenFromKeychain().isEmpty {
                saveRefreshTokenToKeychain(decoded.refreshToken)
            }
            var sanitized = decoded
            sanitized.refreshToken = ""
            if let cleanData = try? JSONEncoder().encode(sanitized) {
                UserDefaults.standard.set(cleanData, forKey: storageKey)
            }
        }
        decoded.refreshToken = readRefreshTokenFromKeychain()
        decoded.deviceId = devId
        if decoded.referralCode.isEmpty {
            decoded.referralCode = defaultReferralCode(for: decoded.deviceId, accountId: decoded.accountId)
        }
        if let verified = extractVerifiedClaims(
            decoded.signedToken ?? "",
            expectedProject: AccountService.projectId,
            expectedDeviceId: decoded.deviceId
        ) {
            decoded.serverActive = true
            decoded.expiresAt = verified.expiresAt
            decoded.plan = verified.plan
            decoded.addons = verified.addons
        } else {
            decoded.serverActive = false
            decoded.expiresAt = 0
            decoded.plan = nil
            decoded.addons = []
            decoded.signedToken = nil
        }
        return decoded
    }

    static func loadPersisted() -> LinkedSweeprAccount {
        loadAccount()
    }

    static func saveAccount(_ account: LinkedSweeprAccount) {
        UserDefaults.standard.removeObject(forKey: legacyRefreshTokenKey)
        saveRefreshTokenToKeychain(account.refreshToken)
        var sanitized = account
        sanitized.refreshToken = ""
        if let data = try? JSONEncoder().encode(sanitized) {
            UserDefaults.standard.set(data, forKey: storageKey)
        }
    }

    static func clearAccount() -> LinkedSweeprAccount {
        MobileCloudVault.clearRememberedPassword()
        UserDefaults.standard.removeObject(forKey: legacyRefreshTokenKey)
        deleteRefreshTokenFromKeychain()
        let devId = currentDeviceId()
        let cleared = LinkedSweeprAccount(
            deviceId: devId,
            referralCode: defaultReferralCode(for: devId)
        )
        saveAccount(cleared)
        return cleared
    }

    private static func expandBundleAddons(_ raw: [String]) -> [String] {
        var result = raw
        if result.contains(where: { $0.caseInsensitiveCompare("sweepr_secure_bundle") == .orderedSame }) {
            if !result.contains(where: { $0.caseInsensitiveCompare("battery_care") == .orderedSame }) {
                result.append("battery_care")
            }
            if !result.contains(where: { $0.caseInsensitiveCompare("cloud_vault") == .orderedSame }) {
                result.append("cloud_vault")
            }
        }
        return result
    }

    private static func decodeBase64Url(_ raw: String) -> Data? {
        var base64 = raw
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let rem = base64.count % 4
        if rem > 0 {
            base64 += String(repeating: "=", count: 4 - rem)
        }
        return Data(base64Encoded: base64)
    }

    static func extractVerifiedClaims(
        _ token: String,
        expectedProject: String = AccountService.projectId,
        expectedDeviceId: String? = nil
    ) -> VerifiedTokenClaims? {
        let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let parts = trimmed.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3 else { return nil }

        guard let headerData = decodeBase64Url(String(parts[0])),
              let header = (try? JSONSerialization.jsonObject(with: headerData)) as? [String: Any],
              (header["alg"] as? String) == "EdDSA" else {
            return nil
        }

        guard let sigData = decodeBase64Url(String(parts[2])),
              let pubKeyData = decodeBase64Url(licensePubKeyB64),
              let pubKey = try? Curve25519.Signing.PublicKey(rawRepresentation: pubKeyData) else {
            return nil
        }
        let messageData = Data("\(parts[0]).\(parts[1])".utf8)
        guard pubKey.isValidSignature(sigData, for: messageData) else {
            return nil
        }

        guard let payloadData = decodeBase64Url(String(parts[1])),
              let claims = (try? JSONSerialization.jsonObject(with: payloadData)) as? [String: Any] else {
            return nil
        }
        let exp = (claims["exp"] as? NSNumber)?.int64Value ?? 0
        guard Double(exp) > Date().timeIntervalSince1970 else {
            return nil
        }
        let status = (claims["status"] as? String) ?? ""
        guard status == "active" || status == "trialing" else {
            return nil
        }
        let targetDevice = expectedDeviceId ?? currentDeviceId()
        let tokenDevice = ((claims["device_id"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !tokenDevice.isEmpty, tokenDevice == targetDevice else {
            return nil
        }
        let proj = ((claims["project_id"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let rawAddons = (claims["addons"] as? [String]) ?? []
        let expandedAddons = expandBundleAddons(rawAddons)
        let hasBundle = expandedAddons.contains { $0.caseInsensitiveCompare("sweepr_secure_bundle") == .orderedSame }
        guard !proj.isEmpty, (proj == expectedProject || proj == "all" || hasBundle) else {
            return nil
        }
        let plan = (claims["plan"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        return VerifiedTokenClaims(
            expiresAt: exp,
            plan: (plan?.isEmpty == false) ? plan : nil,
            addons: expandedAddons,
            deviceId: tokenDevice,
            projectId: proj,
            status: status
        )
    }

    static func verifyTokenClaimsForProject(
        _ token: String,
        expectedProject: String = AccountService.projectId,
        expectedDeviceId: String? = nil
    ) -> Bool {
        extractVerifiedClaims(token, expectedProject: expectedProject, expectedDeviceId: expectedDeviceId) != nil
    }

    static func sendOtp(email: String) async throws {
        _ = try await requestJSON(
            path: "/v1/account/send-otp",
            method: "POST",
            body: [
                "email": email.trimmingCharacters(in: .whitespacesAndNewlines),
                "project_id": AppConfig.projectId
            ]
        )
    }

    static func verifyOtp(email: String, code: String) async throws -> LinkedSweeprAccount {
        let deviceId = currentDeviceId()
        let deviceLabel = await MainActor.run { UIDevice.current.name }
        let res = try await requestJSON(
            path: "/v1/account/verify-otp",
            method: "POST",
            body: [
                "email": email.trimmingCharacters(in: .whitespacesAndNewlines),
                "code": code.trimmingCharacters(in: .whitespacesAndNewlines),
                "device_id": deviceId,
                "platform": "ios",
                "project_id": AppConfig.projectId,
                "device_label": deviceLabel
            ]
        )
        guard let accountId = res["account_id"] as? String,
              let refreshToken = res["refresh_token"] as? String else {
            throw NSError(domain: "SweeprAccount", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid server response"])
        }
        let rawToken = (res["token"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let verified = extractVerifiedClaims(
            rawToken,
            expectedProject: AccountService.projectId,
            expectedDeviceId: deviceId
        )
        let isActive = verified != nil
        let linked = LinkedSweeprAccount(
            accountId: accountId,
            email: (res["email"] as? String) ?? email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
            refreshToken: refreshToken,
            deviceId: deviceId,
            serverActive: isActive,
            plan: verified?.plan,
            expiresAt: verified?.expiresAt ?? 0,
            addons: verified?.addons ?? [],
            referralCode: (res["referral_code"] as? String) ?? defaultReferralCode(for: deviceId, accountId: accountId),
            signedToken: isActive ? rawToken : nil
        )
        saveAccount(linked)
        return linked
    }

    static func redeemQrPairToken(_ rawInput: String) async throws -> LinkedSweeprAccount {
        var token = rawInput.trimmingCharacters(in: .whitespacesAndNewlines)
        if let url = URL(string: token),
           let comps = URLComponents(url: url, resolvingAgainstBaseURL: false),
           let qTok = comps.queryItems?.first(where: { $0.name == "token" })?.value {
            token = qTok
        }
        let deviceId = currentDeviceId()
        let res = try await requestJSON(
            path: "/api/device-link/redeem",
            method: "POST",
            body: [
                "token": token,
                "device_id": deviceId,
                "device_type": "mobile",
                "device_name": UIDevice.current.name,
                "platform": "ios"
            ]
        )
        let accountId = (res["account_id"] as? String) ?? ""
        let refreshToken = (res["refresh_token"] as? String) ?? ""
        let rawSigned = (res["token"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let verified = extractVerifiedClaims(
            rawSigned,
            expectedProject: AccountService.projectId,
            expectedDeviceId: deviceId
        )
        let isActive = verified != nil
        let linked = LinkedSweeprAccount(
            accountId: accountId,
            email: (res["email"] as? String) ?? "",
            refreshToken: refreshToken,
            deviceId: deviceId,
            serverActive: isActive,
            plan: verified?.plan,
            expiresAt: verified?.expiresAt ?? 0,
            addons: verified?.addons ?? [],
            referralCode: defaultReferralCode(for: deviceId, accountId: accountId),
            signedToken: isActive ? rawSigned : nil
        )
        saveAccount(linked)
        return linked
    }

    static func approveDesktopQrChallenge(_ rawChallenge: String, current: LinkedSweeprAccount) async throws {
        var challenge = rawChallenge.trimmingCharacters(in: .whitespacesAndNewlines)
        if let url = URL(string: challenge),
           let comps = URLComponents(url: url, resolvingAgainstBaseURL: false),
           let qCh = comps.queryItems?.first(where: { $0.name == "challenge" || $0.name == "challenge_id" })?.value {
            challenge = qCh
        }
        _ = try await requestJSON(
            path: "/api/device-link/approve",
            method: "POST",
            body: [
                "challenge_id": challenge
            ],
            bearerToken: current.refreshToken
        )
    }

    static func refreshEntitlement(current: LinkedSweeprAccount) async throws -> LinkedSweeprAccount {
        guard current.isSignedIn else { return current }
        let res: [String: Any]
        do {
            res = try await requestJSON(
                path: "/v1/entitlement",
                method: "POST",
                body: [
                    "device_id": current.deviceId,
                    "device_type": "mobile",
                    "project_id": AppConfig.projectId
                ],
                bearerToken: current.refreshToken
            )
        } catch let err as NSError where err.domain == "SweeprAccount" && (err.code == 401 || err.code == 403) {
            var revoked = current
            revoked.serverActive = false
            revoked.expiresAt = 0
            revoked.addons = []
            revoked.signedToken = nil
            saveAccount(revoked)
            return revoked
        }
        let rawToken = (res["token"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let verified = extractVerifiedClaims(
            rawToken,
            expectedProject: AccountService.projectId,
            expectedDeviceId: current.deviceId
        )
        let isActive = verified != nil
        var updated = current
        if let email = res["email"] as? String, !email.isEmpty {
            updated.email = email
        }
        updated.serverActive = isActive
        updated.signedToken = isActive ? rawToken : nil
        updated.plan = verified?.plan
        updated.addons = verified?.addons ?? []
        updated.expiresAt = verified?.expiresAt ?? 0
        saveAccount(updated)
        return updated
    }

    static func redeemReferralCode(_ code: String, current: LinkedSweeprAccount) async throws -> LinkedSweeprAccount {
        let trimmed = code.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard trimmed.count >= 4 else {
            throw NSError(domain: "SweeprAccount", code: 400, userInfo: [NSLocalizedDescriptionKey: "Please enter a valid referral code."])
        }
        guard trimmed != current.referralCode.uppercased() else {
            throw NSError(domain: "SweeprAccount", code: 400, userInfo: [NSLocalizedDescriptionKey: "You cannot redeem your own referral code."])
        }

        _ = try await requestJSON(
            path: "/v1/referral/apply",
            method: "POST",
            body: [
                "code": trimmed,
                "referral_code": trimmed,
                "device_id": current.deviceId,
                "account_id": current.accountId
            ],
            bearerToken: current.refreshToken
        )

        var updated = current
        updated.redeemedReferralCode = trimmed
        saveAccount(updated)
        if let refreshed = try? await refreshEntitlement(current: updated) {
            return refreshed
        }
        return updated
    }

    static func deleteAccount(current: LinkedSweeprAccount) async throws {
        _ = try await requestJSON(
            path: "/v1/account",
            method: "DELETE",
            body: [
                "device_id": current.deviceId
            ],
            bearerToken: current.refreshToken
        )
        _ = clearAccount()
    }

    private static func requestJSON(
        path: String,
        method: String,
        body: [String: Any],
        bearerToken: String? = nil
    ) async throws -> [String: Any] {
        let base = AppConfig.apiURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let url = URL(string: "\(base)\(path)") else {
            throw NSError(domain: "SweeprAccount", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid API URL"])
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 10
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(AppConfig.projectId, forHTTPHeaderField: "X-Sweepr-Project")
        if let token = bearerToken, !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        var payload = body
        if payload["project_id"] == nil {
            payload["project_id"] = AppConfig.projectId
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)

        let (data, response) = try await URLSession.shared.data(for: request)
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 500
            let message = (json["error"] as? String) ?? "Request failed (\(statusCode))"
            throw NSError(domain: "SweeprAccount", code: statusCode, userInfo: [NSLocalizedDescriptionKey: message])
        }
        return json
    }
}
