import RevenueCat
import SwiftUI

typealias PaywallSheetView = PaywallView

enum SubscriptionPlanOption: String, CaseIterable, Identifiable {
    case monthly = "monthly"
    case sixMonth = "six_month"
    case annual = "annual"

    var id: String { rawValue }

    private static var currencyCode: String {
        Locale.current.currencyCode ?? "GBP"
    }

    static func formatLocalCurrency(_ amount: Double) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.locale = Locale.current
        formatter.currencyCode = currencyCode
        if currencyCode == "JPY" || currencyCode == "KRW" {
            formatter.maximumFractionDigits = 0
        } else {
            formatter.maximumFractionDigits = 2
            formatter.minimumFractionDigits = 2
        }
        return formatter.string(from: NSNumber(value: amount)) ?? String(format: "£%.2f", amount)
    }

    static var addonYearlyNumericAmount: Double {
        switch currencyCode {
        case "CAD": return 14.99
        case "AUD": return 15.99
        case "NZD": return 17.99
        case "SGD": return 13.99
        case "SEK", "NOK": return 119.99
        case "DKK": return 79.99
        case "PLN": return 44.99
        case "JPY": return 1580
        case "INR": return 899.99
        case "BRL": return 59.99
        default: return 9.99
        }
    }

    static var addonSixMonthNumericAmount: Double {
        switch currencyCode {
        case "CAD": return 9.99
        case "AUD": return 10.99
        case "NZD": return 11.99
        case "SGD": return 8.99
        case "SEK", "NOK": return 79.99
        case "DKK": return 49.99
        case "PLN": return 29.99
        case "JPY": return 980
        case "INR": return 599.99
        case "BRL": return 39.99
        default: return 6.99
        }
    }

    static var addonMonthlyNumericAmount: Double {
        switch currencyCode {
        case "CAD", "AUD": return 2.99
        case "NZD": return 3.49
        case "SGD": return 2.49
        case "SEK", "NOK": return 19.99
        case "DKK": return 14.99
        case "PLN": return 7.99
        case "JPY": return 290
        case "INR": return 169.99
        case "BRL": return 9.99
        default: return 1.99
        }
    }

    static var localizedAddonYearlyPrice: String {
        formatLocalCurrency(addonYearlyNumericAmount)
    }

    var intervalSuffix: String {
        switch self {
        case .monthly: return "/mo"
        case .sixMonth: return "/6mo"
        case .annual: return "/yr"
        }
    }

    var addonNumericAmount: Double {
        switch self {
        case .monthly: return Self.addonMonthlyNumericAmount
        case .sixMonth: return Self.addonSixMonthNumericAmount
        case .annual: return Self.addonYearlyNumericAmount
        }
    }

    var addonIntervalPriceLabel: String {
        "+\(Self.formatLocalCurrency(addonNumericAmount))\(intervalSuffix)"
    }

    var fallbackNumericPrice: Double {
        let code = Self.currencyCode
        switch self {
        case .monthly:
            switch code {
            case "USD": return 11.99
            case "EUR", "CHF": return 10.99
            case "CAD", "SGD": return 15.99
            case "AUD": return 17.99
            case "NZD": return 19.99
            case "SEK", "NOK": return 129.99
            case "DKK": return 84.99
            case "PLN": return 47.99
            case "JPY": return 1880
            case "INR": return 999.99
            case "BRL": return 64.99
            default: return 9.99
            }
        case .sixMonth:
            switch code {
            case "USD": return 47.99
            case "EUR", "CHF": return 44.99
            case "CAD": return 64.99
            case "SGD": return 62.99
            case "AUD": return 74.99
            case "NZD": return 79.99
            case "SEK", "NOK": return 519.99
            case "DKK": return 329.99
            case "PLN": return 189.99
            case "JPY": return 7480
            case "INR": return 3999.99
            case "BRL": return 259.99
            default: return 38.99
            }
        case .annual:
            switch code {
            case "USD": return 64.99
            case "EUR", "CHF": return 59.99
            case "CAD": return 89.99
            case "AUD": return 99.99
            case "NZD": return 109.99
            case "SGD": return 84.99
            case "SEK", "NOK": return 699.99
            case "DKK": return 449.99
            case "PLN": return 259.99
            case "JPY": return 9980
            case "INR": return 5499.99
            case "BRL": return 349.99
            default: return 49.99
            }
        }
    }

    var fallbackTitle: String {
        switch self {
        case .monthly: return "Monthly"
        case .sixMonth: return "6 Months"
        case .annual: return "Yearly"
        }
    }

    var fallbackPrice: String {
        let code = Self.currencyCode
        switch self {
        case .monthly:
            switch code {
            case "USD": return Self.formatLocalCurrency(11.99)
            case "EUR", "CHF": return Self.formatLocalCurrency(10.99)
            case "CAD", "SGD": return Self.formatLocalCurrency(15.99)
            case "AUD": return Self.formatLocalCurrency(17.99)
            case "NZD": return Self.formatLocalCurrency(19.99)
            case "SEK", "NOK": return Self.formatLocalCurrency(129.99)
            case "DKK": return Self.formatLocalCurrency(84.99)
            case "PLN": return Self.formatLocalCurrency(47.99)
            case "JPY": return Self.formatLocalCurrency(1880)
            case "INR": return Self.formatLocalCurrency(999.99)
            case "BRL": return Self.formatLocalCurrency(64.99)
            default: return Self.formatLocalCurrency(9.99)
            }
        case .sixMonth:
            switch code {
            case "USD": return Self.formatLocalCurrency(47.99)
            case "EUR", "CHF": return Self.formatLocalCurrency(44.99)
            case "CAD": return Self.formatLocalCurrency(64.99)
            case "SGD": return Self.formatLocalCurrency(62.99)
            case "AUD": return Self.formatLocalCurrency(74.99)
            case "NZD": return Self.formatLocalCurrency(79.99)
            case "SEK", "NOK": return Self.formatLocalCurrency(519.99)
            case "DKK": return Self.formatLocalCurrency(329.99)
            case "PLN": return Self.formatLocalCurrency(189.99)
            case "JPY": return Self.formatLocalCurrency(7480)
            case "INR": return Self.formatLocalCurrency(3999.99)
            case "BRL": return Self.formatLocalCurrency(259.99)
            default: return Self.formatLocalCurrency(38.99)
            }
        case .annual:
            switch code {
            case "USD": return Self.formatLocalCurrency(64.99)
            case "EUR", "CHF": return Self.formatLocalCurrency(59.99)
            case "CAD": return Self.formatLocalCurrency(89.99)
            case "AUD": return Self.formatLocalCurrency(99.99)
            case "NZD": return Self.formatLocalCurrency(109.99)
            case "SGD": return Self.formatLocalCurrency(84.99)
            case "SEK", "NOK": return Self.formatLocalCurrency(699.99)
            case "DKK": return Self.formatLocalCurrency(449.99)
            case "PLN": return Self.formatLocalCurrency(259.99)
            case "JPY": return Self.formatLocalCurrency(9980)
            case "INR": return Self.formatLocalCurrency(5499.99)
            case "BRL": return Self.formatLocalCurrency(349.99)
            default: return Self.formatLocalCurrency(49.99)
            }
        }
    }

    var savingsPercent: Int {
        let monthlyPrice = SubscriptionPlanOption.monthly.fallbackNumericPrice
        guard monthlyPrice > 0 else { return 0 }
        let months: Double
        switch self {
        case .monthly: return 0
        case .sixMonth: months = 6.0
        case .annual: months = 12.0
        }
        return Int(((1.0 - (fallbackNumericPrice / (monthlyPrice * months))) * 100.0).rounded())
    }

    var fallbackSubtitle: String {
        switch self {
        case .monthly:
            return "Billed monthly · Cancel anytime"
        case .sixMonth:
            let eq = (fallbackNumericPrice / 6.0 * 100.0).rounded(.down) / 100.0
            return "Save \(savingsPercent)% (\(Self.formatLocalCurrency(eq))/mo)"
        case .annual:
            let eq = (fallbackNumericPrice / 12.0 * 100.0).rounded(.down) / 100.0
            return "Save \(savingsPercent)% (\(Self.formatLocalCurrency(eq))/mo)"
        }
    }

    var highlightsSavings: Bool {
        switch self {
        case .monthly: return false
        case .sixMonth, .annual: return true
        }
    }
}

