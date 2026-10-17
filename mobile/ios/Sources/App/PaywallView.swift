import RevenueCat
import SwiftUI

typealias PaywallSheetView = PaywallView

enum SubscriptionPlanOption: String, CaseIterable, Identifiable {
    case annual = "annual"
    case monthly = "monthly"

    var id: String { rawValue }

    var fallbackTitle: String {
        switch self {
        case .annual: return "Sweepr Pro Annual"
        case .monthly: return "Sweepr Pro Monthly"
        }
    }

    var fallbackPrice: String {
        switch self {
        case .annual: return "£49.99 / year"
        case .monthly: return "£9.99 / month"
        }
    }

    var fallbackSubtitle: String {
        switch self {
        case .annual: return "Just £4.17/mo · Save 58% · Billed annually (no free trial)"
        case .monthly: return "Flexible monthly billing · Cancel anytime (no free trial)"
        }
    }

    var badgeText: String? {
        switch self {
        case .annual: return "SAVE 58%"
        case .monthly: return nil
        }
    }
}

struct PaywallView: View {
    @ObservedObject var vm: AppViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var packages: [Package] = []
    @State private var selectedPlan: SubscriptionPlanOption = .annual
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
        case .monthly:
            return packages.first(where: {
                $0.packageType == .monthly
                    || $0.identifier.localizedCaseInsensitiveContains("month")
            }) ?? packages.last
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    // Hero Header
                    VStack(spacing: 10) {
                        Image(systemName: "sparkles")
                            .font(.system(size: 56))
                            .foregroundColor(.sweeprEmerald)
                            .padding(.top, 12)

                        Text("Upgrade to Sweepr Pro")
                            .font(.title)
                            .fontWeight(.bold)

                        Text("Reclaim gigabytes of iPhone & iPad storage with on-device duplicate detection, hardware video compression, and smart contact merging.")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal)
                    }

                    // Benefits Checklist
                    VStack(alignment: .leading, spacing: 12) {
                        BenefitRow(icon: "checkmark.circle.fill", text: "1-Click Full Storage Clean Up")
                        BenefitRow(icon: "checkmark.circle.fill", text: "SHA-256 Exact Duplicate & 8×8 dHash Best Shot Finder")
                        BenefitRow(icon: "checkmark.circle.fill", text: "Hardware Video Compression for Videos >50 MB")
                        BenefitRow(icon: "checkmark.circle.fill", text: "Smart Contact Duplicate Merger & Incomplete Cleaner")
                        BenefitRow(icon: "checkmark.circle.fill", text: "Cross-Platform Sweepr Account Sync (Desktop, iOS, Android)")
                    }
                    .padding()
                    .background(Color.cardBackground)
                    .cornerRadius(16)
                    .padding(.horizontal)

                    // Monthly (£9.99/mo) & Annual (£49.99/yr — Save 58%, no free trial) Selector
                    VStack(spacing: 12) {
                        ForEach(SubscriptionPlanOption.allCases) { option in
                            planSelectorCard(option: option)
                        }
                    }
                    .padding(.horizontal)

                    // Primary Subscribe CTA
                    Button {
                        Task { await purchaseSelectedPlan() }
                    } label: {
                        HStack {
                            if isPurchasing {
                                ProgressView()
                                    .tint(.white)
                            } else {
                                Text(
                                    selectedPlan == .annual
                                        ? "Subscribe Annual — \(priceText(for: .annual))"
                                        : "Subscribe Monthly — \(priceText(for: .monthly))"
                                )
                                .fontWeight(.bold)
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.sweeprEmerald)
                        .foregroundColor(.white)
                        .cornerRadius(14)
                    }
                    .disabled(isPurchasing || vm.isWorking)
                    .padding(.horizontal)
                    .accessibilityLabel(
                        selectedPlan == .annual
                            ? "Subscribe to Sweepr Pro Annual for \(priceText(for: .annual)), save 58 percent, no free trial"
                            : "Subscribe to Sweepr Pro Monthly for \(priceText(for: .monthly)), no free trial"
                    )

                    Text("No free trial. Payment will be charged to your Apple ID account at confirmation of purchase. Subscription automatically renews unless cancelled at least 24 hours before the end of the current period.")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 24)

                    // Restore & Legal Footer
                    Button("Restore Previous Purchases") {
                        Task {
                            await vm.restorePurchases()
                            if vm.hasPremium { dismiss() }
                        }
                    }
                    .font(.footnote)
                    .fontWeight(.medium)
                    .foregroundColor(.sweeprEmerald)
                    .accessibilityLabel("Restore Previous Purchases")

                    HStack(spacing: 16) {
                        if let url = URL(string: "\(AppConfig.websiteURL)/privacy") {
                            Link("Privacy Policy", destination: url)
                        }
                        Text("·").foregroundColor(.secondary)
                        if let url = URL(string: "\(AppConfig.websiteURL)/terms") {
                            Link("Terms of Service", destination: url)
                        }
                    }
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .padding(.bottom, 20)
                }
            }
            .navigationTitle("Sweepr Pro")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Close") { dismiss() }
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
                return "\(pkg.localizedPriceString) / year"
            }
            return option.fallbackPrice
        case .monthly:
            if let pkg = packages.first(where: {
                $0.packageType == .monthly
                    || $0.identifier.localizedCaseInsensitiveContains("month")
            }) {
                return "\(pkg.localizedPriceString) / month"
            }
            return option.fallbackPrice
        }
    }

    private func planSelectorCard(option: SubscriptionPlanOption) -> some View {
        let isSelected = selectedPlan == option
        return Button {
            selectedPlan = option
        } label: {
            HStack(spacing: 12) {
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.title2)
                    .foregroundColor(isSelected ? .sweeprEmerald : .secondary)

                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text(option.fallbackTitle)
                            .font(.headline)
                            .foregroundColor(.primary)
                        if let badge = option.badgeText {
                            Text(badge)
                                .font(.system(size: 10, weight: .bold))
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.sweeprEmerald)
                                .foregroundColor(.white)
                                .cornerRadius(4)
                        }
                    }
                    Text(option.fallbackSubtitle)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.leading)
                }

                Spacer()

                Text(priceText(for: option))
                    .font(.subheadline)
                    .fontWeight(.bold)
                    .foregroundColor(.sweeprEmerald)
            }
            .padding(16)
            .background(Color.cardBackground)
            .cornerRadius(14)
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .stroke(isSelected ? Color.sweeprEmerald : Color.gray.opacity(0.25), lineWidth: isSelected ? 2 : 1)
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
                vm.checkSubscription()
                dismiss()
            }
        } catch {
            CrashLogger.recordError("Purchase", error: error)
            vm.alertMessage = error.localizedDescription
        }
    }
}

struct BenefitRow: View {
    let icon: String
    let text: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .foregroundColor(.sweeprEmerald)
            Text(text)
                .font(.subheadline)
            Spacer()
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(text)
    }
}
