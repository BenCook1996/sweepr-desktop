import RevenueCat
import SwiftUI

typealias PaywallSheetView = PaywallView

enum SubscriptionPlanOption: String, CaseIterable, Identifiable {
    case annual = "annual"
    case monthly = "monthly"

    var id: String { rawValue }

    var fallbackTitle: String {
        switch self {
        case .annual: return "Annual Plan"
        case .monthly: return "Monthly Plan"
        }
    }

    var fallbackPrice: String {
        switch self {
        case .annual: return "Annual Plan"
        case .monthly: return "Monthly Plan"
        }
    }

    var fallbackSubtitle: String {
        switch self {
        case .annual: return "Save 58% · Billed annually"
        case .monthly: return "Flexible monthly billing · Cancel anytime"
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
    @State private var includeBatteryCare: Bool = false
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
                        SweeprLogoView(size: 72)
                            .padding(.top, 12)

                        Text("Upgrade to SWEEPR Cleaner Pro")
                            .font(.title)
                            .fontWeight(.bold)

                        Text("Reclaim gigabytes of space in one tap — duplicate finder, video shrinker & smart contact merger.")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal)
                    }

                    // Benefits Checklist
                    VStack(alignment: .leading, spacing: 12) {
                        BenefitRow(icon: "checkmark.circle.fill", text: "1-Click Full Storage Clean Up")
                        BenefitRow(icon: "checkmark.circle.fill", text: "Duplicate & Similar Photo Finder (Keeps Your Best Photo)")
                        BenefitRow(icon: "checkmark.circle.fill", text: "Shrink Large Videos Without Losing Quality")
                        BenefitRow(icon: "checkmark.circle.fill", text: "Smart Contact Duplicate Merger & Incomplete Cleaner")
                        BenefitRow(icon: "checkmark.circle.fill", text: "Use Your Account Across Computer, iPhone & Android")
                    }
                    .padding()
                    .sweeprCard(cornerRadius: 18)
                    .padding(.horizontal)

                    // Plan Selector
                    VStack(spacing: 12) {
                        ForEach(SubscriptionPlanOption.allCases) { option in
                            planSelectorCard(option: option)
                        }
                    }
                    .padding(.horizontal)

                    // Optional Battery Care Add-on Order Bump (+20% charm pricing)
                    Button {
                        includeBatteryCare.toggle()
                    } label: {
                        HStack(alignment: .top, spacing: 12) {
                            Image(systemName: includeBatteryCare ? "checkmark.square.fill" : "square")
                                .font(.title3)
                                .foregroundColor(.orange)
                                .padding(.top, 2)
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text("Add Total Battery Care")
                                        .font(.subheadline.weight(.bold))
                                        .foregroundColor(.primary)
                                        .lineLimit(1)
                                    Spacer()
                                    Text(selectedPlan == .annual ? "+£17.99/yr" : "+£2.99/mo")
                                        .font(.subheadline.weight(.heavy))
                                        .foregroundColor(.orange)
                                        .lineLimit(1)
                                        .fixedSize(horizontal: true, vertical: false)
                                }
                                Text("80% unplug reminder, overheat warnings, and 1-tap background cache cool-down.")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                    .multilineTextAlignment(.leading)
                            }
                        }
                        .padding(14)
                        .background(Color.orange.opacity(includeBatteryCare ? 0.14 : 0.07))
                        .cornerRadius(14)
                        .overlay(
                            RoundedRectangle(cornerRadius: 14)
                                .stroke(Color.orange.opacity(0.65), style: StrokeStyle(lineWidth: 1.5, dash: includeBatteryCare ? [] : [5]))
                        )
                    }
                    .buttonStyle(.plain)
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
                            ? "Subscribe to SWEEPR Cleaner Pro Annual for \(priceText(for: .annual)), save 58 percent, no free trial"
                            : "Subscribe to SWEEPR Cleaner Pro Monthly for \(priceText(for: .monthly)), no free trial"
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
            .background(Color.sweeprCanvas.ignoresSafeArea())
            .navigationTitle("SWEEPR Cleaner Pro")
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
                if includeBatteryCare,
                   let addonPkg = packages.first(where: { $0.identifier.localizedCaseInsensitiveContains("battery") }) {
                    _ = try? await Purchases.shared.purchase(package: addonPkg)
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
