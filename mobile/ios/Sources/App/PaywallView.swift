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
        if currencyCode == "JPY" || currencyCode == "INR" || currencyCode == "SEK" || currencyCode == "NOK" || currencyCode == "DKK" {
            formatter.maximumFractionDigits = 0
        } else {
            formatter.maximumFractionDigits = 2
            formatter.minimumFractionDigits = 2
        }
        return formatter.string(from: NSNumber(value: amount)) ?? String(format: "£%.2f", amount)
    }

    static var localizedAddonYearlyPrice: String {
        switch currencyCode {
        case "SEK", "NOK": return formatLocalCurrency(99)
        case "DKK": return formatLocalCurrency(69)
        case "PLN": return formatLocalCurrency(39.99)
        case "JPY": return formatLocalCurrency(1500)
        case "INR": return formatLocalCurrency(799)
        case "BRL": return formatLocalCurrency(49.90)
        default: return formatLocalCurrency(9.99)
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
            case "USD": return Self.formatLocalCurrency(12.99)
            case "EUR", "CHF": return Self.formatLocalCurrency(11.99)
            case "CAD", "SGD": return Self.formatLocalCurrency(16.99)
            case "AUD": return Self.formatLocalCurrency(18.99)
            case "NZD": return Self.formatLocalCurrency(19.99)
            case "SEK", "NOK": return Self.formatLocalCurrency(129)
            case "DKK": return Self.formatLocalCurrency(89)
            case "PLN": return Self.formatLocalCurrency(49.99)
            case "JPY": return Self.formatLocalCurrency(1980)
            case "INR": return Self.formatLocalCurrency(599)
            case "BRL": return Self.formatLocalCurrency(49.90)
            default: return Self.formatLocalCurrency(9.99)
            }
        case .sixMonth:
            switch code {
            case "USD": return Self.formatLocalCurrency(49.99)
            case "EUR", "CHF": return Self.formatLocalCurrency(44.99)
            case "CAD", "SGD": return Self.formatLocalCurrency(64.99)
            case "AUD": return Self.formatLocalCurrency(74.99)
            case "NZD": return Self.formatLocalCurrency(79.99)
            case "SEK", "NOK": return Self.formatLocalCurrency(499)
            case "DKK": return Self.formatLocalCurrency(349)
            case "PLN": return Self.formatLocalCurrency(189.99)
            case "JPY": return Self.formatLocalCurrency(7400)
            case "INR": return Self.formatLocalCurrency(2199)
            case "BRL": return Self.formatLocalCurrency(189.90)
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
            case "SEK", "NOK": return Self.formatLocalCurrency(649)
            case "DKK": return Self.formatLocalCurrency(449)
            case "PLN": return Self.formatLocalCurrency(249.99)
            case "JPY": return Self.formatLocalCurrency(9800)
            case "INR": return Self.formatLocalCurrency(2999)
            case "BRL": return Self.formatLocalCurrency(249.90)
            default: return Self.formatLocalCurrency(49.99)
            }
        }
    }

    var fallbackSubtitle: String {
        let code = Self.currencyCode
        switch self {
        case .monthly:
            return "Billed monthly · Cancel anytime"
        case .sixMonth:
            let eq: Double = (code == "USD") ? 8.33 : ((code == "EUR" || code == "CHF") ? 7.50 : 6.50)
            return "Save 35% (\(Self.formatLocalCurrency(eq))/mo)"
        case .annual:
            let eq: Double = (code == "USD") ? 5.42 : ((code == "EUR" || code == "CHF") ? 5.00 : 4.16)
            return "Save 58% (\(Self.formatLocalCurrency(eq))/mo)"
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
    @State private var isLoadingPackages = true
    @State private var isPurchasing = false

    private var matchedPackage: Package? {
        guard !packages.isEmpty else { return nil }
        switch selectedPlan {
        case .annual:
            return packages.first(where: {
                $0.packageType == .annual
                    || $0.identifier.localizedCaseInsensitiveContains("annual")
                    || $0.identifier.localizedCaseInsensitiveContains("year")
            }) ?? packages.first
        case .sixMonth:
            return packages.first(where: {
                $0.packageType == .sixMonth
                    || $0.identifier.localizedCaseInsensitiveContains("six")
                    || $0.identifier.localizedCaseInsensitiveContains("6")
            }) ?? packages.first
        case .monthly:
            return packages.first(where: {
                $0.packageType == .monthly
                    || $0.identifier.localizedCaseInsensitiveContains("month")
            }) ?? packages.last
        }
    }

    var body: some View {
        NavigationStack {
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
                    Text("Choose a plan below, or save 58% with Yearly. Cancel anytime.")
                        .font(.system(size: 13.5))
                        .foregroundColor(.secondary)
                }

                // 3-Plan Radio Grid (Concept A / W3)
                HStack(spacing: 8) {
                    ForEach(SubscriptionPlanOption.allCases) { option in
                        planSelectorCard(option: option)
                    }
                }

                // Consistent 9.99/yr Optional Add-on Toggles
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
                            Text("+\(SubscriptionPlanOption.localizedAddonYearlyPrice)/yr")
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
                                Text("Private File Lockbox & Cloud Backup")
                                    .font(.system(size: 13, weight: .bold))
                                    .foregroundColor(.primary)
                                Text("Password-locks private photos & backs up automatically")
                                    .font(.system(size: 11))
                                    .foregroundColor(.secondary)
                            }
                            Spacer()
                            Text("+\(SubscriptionPlanOption.localizedAddonYearlyPrice)/yr")
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
                            Text("Continue for \(priceText(for: selectedPlan))")
                                .font(.system(size: 15, weight: .bold))
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

                Divider()

                // Quiet Footer
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
                        if let url = URL(string: "\(AppConfig.websiteURL)/privacy") {
                            Link("Privacy", destination: url)
                        }
                        Text("·").foregroundColor(.secondary)
                        if let url = URL(string: "\(AppConfig.websiteURL)/terms") {
                            Link("Terms", destination: url)
                        }
                    }
                    .font(.system(size: 11.5))
                    .foregroundColor(.secondary)
                }

                Spacer(minLength: 0)
            }
            .padding(22)
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
            .task {
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

    private func priceText(for option: SubscriptionPlanOption) -> String {
        switch option {
        case .annual:
            if let pkg = packages.first(where: {
                $0.packageType == .annual
                    || $0.identifier.localizedCaseInsensitiveContains("annual")
                    || $0.identifier.localizedCaseInsensitiveContains("year")
            }) {
                return pkg.localizedPriceString
            }
            return option.fallbackPrice
        case .sixMonth:
            if let pkg = packages.first(where: {
                $0.packageType == .sixMonth
                    || $0.identifier.localizedCaseInsensitiveContains("six")
                    || $0.identifier.localizedCaseInsensitiveContains("6")
            }) {
                return pkg.localizedPriceString
            }
            return option.fallbackPrice
        case .monthly:
            if let pkg = packages.first(where: {
                $0.packageType == .monthly
                    || $0.identifier.localizedCaseInsensitiveContains("month")
            }) {
                return pkg.localizedPriceString
            }
            return option.fallbackPrice
        }
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
        guard let pkg = matchedPackage else {
            vm.alertMessage = "App Store products are currently unavailable. Please check your connection or use Restore Purchases."
            return
        }
        isPurchasing = true
        defer { isPurchasing = false }
        do {
            let res = try await Purchases.shared.purchase(package: pkg)
            if !res.userCancelled {
                if includeBatteryAddon,
                   let batPkg = packages.first(where: { $0.identifier.localizedCaseInsensitiveContains("battery") }) {
                    _ = try? await Purchases.shared.purchase(package: batPkg)
                }
                if includeCloudAddon,
                   let cloudPkg = packages.first(where: { $0.identifier.localizedCaseInsensitiveContains("cloud") || $0.identifier.localizedCaseInsensitiveContains("vault") }) {
                    _ = try? await Purchases.shared.purchase(package: cloudPkg)
                }
                vm.checkSubscription()
                dismiss()
            }
        } catch {
            CrashLogger.recordError("Purchase", error: error)
            vm.alertMessage = error.localizedDescription
        }
    }
}
