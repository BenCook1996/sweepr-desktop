import Foundation
import UIKit

struct LinkedSweeprAccount: Codable, Equatable {
    var accountId: String = ""
    var email: String = ""
    var refreshToken: String = ""
    var deviceId: String = ""
    var serverActive: Bool = false
    var plan: String? = nil
    var expiresAt: Date? = nil
    var referralCode: String = ""
    var redeemedReferralCode: String? = nil

    var isSignedIn: Bool {
        !accountId.isEmpty && !refreshToken.isEmpty
    }
}

enum AppConfig {
    static var websiteURL: String {
        (Bundle.main.object(forInfoDictionaryKey: "SWEEPR_WEBSITE_URL") as? String) ?? "https://sweepr.app"
    }

    static var supportEmail: String {
        (Bundle.main.object(forInfoDictionaryKey: "SWEEPR_SUPPORT_EMAIL") as? String) ?? "support@sweepr.app"
    }

    static var apiURL: String {
        (Bundle.main.object(forInfoDictionaryKey: "SWEEPR_API_URL") as? String) ?? "https://api.sweepr.app"
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
            try? data.write(to: url, options: .atomic)
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
        guard let data = UserDefaults.standard.data(forKey: storageKey),
              var decoded = try? JSONDecoder().decode(LinkedSweeprAccount.self, from: data) else {
            return LinkedSweeprAccount(
                deviceId: devId,
                referralCode: defaultReferralCode(for: devId)
            )
        }
        if decoded.deviceId.isEmpty {
            decoded.deviceId = devId
        }
        if decoded.referralCode.isEmpty {
            decoded.referralCode = defaultReferralCode(for: decoded.deviceId, accountId: decoded.accountId)
        }
        return decoded
    }

    static func saveAccount(_ account: LinkedSweeprAccount) {
        if let data = try? JSONEncoder().encode(account) {
            UserDefaults.standard.set(data, forKey: storageKey)
        }
    }

    static func clearAccount() -> LinkedSweeprAccount {
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
        let expiresSec = (res["expires_at"] as? NSNumber)?.doubleValue ?? 0
        let linked = LinkedSweeprAccount(
            accountId: accountId,
            email: (res["email"] as? String) ?? email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
            refreshToken: refreshToken,
            deviceId: deviceId,
            serverActive: (res["active"] as? Bool) ?? false,
            plan: res["plan"] as? String,
            expiresAt: expiresSec > 0 ? Date(timeIntervalSince1970: expiresSec) : nil,
            referralCode: (res["referral_code"] as? String) ?? defaultReferralCode(for: deviceId, accountId: accountId)
        )
        saveAccount(linked)
        return linked
    }

    static func refreshEntitlement(current: LinkedSweeprAccount) async throws -> LinkedSweeprAccount {
        guard current.isSignedIn else { return current }
        let res = try await requestJSON(
            path: "/v1/entitlement",
            method: "POST",
            body: [
                "refresh_token": current.refreshToken,
                "device_id": current.deviceId
            ]
        )
        let expiresSec = (res["expires_at"] as? NSNumber)?.doubleValue ?? 0
        var updated = current
        if let email = res["email"] as? String, !email.isEmpty {
            updated.email = email
        }
        updated.serverActive = (res["active"] as? Bool) ?? false
        updated.plan = res["plan"] as? String
        updated.expiresAt = expiresSec > 0 ? Date(timeIntervalSince1970: expiresSec) : nil
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

        // Attempt server claim if reachable; persist locally either way
        _ = try? await requestJSON(
            path: "/v1/referral/claim",
            method: "POST",
            body: [
                "referral_code": trimmed,
                "device_id": current.deviceId,
                "account_id": current.accountId
            ]
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
                "refresh_token": current.refreshToken,
                "device_id": current.deviceId
            ]
        )
        _ = clearAccount()
    }

    private static func requestJSON(path: String, method: String, body: [String: Any]) async throws -> [String: Any] {
        let base = AppConfig.apiURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let url = URL(string: "\(base)\(path)") else {
            throw NSError(domain: "SweeprAccount", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid API URL"])
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 10
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)
        let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 500
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        guard (200...299).contains(statusCode) else {
            let message = (json["error"] as? String) ?? "Request failed (\(statusCode))"
            throw NSError(domain: "SweeprAccount", code: statusCode, userInfo: [NSLocalizedDescriptionKey: message])
        }
        return json
    }
}