struct PaywallView: View {
    @ObservedObject var vm: AppViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var packages: [Package] = []
    @State private var selectedPlan: SubscriptionPlanOption = .annual
    @State private var includeBatteryAddon = false
    @State private var includeCloudAddon = false
    @State private var showPostPurchaseAddonSheet = false
    @State private var isLoadingPackages = true
    @State private var isPurchasing = false

    func matchedPackage(for plan: SubscriptionPlanOption, in available: [Package]) -> Package? {
        guard !available.isEmpty else { return nil }
        switch plan {
        case .annual:
            return available.first(where: {
                $0.packageType == .annual
                    || $0.identifier.localizedCaseInsensitiveContains("annual")
                    || $0.identifier.localizedCaseInsensitiveContains("year")
            })
        case .sixMonth:
            return available.first(where: {
                $0.packageType == .sixMonth
                    || $0.identifier.localizedCaseInsensitiveContains("six")
                    || $0.identifier.localizedCaseInsensitiveContains("6")
            })
        case .monthly:
            return available.first(where: {
                $0.packageType == .monthly
                    || $0.identifier.localizedCaseInsensitiveContains("month")
            })
        }
    }

    private var matchedPackage: Package? {
        matchedPackage(for: selectedPlan, in: packages)
    }

    private func ctaPriceLabel(for option: SubscriptionPlanOption) -> String {
        let addonCount = (includeBatteryAddon ? 1 : 0) + (includeCloudAddon ? 1 : 0)
        guard addonCount > 0 else {
            return "\(priceText(for: option))\(option.intervalSuffix)"
        }
        let baseNumeric: Double
        if let pkg = matchedPackage(for: option, in: packages) {
            baseNumeric = NSDecimalNumber(decimal: pkg.storeProduct.price).doubleValue
        } else {
            baseNumeric = option.fallbackNumericPrice
        }
        let perAddonNumeric = option.addonNumericAmount
        let combined = baseNumeric + Double(addonCount) * perAddonNumeric
        let formattedCombined = SubscriptionPlanOption.formatLocalCurrency(combined)
        return "\(formattedCombined)\(option.intervalSuffix)"
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    // Brand Pill
                    HStack(spacing: 6) {
                        Circle()
                            .fill(Color.sweeprEmerald)
                            .frame(width: 6, height: 6)
                        Text("SWEEPR Pro")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundColor(.sweeprAccentText)
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(
                        Capsule()
                            .fill(Color.sweeprEmerald.opacity(0.12))
                            .overlay(Capsule().stroke(Color.sweeprEmerald.opacity(0.3), lineWidth: 1))
                    )

                    // Headline & Subtitle
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Clean & speed up in 1 click")
                            .font(.system(size: 22, weight: .heavy))
                            .foregroundColor(.primary)
                        Text("Choose a plan below, or save \(SubscriptionPlanOption.annual.savingsPercent)% with Yearly. Cancel anytime.")
                            .font(.system(size: 13.5))
                            .foregroundColor(.secondary)
                    }

                    // 3-Plan Radio Grid (Concept A / W3)
                    HStack(spacing: 8) {
                        ForEach(SubscriptionPlanOption.allCases) { option in
                            planSelectorCard(option: option)
                        }
                    }

                    // Consistent 9.99/yr Optional Add-on Toggles (confirmed in post-purchase upsell sheet)
                    VStack(spacing: 8) {
                        Toggle(isOn: $includeBatteryAddon) {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Battery Health Saver")
                                        .font(.system(size: 13, weight: .bold))
                                        .foregroundColor(.primary)
                                    Text("80% charge reminder & overheating protection")
                                        .font(.system(size: 11))
                                        .foregroundColor(.secondary)
                                }
                                Spacer()
                                Text(selectedPlan.addonIntervalPriceLabel)
                                    .font(.system(size: 12, weight: .heavy, design: .monospaced))
                                    .foregroundColor(.sweeprEmerald)
                            }
                        }
                        .tint(.sweeprEmerald)
                        .padding(10)
                        .sweeprCard(cornerRadius: 12)

