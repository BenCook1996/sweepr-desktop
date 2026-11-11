import Foundation
import RevenueCat
import UIKit

extension Purchases {
    /// Convenience bridge so `Purchases.shared.setEmail(email)` works alongside `Purchases.shared.attribution.setEmail(email)`.
    func setEmail(_ email: String?) {
        attribution.setEmail(email)
    }
}

extension AccountService {
    /// Synchronizes the known cross-device CRM `accountId` and `email` with RevenueCat so
    /// `/webhooks/revenuecat` events carry the real CRM account ID instead of an orphaned `$RCAnonymousID`.
    static func syncRevenueCatIdentity(accountId: String, email: String) {
        guard Purchases.isConfigured else { return }
        let trimmedAccountId = accountId.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)

        Purchases.shared.attribution.setAttributes(["project_id": AppConfig.projectId])

        if !trimmedEmail.isEmpty {
            Purchases.shared.setEmail(trimmedEmail)
        }

        if !trimmedAccountId.isEmpty {
            Task {
                _ = try? await Purchases.shared.logIn(trimmedAccountId)
                if !trimmedEmail.isEmpty {
                    Purchases.shared.setEmail(trimmedEmail)
                }
                Purchases.shared.attribution.setAttributes(["project_id": AppConfig.projectId])
            }
        }
    }

    /// Ensures this iOS device has a registered CRM `accountId` before initiating an App Store purchase
    /// so RevenueCat webhooks always carry a real cross-device CRM account ID.
    static func ensureDeviceRegistered(current: LinkedSweeprAccount) async -> LinkedSweeprAccount {
        if !current.accountId.isEmpty && !current.refreshToken.isEmpty {
            syncRevenueCatIdentity(accountId: current.accountId, email: current.email)
            return current
        }
        let deviceId = current.deviceId.isEmpty ? currentDeviceId() : current.deviceId
        var body: [String: Any] = [
            "device_id": deviceId,
            "device_type": "mobile",
            "platform": "ios",
            "project_id": AppConfig.projectId
        ]
        let trimmedEmail = current.email.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedEmail.isEmpty {
            body["email"] = trimmedEmail
        }
        guard let res = try? await requestJSONInternal(path: "/v1/accounts", method: "POST", body: body) else {
            syncRevenueCatIdentity(accountId: current.accountId, email: current.email)
            return current
        }
        let accountId = (res["account_id"] as? String) ?? current.accountId
        let refreshToken = (res["refresh_token"] as? String) ?? current.refreshToken
        let referralCode = (res["referral_code"] as? String) ?? (
            current.referralCode.isEmpty ? defaultReferralCode(for: deviceId, accountId: accountId) : current.referralCode
        )
        var updated = current
        updated.deviceId = deviceId
        updated.accountId = accountId
        updated.refreshToken = refreshToken
        updated.referralCode = referralCode
        saveAccount(updated)
        syncRevenueCatIdentity(accountId: updated.accountId, email: updated.email)
        return updated
    }
}
