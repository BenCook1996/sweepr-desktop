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
    var referralCode: String = ""
    var redeemedReferralCode: String? = nil

    var isSignedIn: Bool {
        !accountId.isEmpty && !refreshToken.isEmpty
    }
}

enum AppConfig {
    static var websiteURL: String {
        (Bundle.main.object(forInfoDictionaryKey: "SWEEPR_WEBSITE_URL") as? String) ?? "https://sweeprcleaner.com"
    }

    static var supportEmail: String {
        (Bundle.main.object(forInfoDictionaryKey: "SWEEPR_SUPPORT_EMAIL") as? String) ?? "support@sweeprcleaner.com"
    }

    static var apiURL: String {
        (Bundle.main.object(forInfoDictionaryKey: "SWEEPR_API_URL") as? String) ?? "https://sweeprcleaner.com"
    }
}

/// On-device crash and diagnostic log capture for Sweepr iOS.
enum CrashLogger {
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

    static func appendEntry(_ text: String) {
        let url = logFileURL
        guard let data = text.data(using: .utf8) else { return }
        if FileManager.default.fileExists(atPath: url.path),
           let handle = try? FileHandle(forWritingTo: url) {
            defer { try? handle.close() }
            _ = try? handle.seekToEnd()
            try? handle.write(contentsOf: data)
        } else {
            try? data.write(to: url, options: [.atomic, .completeFileProtection])
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
    private static let storageKey = "sweepr_linked_account_v1"
    private static let deviceKey = "sweepr_device_id_v1"
    private static let legacyRefreshTokenKey = "sweepr_refresh_token"
    private static let keychainService = "com.sweepr.app.auth"
    private static let keychainAccount = "refresh_token"

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

    static func currentDeviceId() -> String {
        if let existing = UserDefaults.standard.string(forKey: deviceKey), !existing.isEmpty {
            return existing
        }
        let created = UUID().uuidString
        UserDefaults.standard.set(created, forKey: deviceKey)
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
        if decoded.deviceId.isEmpty {
            decoded.deviceId = devId
        }
        if decoded.referralCode.isEmpty {
            decoded.referralCode = defaultReferralCode(for: decoded.deviceId, accountId: decoded.accountId)
        }
        return decoded
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

    static func sendOtp(email: String) async throws {
        _ = try await requestJSON(
            path: "/v1/account/send-otp",
            method: "POST",
            body: ["email": email.trimmingCharacters(in: .whitespacesAndNewlines)]
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
                "device_label": deviceLabel
            ]
        )
        guard let accountId = res["account_id"] as? String,
              let refreshToken = res["refresh_token"] as? String else {
            throw NSError(domain: "SweeprAccount", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid server response"])
        }
        let expiresSec = (res["expires_at"] as? NSNumber)?.int64Value ?? 0
        let linked = LinkedSweeprAccount(
            accountId: accountId,
            email: (res["email"] as? String) ?? email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
            refreshToken: refreshToken,
            deviceId: deviceId,
            serverActive: (res["active"] as? Bool) ?? false,
            plan: res["plan"] as? String,
            expiresAt: max(0, expiresSec),
            referralCode: (res["referral_code"] as? String) ?? defaultReferralCode(for: deviceId, accountId: accountId)
        )
        saveAccount(linked)
        return linked
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
                    "device_type": "mobile"
                ],
                bearerToken: current.refreshToken
            )
        } catch let err as NSError where err.domain == "SweeprAccount" && (err.code == 401 || err.code == 403) {
            var revoked = current
            revoked.serverActive = false
            revoked.expiresAt = 0
            saveAccount(revoked)
            return revoked
        }
        let status = (res["status"] as? String) ?? ""
        let isActive = (res["active"] as? Bool) ?? (status == "active" || status == "trialing")
        let expiresSec = (res["expires_at"] as? NSNumber)?.int64Value ?? 0
        var updated = current
        if let email = res["email"] as? String, !email.isEmpty {
            updated.email = email
        }
        updated.serverActive = isActive
        if let plan = res["plan"] as? String, !plan.isEmpty {
            updated.plan = plan
        }
        updated.expiresAt = max(0, expiresSec)
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
        if let token = bearerToken, !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

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