                        Toggle(isOn: $includeCloudAddon) {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Private File Lockbox")
                                        .font(.system(size: 13, weight: .bold))
                                        .foregroundColor(.primary)
                                    Text("AES-256-GCM On-Device Biometric Lockbox")
                                        .font(.system(size: 11))
                                        .foregroundColor(.secondary)
                                }
                                Spacer()
                                Text(selectedPlan.addonIntervalPriceLabel)
                                    .font(.system(size: 12, weight: .heavy, design: .monospaced))
                                    .foregroundColor(.sweeprEmerald)
                            }
                        }
                        .tint(.sweeprEmerald)
                        .padding(10)
                        .sweeprCard(cornerRadius: 12)
                    }

                    // Primary CTA
                    Button {
                        Task { await purchaseSelectedPlan() }
                    } label: {
                        HStack(spacing: 6) {
                            if isPurchasing {
                                ProgressView().tint(.white)
                            } else {
                                Text("Continue for \(ctaPriceLabel(for: selectedPlan))")
                                    .font(.system(size: 15, weight: .bold))
                                    .lineLimit(1)
                                    .minimumScaleFactor(0.8)
                                Text("→")
                                    .font(.system(size: 15, weight: .bold))
                                    .opacity(0.85)
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(
                            LinearGradient(
                                colors: [.sweeprDarkEmerald, .sweeprEmerald],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                        .foregroundColor(.white)
                        .cornerRadius(14)
                    }
                    .disabled(isPurchasing || vm.isWorking)

                    // App Store Review Guideline 3.1.2(c) Mandatory Auto-Renewal Disclosure
                    Text("Payment will be charged to your Apple ID account at confirmation of purchase. Subscription automatically renews unless canceled at least 24 hours before the end of the current billing period. Your account will be charged for renewal within 24 hours prior to the end of the current period. You can manage and cancel your subscriptions by going to your Apple ID Account Settings after purchase.")
                        .font(.system(size: 10.5))
                        .foregroundColor(.secondary)
                        .fixedSize(horizontal: false, vertical: true)

                    Divider()

                    // Quiet Footer with Restore Purchases, Terms of Use (EULA) & Privacy Policy
                    HStack {
                        Button("Restore Purchases") {
                            Task {
                                await vm.restorePurchases()
                                if vm.hasPremium { dismiss() }
                            }
                        }
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(.secondary)

                        Spacer()

                        HStack(spacing: 10) {
                            if let url = URL(string: "\(AppConfig.websiteURL)/terms") {
                                Link("Terms of Use (EULA)", destination: url)
                            }
                            Text("·").foregroundColor(.secondary)
                            if let url = URL(string: "\(AppConfig.websiteURL)/privacy") {
                                Link("Privacy Policy", destination: url)
                            }
                        }
                        .font(.system(size: 11.5))
                        .foregroundColor(.secondary)
                    }
                }
                .padding(22)
            }
            .background(Color.sweeprCanvas.ignoresSafeArea())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundColor(.secondary)
                            .padding(7)
                            .background(Circle().fill(Color.sweeprPanelAlt))
                    }
                    .accessibilityLabel("Close paywall")
                }
            }
            .sheet(isPresented: $showPostPurchaseAddonSheet, onDismiss: {
                vm.checkSubscription()
                dismiss()
            }) {
                postPurchaseAddonSheet
            }
            .task {
                guard Purchases.isConfigured else {
                    isLoadingPackages = false
                    return
                }
                do {
                    let offerings = try await Purchases.shared.offerings()
                    if let current = offerings.current {
                        packages = current.availablePackages
                    }
                } catch {
                    CrashLogger.recordError("PaywallOfferings", error: error)
                }
                isLoadingPackages = false
            }
        }
    }

    private var postPurchaseAddonSheet: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text("Complete Your Selected Add-ons")
                    .font(.system(size: 20, weight: .heavy))
                    .foregroundColor(.primary)
                Text("Your SWEEPR Pro plan is active. Confirm any optional add-on below with a single tap, or skip anytime.")
                    .font(.system(size: 13))
                    .foregroundColor(.secondary)

                if includeBatteryAddon {
                    Button {
                        Task { await purchaseSingleAddon(keyword: "battery") }
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Unlock Battery Health Saver")
                                    .font(.system(size: 14, weight: .bold))
                                Text("80% charge reminder & thermal alerts")
                                    .font(.system(size: 11.5))
                                    .opacity(0.85)
                            }
                            Spacer()
                            Text(selectedPlan.addonIntervalPriceLabel)
                                .font(.system(size: 13, weight: .heavy, design: .monospaced))
                        }
                        .padding(14)
                        .background(Color.sweeprEmerald)
                        .foregroundColor(.white)
                        .cornerRadius(12)
                    }
                    .disabled(isPurchasing)
                }

                if includeCloudAddon {
                    Button {
                        Task { await purchaseSingleAddon(keyword: "cloud") }
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Unlock Private File Lockbox")
                                    .font(.system(size: 14, weight: .bold))
                                Text("AES-256-GCM On-Device Biometric Lockbox")
                                    .font(.system(size: 11.5))
                                    .opacity(0.85)
                            }
                            Spacer()
                            Text(selectedPlan.addonIntervalPriceLabel)
                                .font(.system(size: 13, weight: .heavy, design: .monospaced))
                        }
                        .padding(14)
                        .background(Color.sweeprIndigo)
                        .foregroundColor(.white)
                        .cornerRadius(12)
                    }
                    .disabled(isPurchasing)
                }

                Button("Done") {
                    showPostPurchaseAddonSheet = false
                }
                .font(.system(size: 14, weight: .bold))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .foregroundColor(.secondary)

                Spacer()
            }
            .padding(22)
            .background(Color.sweeprCanvas.ignoresSafeArea())
        }
        .presentationDetents([.medium])
    }

    private func priceText(for option: SubscriptionPlanOption) -> String {
        if let pkg = matchedPackage(for: option, in: packages) {
            return pkg.localizedPriceString
        }
        return option.fallbackPrice
    }

    private func planSelectorCard(option: SubscriptionPlanOption) -> some View {
        let isSelected = selectedPlan == option
        return Button {
            selectedPlan = option
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(option.fallbackTitle)
                        .font(.system(size: 11.5, weight: .bold))
                        .foregroundColor(.primary.opacity(0.85))
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    ZStack {
                        Circle()
                            .stroke(isSelected ? Color.sweeprEmerald : Color.gray.opacity(0.35), lineWidth: 2)
                            .frame(width: 14, height: 14)
                        if isSelected {
                            Circle()
                                .fill(Color.sweeprEmerald)
                                .frame(width: 7, height: 7)
                        }
                    }
                }

                Text(priceText(for: option))
                    .font(.system(size: 20, weight: .black))
                    .foregroundColor(.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)

                Text(option.fallbackSubtitle)
                    .font(.system(size: 10, weight: option.highlightsSavings ? .bold : .medium))
                    .foregroundColor(option.highlightsSavings ? .sweeprAccentText : .secondary)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(11)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(isSelected ? Color.sweeprEmerald.opacity(0.1) : Color.cardBackground)
            .cornerRadius(16)
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .stroke(isSelected ? Color.sweeprEmerald : Color.gray.opacity(0.25), lineWidth: 2)
            )
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(option.fallbackTitle), \(priceText(for: option)), \(option.fallbackSubtitle)")
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }

    private func purchaseSelectedPlan() async {
        guard Purchases.isConfigured, let pkg = matchedPackage else {
            vm.alertMessage = "The selected \(selectedPlan.fallbackTitle) plan is currently unavailable from the App Store. Please choose another plan or use Restore Purchases."
            return
        }
        isPurchasing = true
        defer { isPurchasing = false }
        let linked = await AccountService.ensureDeviceRegistered(current: vm.linkedAccount)
        vm.linkedAccount = linked
        if !linked.accountId.isEmpty {
            _ = try? await Purchases.shared.logIn(linked.accountId)
        }
        if !linked.email.isEmpty {
            Purchases.shared.setEmail(linked.email)
        }
        do {
            let res = try await Purchases.shared.purchase(package: pkg)
            if !res.userCancelled {
                vm.checkSubscription()
                if includeBatteryAddon || includeCloudAddon {
                    showPostPurchaseAddonSheet = true
                } else {
                    dismiss()
                }
            }
        } catch {
            CrashLogger.recordError("Purchase", error: error)
            vm.alertMessage = error.localizedDescription
        }
    }

    private func purchaseSingleAddon(keyword: String) async {
        guard Purchases.isConfigured,
              let addonPkg = packages.first(where: {
                  $0.identifier.localizedCaseInsensitiveContains(keyword)
                      || (keyword == "cloud" && $0.identifier.localizedCaseInsensitiveContains("vault"))
              }) else {
            return
        }
        isPurchasing = true
        defer { isPurchasing = false }
        do {
            let res = try await Purchases.shared.purchase(package: addonPkg)
            if !res.userCancelled {
                if keyword == "battery" { includeBatteryAddon = false }
                if keyword == "cloud" { includeCloudAddon = false }
                vm.checkSubscription()
                if !includeBatteryAddon && !includeCloudAddon {
                    showPostPurchaseAddonSheet = false
                }
            }
        } catch {
            CrashLogger.recordError("PurchaseAddon", error: error)
            vm.alertMessage = error.localizedDescription
        }
    }
}
