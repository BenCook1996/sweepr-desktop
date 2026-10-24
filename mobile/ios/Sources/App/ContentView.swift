import Contacts
import Photos
import RevenueCat
import StoreKit
import SwiftUI
import UIKit

// MARK: - Color Palette (Candidate 5: SWEEPR Signature Hybrid — Obsidian Dark & Mint-Pearl Light)
extension Color {
    static let sweeprEmerald = Color(red: 16 / 255, green: 185 / 255, blue: 129 / 255)
    static let sweeprDarkEmerald = Color(red: 5 / 255, green: 150 / 255, blue: 105 / 255)
    static let cardBackground = Color.sweeprAdaptive(light: 0xFFFFFF, dark: 0x101829)

    /// Emerald 700 (#047857): gradient end stop.
    static let sweeprDeepEmerald = Color(red: 4 / 255, green: 120 / 255, blue: 87 / 255)
    /// Emerald 400 (#34d399): highlights on dark surfaces.
    static let sweeprLightEmerald = Color(red: 52 / 255, green: 211 / 255, blue: 153 / 255)
    /// Cyan (#06b6d4): secondary bioluminescent accent.
    static let sweeprCyan = Color(red: 6 / 255, green: 182 / 255, blue: 212 / 255)
    /// Indigo (#6366f1): Contacts & Apps storage segment accent.
    static let sweeprIndigo = Color(red: 99 / 255, green: 102 / 255, blue: 241 / 255)
    /// Amber (#f59e0b): Battery Care & warning accent.
    static let sweeprAmber = Color(red: 245 / 255, green: 158 / 255, blue: 11 / 255)
    /// Teal (#0d9488): secondary chart / callout colour.
    static let sweeprTeal = Color(red: 13 / 255, green: 148 / 255, blue: 136 / 255)
    /// Mint (#ecfdf5): light-mode tinted surfaces.
    static let sweeprMint = Color(red: 236 / 255, green: 253 / 255, blue: 245 / 255)
    /// Rose (#f43f5e): destructive / trash highlight.
    static let sweeprRose = Color(red: 244 / 255, green: 63 / 255, blue: 94 / 255)

    // Candidate 5 Adaptive Surfaces: Obsidian Dark (#070B14 / #101829) & Mint-Pearl Light (#F4FBF7 / #FFFFFF)
    static let sweeprCanvas = Color.sweeprAdaptive(light: 0xF4FBF7, dark: 0x070B14)
    static let sweeprPanel = Color.sweeprAdaptive(light: 0xFFFFFF, dark: 0x101829)
    static let sweeprPanelAlt = Color.sweeprAdaptive(light: 0xECFDF5, dark: 0x162138)
    static let sweeprAccentText = Color.sweeprAdaptive(light: 0x047857, dark: 0x34D399)
    static let sweeprMutedText = Color.sweeprAdaptive(light: 0x475569, dark: 0x94A3B8)
    static let sweeprLine = Color(UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(sweeprHex: 0x94A3B8, alpha: 0.16)
            : UIColor(sweeprHex: 0xD1FAE5)
    })

    static func sweeprAdaptive(light: UInt32, dark: UInt32) -> Color {
        Color(UIColor { traits in
            UIColor(sweeprHex: traits.userInterfaceStyle == .dark ? dark : light)
        })
    }
}

extension UIColor {
    convenience init(sweeprHex hex: UInt32, alpha: CGFloat = 1) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: alpha
        )
    }
}

// MARK: - Shared Mockup Styling (cards, primary button, sticky dock, wordmark)
extension View {
    /// Rounded panel with a hairline border, as used across the mobile mockups.
    func sweeprCard(cornerRadius: CGFloat = 16) -> some View {
        background(
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .fill(Color.sweeprPanel)
        )
        .overlay(
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .stroke(Color.sweeprLine, lineWidth: 1)
        )
    }
}

/// Full-width emerald gradient pill button.
struct SweeprPrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        SweeprPrimaryButtonBody(configuration: configuration)
    }

    private struct SweeprPrimaryButtonBody: View {
        let configuration: ButtonStyleConfiguration
        @Environment(\.isEnabled) private var isEnabled

        var body: some View {
            configuration.label
                .font(.headline.weight(.heavy))
                .foregroundColor(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 15)
                .padding(.horizontal, 12)
                .background(
                    Capsule().fill(
                        LinearGradient(
                            colors: [.sweeprDarkEmerald, .sweeprEmerald],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                )
                .shadow(color: Color.sweeprEmerald.opacity(isEnabled ? 0.4 : 0), radius: 12, x: 0, y: 6)
                .opacity(isEnabled ? (configuration.isPressed ? 0.85 : 1) : 0.45)
        }
    }
}

/// Sticky bottom action dock (used with `.safeAreaInset(edge: .bottom)`).
struct SweeprBottomDock<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        VStack(spacing: 8) {
            content
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 10)
        .frame(maxWidth: .infinity)
        .background(Color.sweeprPanelAlt.ignoresSafeArea(edges: .bottom))
        .overlay(alignment: .top) {
            Rectangle()
                .fill(Color.sweeprLine)
                .frame(height: 1)
        }
    }
}

/// Two-tone "SWEEPR Cleaner" wordmark.
struct SweeprWordmark: View {
    var fontSize: CGFloat = 17

    var body: some View {
        (Text("SWEEPR ").foregroundColor(.primary) + Text("Cleaner").foregroundColor(.sweeprEmerald))
            .font(.system(size: fontSize, weight: .heavy))
            .lineLimit(1)
            .accessibilityLabel("SWEEPR Cleaner")
    }
}

/// Tinted rounded-square icon badge matching Android's `SweeprIconBadge`.
struct SweeprIconBadge: View {
    let systemName: String
    var tint: Color = .sweeprEmerald
    var size: CGFloat = 38
    var iconSize: CGFloat = 17
    var cornerRadius: CGFloat = 12

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .fill(tint.opacity(0.14))
                .overlay(
                    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                        .stroke(tint.opacity(0.32), lineWidth: 1)
                )
            Image(systemName: systemName)
                .font(.system(size: iconSize, weight: .bold))
                .foregroundColor(tint)
        }
        .frame(width: size, height: size)
    }
}

/// Candidate 5 top header bar with SWEEPR CLEANER wordmark and PRO/FREE badge (theme switcher lives exclusively in Account/Settings).
struct SweeprWordmarkHeaderView: View {
    @ObservedObject var vm: AppViewModel
    let onShowPaywall: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            SweeprLogoView(size: 32)
            HStack(spacing: 5) {
                Text("SWEEPR")
                    .font(.system(size: 16, weight: .heavy))
                    .tracking(0.8)
                    .foregroundColor(.primary)
                Text("CLEANER")
                    .font(.system(size: 16, weight: .heavy))
                    .tracking(0.8)
                    .foregroundColor(.sweeprEmerald)
            }
            .lineLimit(1)

            Spacer()

            // PRO / FREE status pill
            Button {
                onShowPaywall()
            } label: {
                Text(vm.hasPremium ? "PRO" : "FREE")
                    .font(.system(size: 11, weight: .heavy))
                    .tracking(0.6)
                    .foregroundColor(.sweeprEmerald)
                    .padding(.horizontal, 11)
                    .padding(.vertical, 6)
                    .background(Color.sweeprEmerald.opacity(0.14))
                    .clipShape(Capsule())
                    .overlay(
                        Capsule()
                            .stroke(Color.sweeprEmerald.opacity(0.42), lineWidth: 1)
                    )
            }
            .buttonStyle(.plain)
            .accessibilityLabel(vm.hasPremium ? "SWEEPR Pro Active" : "Free Plan, tap to upgrade to Pro")
        }
    }
}

// MARK: - Sparkle Brush Brand Logo (Website Concept 1: Emerald Fill / Dark Mode Mint Glass)
struct SweeprLogoView: View {
    var size: CGFloat = 32
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let isDark = colorScheme == .dark
        Canvas { context, canvasSize in
            let s = min(canvasSize.width, canvasSize.height) / 100.0
            let bgStart = isDark
                ? Color(red: 236 / 255, green: 253 / 255, blue: 245 / 255)
                : Color(red: 16 / 255, green: 185 / 255, blue: 129 / 255)
            let bgEnd = isDark
                ? Color(red: 209 / 255, green: 250 / 255, blue: 229 / 255)
                : Color(red: 4 / 255, green: 120 / 255, blue: 87 / 255)
            let fgPrimary = isDark
                ? Color(red: 5 / 255, green: 150 / 255, blue: 105 / 255)
                : Color.white
            let fgSecondary = isDark
                ? Color(red: 16 / 255, green: 185 / 255, blue: 129 / 255)
                : Color(red: 167 / 255, green: 243 / 255, blue: 208 / 255)
            let slitColor = isDark
                ? Color(red: 209 / 255, green: 250 / 255, blue: 229 / 255)
                : Color(red: 4 / 255, green: 120 / 255, blue: 87 / 255)
            let sparkleColor = isDark
                ? Color(red: 4 / 255, green: 120 / 255, blue: 87 / 255)
                : Color.white

            // 1. Squircle Container
            let bgRect = CGRect(x: 4 * s, y: 4 * s, width: 92 * s, height: 92 * s)
            let bgPath = Path(roundedRect: bgRect, cornerRadius: 22 * s)
            context.fill(
                bgPath,
                with: .linearGradient(
                    Gradient(colors: [bgStart, bgEnd]),
                    startPoint: CGPoint(x: 0, y: 0),
                    endPoint: CGPoint(x: 100 * s, y: 100 * s)
                )
            )

            // 2. Angled Broom Handle
            var handle = Path()
            handle.move(to: CGPoint(x: 76 * s, y: 24 * s))
            handle.addLine(to: CGPoint(x: 53 * s, y: 47 * s))
            context.stroke(handle, with: .color(fgSecondary), style: StrokeStyle(lineWidth: 8 * s, lineCap: .round))

            // 3. Brush Collar
            var collar = Path()
            collar.move(to: CGPoint(x: 42 * s, y: 40 * s))
            collar.addLine(to: CGPoint(x: 60 * s, y: 58 * s))
            collar.addLine(to: CGPoint(x: 55 * s, y: 64 * s))
            collar.addLine(to: CGPoint(x: 36 * s, y: 45 * s))
            collar.closeSubpath()
            context.fill(collar, with: .color(fgPrimary))

            // 4. Sweeping Bristles
            var bristles = Path()
            bristles.move(to: CGPoint(x: 34 * s, y: 48 * s))
            bristles.addLine(to: CGPoint(x: 52 * s, y: 66 * s))
            bristles.addLine(to: CGPoint(x: 38 * s, y: 82 * s))
            bristles.addCurve(
                to: CGPoint(x: 18 * s, y: 62 * s),
                control1: CGPoint(x: 30 * s, y: 78 * s),
                control2: CGPoint(x: 22 * s, y: 70 * s)
            )
            bristles.closeSubpath()
            context.fill(bristles, with: .color(fgPrimary))

            // 5. Bristle Slits
            var slits = Path()
            slits.move(to: CGPoint(x: 34 * s, y: 76 * s))
            slits.addLine(to: CGPoint(x: 43 * s, y: 63 * s))
            slits.move(to: CGPoint(x: 27 * s, y: 69 * s))
            slits.addLine(to: CGPoint(x: 36 * s, y: 56 * s))
            context.stroke(slits, with: .color(slitColor), style: StrokeStyle(lineWidth: 3 * s, lineCap: .round))

            // 6. 4-Point Sparkle
            var star = Path()
            star.move(to: CGPoint(x: 74 * s, y: 56 * s))
            star.addQuadCurve(to: CGPoint(x: 83 * s, y: 65 * s), control: CGPoint(x: 74 * s, y: 65 * s))
            star.addQuadCurve(to: CGPoint(x: 74 * s, y: 74 * s), control: CGPoint(x: 74 * s, y: 65 * s))
            star.addQuadCurve(to: CGPoint(x: 65 * s, y: 65 * s), control: CGPoint(x: 74 * s, y: 65 * s))
            star.addQuadCurve(to: CGPoint(x: 74 * s, y: 56 * s), control: CGPoint(x: 74 * s, y: 65 * s))
            star.closeSubpath()
            context.fill(star, with: .color(sparkleColor))

            // 7. Secondary Sparkle Dot
            let dotRect = CGRect(x: (62 - 3.5) * s, y: (79 - 3.5) * s, width: 7 * s, height: 7 * s)
            context.fill(Path(ellipseIn: dotRect), with: .color(fgSecondary))
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

func formatByteCount(_ bytes: Int64) -> String {
    let formatter = ByteCountFormatter()
    formatter.allowedUnits = [.useBytes, .useKB, .useMB, .useGB]
    formatter.countStyle = .file
    return formatter.string(fromByteCount: bytes)
}

// MARK: - Storage Status
struct StorageInfo {
    let totalBytes: Int64
    let freeBytes: Int64

    var usedBytes: Int64 { max(0, totalBytes - freeBytes) }
    var usedFraction: Double {
        guard totalBytes > 0 else { return 0 }
        return min(1.0, max(0.0, Double(usedBytes) / Double(totalBytes)))
    }

    static func current() -> StorageInfo {
        let home = URL(fileURLWithPath: NSHomeDirectory())
        if let values = try? home.resourceValues(forKeys: [.volumeTotalCapacityKey, .volumeAvailableCapacityForImportantUsageKey]) {
            let total = Int64(values.volumeTotalCapacity ?? 0)
            let free = values.volumeAvailableCapacityForImportantUsage ?? 0
            return StorageInfo(totalBytes: total, freeBytes: free)
        }
        return StorageInfo(totalBytes: 0, freeBytes: 0)
    }
}

// MARK: - Navigation Tabs
enum SweeprNavigationItem: Int, CaseIterable, Identifiable {
    case dashboard = 0
    case swipeReview = 1
    case batteryCare = 2
    case account = 3

    var id: Int { rawValue }

    var title: String {
        switch self {
        case .dashboard: return "Clean"
        case .swipeReview: return "Swipe"
        case .batteryCare: return "Battery & Vault"
        case .account: return "Account"
        }
    }

    var systemImage: String {
        switch self {
        case .dashboard: return "sparkles"
        case .swipeReview: return "rectangle.stack.fill"
        case .batteryCare: return "bolt.shield.fill"
        case .account: return "person.crop.circle"
        }
    }
}

// MARK: - Cleaning Summary (Mockup #10 "Cleaning Complete")
/// Result of a 1-tap Quick Clean, built only from real scan data and storage readings.
struct CleanSummary: Identifiable {
    let id = UUID()
    let removedMediaCount: Int
    /// Sum of the scanner's estimated sizes for the items moved to Recently Deleted.
    let removedBytes: Int64
    let mergedContactGroups: Int
    let usedFractionBefore: Double
    let usedFractionAfter: Double
}

// MARK: - App State / View Model
@MainActor
class AppViewModel: ObservableObject {
    @Published var isScanning = false
    @Published var hasScanned = false
    @Published var scanStatus = ""
    @Published var mediaResult = MediaScanResult()
    @Published var contactGroups: [ContactDuplicateGroup] = []
    @Published var incompleteContacts: [ContactEntry] = []
    @Published var oldCalendarEvents: [OldCalendarEvent] = []
    @Published var selectedMediaIDs: Set<String> = []
    @Published var selectedContactGroupIDs: Set<String> = []
    @Published var selectedIncompleteContactIDs: Set<String> = []
    @Published var selectedCalendarEventIDs: Set<String> = []
    @Published var storage = StorageInfo.current()

    @Published var hasPremium = false
    @Published var hasBatteryCare = false
    @Published var showingPaywall = false
    @Published var subscriptionInfoText = "Free Plan"
    @Published var linkedAccount = AccountService.loadAccount()
    @Published var isWorking = false
    @Published var alertMessage: String? = nil
    /// Set after a successful Quick Clean to present the Cleaning Complete screen.
    @Published var lastCleanSummary: CleanSummary? = nil

    /// While true, success alerts are suppressed because the Cleaning Complete screen reports the result.
    private var isBatchCleaning = false
    private var rcActive: Bool = false
    private var rcBatteryCare: Bool = false
    private static let entitlementIDs = ["premium", "Sweepr Pro", "SWEEPR Cleaner Pro"]
    private static let batteryCareEntitlementIDs = ["battery_care", "Battery Care", "Total Battery Care"]

    private func isServerEntitled(_ acc: LinkedSweeprAccount?) -> Bool {
        guard let acc = acc, acc.isSignedIn, acc.serverActive else { return false }
        let nowSec = Int64(Date().timeIntervalSince1970)
        return acc.expiresAt == 0 || acc.expiresAt > nowSec
    }

    private func isServerBatteryCareEntitled(_ acc: LinkedSweeprAccount?) -> Bool {
        guard isServerEntitled(acc), let acc = acc else { return false }
        return acc.addons.contains {
            $0.caseInsensitiveCompare("battery_care") == .orderedSame ||
            $0.caseInsensitiveCompare("sweepr_secure_bundle") == .orderedSame
        }
    }

    init() {
        let initialPremium = rcActive || isServerEntitled(linkedAccount)
        let initialBatteryCare = rcBatteryCare || isServerBatteryCareEntitled(linkedAccount)
        hasPremium = initialPremium
        hasBatteryCare = initialBatteryCare
        BatteryCareMonitor.shared.enforceEntitlement(initialBatteryCare)
        refreshStorage()
        checkSubscription()
        if linkedAccount.isSignedIn {
            Task { await refreshLinkedAccount() }
        }
    }

    func refreshStorage() {
        storage = StorageInfo.current()
    }

    func refreshSubscriptionStatus() {
        Task {
            if let info = try? await Purchases.shared.customerInfo() {
                applyCustomerInfo(info)
            }
            if linkedAccount.isSignedIn {
                await refreshLinkedAccount()
            } else {
                let batActive = rcBatteryCare || isServerBatteryCareEntitled(linkedAccount)
                hasBatteryCare = batActive
                BatteryCareMonitor.shared.enforceEntitlement(batActive)
            }
        }
    }

    func checkSubscription() {
        Task {
            if let info = try? await Purchases.shared.customerInfo() {
                applyCustomerInfo(info)
            }
            for await info in Purchases.shared.customerInfoStream {
                applyCustomerInfo(info)
            }
        }
    }

    private func applyCustomerInfo(_ info: CustomerInfo) {
        rcActive = Self.entitlementIDs.contains { info.entitlements[$0]?.isActive == true }
        rcBatteryCare = Self.batteryCareEntitlementIDs.contains { info.entitlements[$0]?.isActive == true }
        let serverEntitled = isServerEntitled(linkedAccount)
        let active = rcActive || serverEntitled
        let batActive = rcBatteryCare || isServerBatteryCareEntitled(linkedAccount)
        hasPremium = active
        hasBatteryCare = batActive
        BatteryCareMonitor.shared.enforceEntitlement(batActive)
        if active {
            if let exp = info.entitlements.all.values.first(where: { $0.isActive })?.expirationDate {
                let formatter = DateFormatter()
                formatter.dateStyle = .medium
                subscriptionInfoText = "SWEEPR Cleaner Pro (Renews \(formatter.string(from: exp)))"
            } else if serverEntitled {
                subscriptionInfoText = "SWEEPR Cleaner Pro (Cross-Platform Account Linked)"
            } else {
                subscriptionInfoText = "SWEEPR Cleaner Pro (Active)"
            }
        } else {
            subscriptionInfoText = "Free Plan"
        }
    }

    func scan() async {
        guard !isScanning else { return }
        isScanning = true
        scanStatus = "Scanning photo library…"

        let photoStatus = await PhotoScanner.requestAuthorization()
        if photoStatus == .authorized || photoStatus == .limited {
            mediaResult = await PhotoScanner.scan { status in
                Task { @MainActor in
                    self.scanStatus = status
                }
            }
        }

        scanStatus = "Scanning contacts…"
        let contactsGranted = await ContactsCleaner.requestAccess()
        if contactsGranted {
            let contactsResult = await ContactsCleaner.scanAll()
            contactGroups = contactsResult.duplicateGroups
            incompleteContacts = contactsResult.incompleteContacts
        }

        // Auto-select extras from duplicate and similar groups (keeping Best Shot at index 0) + screenshots
        var autoSelected: Set<String> = []
        for group in mediaResult.duplicateGroups {
            autoSelected.formUnion(group.extras.map(\.id))
        }
        for group in mediaResult.similarGroups {
            autoSelected.formUnion(group.extras.map(\.id))
        }
        autoSelected.formUnion(mediaResult.screenshots.map(\.id))

        selectedMediaIDs = autoSelected
        selectedContactGroupIDs = Set(contactGroups.map(\.id))
        selectedIncompleteContactIDs = Set(incompleteContacts.map(\.id))
        hasScanned = true
        isScanning = false
        scanStatus = ""
        refreshStorage()
    }

    func toggleMediaSelection(id: String) {
        if selectedMediaIDs.contains(id) {
            selectedMediaIDs.remove(id)
        } else {
            selectedMediaIDs.insert(id)
        }
    }

    func toggleContactGroupSelection(id: String) {
        if selectedContactGroupIDs.contains(id) {
            selectedContactGroupIDs.remove(id)
        } else {
            selectedContactGroupIDs.insert(id)
        }
    }

    func toggleIncompleteContactSelection(id: String) {
        if selectedIncompleteContactIDs.contains(id) {
            selectedIncompleteContactIDs.remove(id)
        } else {
            selectedIncompleteContactIDs.insert(id)
        }
    }

    func toggleCalendarEventSelection(id: String) {
        if selectedCalendarEventIDs.contains(id) {
            selectedCalendarEventIDs.remove(id)
        } else {
            selectedCalendarEventIDs.insert(id)
        }
    }

    func scanOldCalendarEvents() async {
        let granted = await ContactsCleaner.requestCalendarAccess()
        guard granted else { return }
        let events = await ContactsCleaner.scanOldCalendarEvents(olderThanDays: 365)
        oldCalendarEvents = events
        selectedCalendarEventIDs = Set(events.map(\.id))
    }

    func deleteSelectedCalendarEvents() async {
        guard hasPremium else { showingPaywall = true; return }
        guard !selectedCalendarEventIDs.isEmpty else { return }
        isWorking = true
        let ids = Array(selectedCalendarEventIDs)
        do {
            let deleted = try await ContactsCleaner.deleteCalendarEvents(identifiers: ids)
            oldCalendarEvents.removeAll { selectedCalendarEventIDs.contains($0.id) }
            selectedCalendarEventIDs.removeAll()
            alertMessage = "Deleted \(deleted) expired calendar events older than 1 year."
            if deleted > 0 {
                requestAppStoreReview()
            }
        } catch {
            CrashLogger.recordError("DeleteCalendarEvents", error: error)
            alertMessage = "Could not delete calendar events: \(error.localizedDescription)"
        }
        isWorking = false
    }

    func optimizePhotos(
        ids: [String],
        compressQuality: Bool,
        stripGps: Bool,
        deleteOriginals: Bool = false,
        preset: PhotoCompressionPreset = .balanced
    ) async {
        guard hasPremium else { showingPaywall = true; return }
        guard !ids.isEmpty else { return }
        isWorking = true
        var savedBytesTotal: Int64 = 0
        var strippedCount = 0
        var optimizedCount = 0
        for id in ids {
            if let res = try? await PhotoScanner.optimizePhoto(
                assetId: id,
                compressQuality: compressQuality,
                stripGps: stripGps,
                deleteOriginal: deleteOriginals,
                preset: preset
            ) {
                optimizedCount += 1
                savedBytesTotal += res.savedBytes
                if res.gpsStripped {
                    strippedCount += 1
                }
            }
        }
        if deleteOriginals {
            mediaResult = mediaResult.removing(ids: Set(ids))
        }
        isWorking = false
        refreshStorage()
        if optimizedCount > 0 {
            let gpsNote = strippedCount > 0 ? " · Stripped GPS from \(strippedCount) photos" : ""
            alertMessage = "Optimized \(optimizedCount) photos! Saved \(formatByteCount(savedBytesTotal))\(gpsNote)."
            requestAppStoreReview()
        } else {
            alertMessage = "Could not optimize selected photos."
        }
    }

    func selectAllMedia(ids: [String], select: Bool) {
        if select {
            selectedMediaIDs.formUnion(ids)
        } else {
            selectedMediaIDs.subtract(ids)
        }
    }

    func performSmartCleanAll() async {
        guard hasPremium else { showingPaywall = true; return }
        let usedBefore = storage.usedFraction
        let mediaIDsBefore = selectedMediaIDs
        let bytesByID = Dictionary(
            mediaResult.allItems.map { ($0.id, $0.estimatedBytes) },
            uniquingKeysWith: { first, _ in first }
        )

        isBatchCleaning = true
        await deleteSelectedMedia()
        var mergedGroups = 0
        if !selectedContactGroupIDs.isEmpty {
            mergedGroups = await mergeSelectedContacts()
        }
        isBatchCleaning = false

        let removedIDs = mediaIDsBefore.subtracting(selectedMediaIDs)
        guard !removedIDs.isEmpty || mergedGroups > 0 else { return }
        let removedBytes = removedIDs.reduce(Int64(0)) { total, id in
            total + (bytesByID[id] ?? 0)
        }
        lastCleanSummary = CleanSummary(
            removedMediaCount: removedIDs.count,
            removedBytes: removedBytes,
            mergedContactGroups: mergedGroups,
            usedFractionBefore: usedBefore,
            usedFractionAfter: storage.usedFraction
        )
    }

    func deleteSelectedMedia() async {
        guard hasPremium else { showingPaywall = true; return }
        guard !selectedMediaIDs.isEmpty else { return }
        isWorking = true
        let idsToDelete = Array(selectedMediaIDs)
        do {
            try await PhotoScanner.deleteAssets(identifiers: idsToDelete)
            mediaResult = mediaResult.removing(ids: Set(idsToDelete))
            selectedMediaIDs.subtract(idsToDelete)
            if !isBatchCleaning {
                alertMessage = "Moved \(idsToDelete.count) items to Recently Deleted (recoverable for 30 days)."
            }
            requestAppStoreReview()
        } catch {
            CrashLogger.recordError("DeleteSelectedMedia", error: error)
            alertMessage = "Deletion was cancelled or failed."
        }
        isWorking = false
        refreshStorage()
    }

    func deleteSingleMedia(id: String) async {
        guard hasPremium else { showingPaywall = true; return }
        isWorking = true
        do {
            try await PhotoScanner.deleteAssets(identifiers: [id])
            mediaResult = mediaResult.removing(ids: [id])
            selectedMediaIDs.remove(id)
            alertMessage = "Moved item to Recently Deleted."
        } catch {
            CrashLogger.recordError("DeleteSingleMedia", error: error)
            alertMessage = "Item deletion cancelled."
        }
        isWorking = false
        refreshStorage()
    }

    func compressVideo(id: String, preset: VideoCompressionPreset = .balanced) async {
        guard hasPremium else { showingPaywall = true; return }
        isWorking = true
        do {
            let result = try await PhotoScanner.compressVideo(assetId: id, deleteOriginal: true, preset: preset)
            mediaResult = mediaResult.removing(ids: [id])
            selectedMediaIDs.remove(id)
            alertMessage = "Video compressed (\(preset.title))! Saved \(formatByteCount(result.savedBytes)) using hardware encoder."
            requestAppStoreReview()
        } catch {
            CrashLogger.recordError("CompressVideo", error: error)
            alertMessage = error.localizedDescription
        }
        isWorking = false
        refreshStorage()
    }

    @discardableResult
    func mergeSelectedContacts() async -> Int {
        guard hasPremium else { showingPaywall = true; return 0 }
        guard !selectedContactGroupIDs.isEmpty else { return 0 }
        isWorking = true
        var mergedCount = 0
        for group in contactGroups where selectedContactGroupIDs.contains(group.id) {
            do {
                try await ContactsCleaner.merge(group: group)
                mergedCount += 1
            } catch {
                CrashLogger.recordError("MergeContacts", error: error)
            }
        }
        let refreshed = await ContactsCleaner.scanAll()
        contactGroups = refreshed.duplicateGroups
        incompleteContacts = refreshed.incompleteContacts
        selectedContactGroupIDs = Set(contactGroups.map(\.id))
        isWorking = false
        if !isBatchCleaning || mergedCount == 0 {
            alertMessage = "Smart-merged \(mergedCount) duplicate contact groups."
        }
        if mergedCount > 0 {
            requestAppStoreReview()
        }
        return mergedCount
    }

    func deleteSelectedIncompleteContacts() async {
        guard hasPremium else { showingPaywall = true; return }
        guard !selectedIncompleteContactIDs.isEmpty else { return }
        isWorking = true
        let ids = Array(selectedIncompleteContactIDs)
        do {
            let deleted = try await ContactsCleaner.deleteIncompleteContacts(identifiers: ids)
            let refreshed = await ContactsCleaner.scanAll()
            contactGroups = refreshed.duplicateGroups
            incompleteContacts = refreshed.incompleteContacts
            selectedIncompleteContactIDs = Set(incompleteContacts.map(\.id))
            alertMessage = "Removed \(deleted) incomplete contact entries."
        } catch {
            CrashLogger.recordError("DeleteIncompleteContacts", error: error)
            alertMessage = "Could not delete incomplete contacts: \(error.localizedDescription)"
        }
        isWorking = false
    }

    func restorePurchases() async {
        isWorking = true
        do {
            let info = try await Purchases.shared.restorePurchases()
            applyCustomerInfo(info)
            alertMessage = hasPremium ? "Purchases successfully restored!" : "No active subscription found."
        } catch {
            CrashLogger.recordError("RestorePurchases", error: error)
            alertMessage = "Failed to restore: \(error.localizedDescription)"
        }
        isWorking = false
    }

    func sendOtp(email: String) async -> Bool {
        isWorking = true
        defer { isWorking = false }
        do {
            try await AccountService.sendOtp(email: email)
            return true
        } catch {
            CrashLogger.recordError("SendOTP", error: error)
            alertMessage = error.localizedDescription
            return false
        }
    }

    func verifyOtp(email: String, code: String) async -> Bool {
        isWorking = true
        defer { isWorking = false }
        do {
            let linked = try await AccountService.verifyOtp(email: email, code: code)
            linkedAccount = linked
            _ = try? await Purchases.shared.logIn(linked.accountId)
            Purchases.shared.attribution.setEmail(linked.email)
            Purchases.shared.attribution.setAttributes(["project_id": AppConfig.projectId])
            let batActive = rcBatteryCare || isServerBatteryCareEntitled(linkedAccount)
            hasPremium = rcActive || isServerEntitled(linkedAccount)
            hasBatteryCare = batActive
            BatteryCareMonitor.shared.enforceEntitlement(batActive)
            alertMessage = "Signed in as \(linked.email)"
            return true
        } catch {
            CrashLogger.recordError("VerifyOTP", error: error)
            alertMessage = error.localizedDescription
            return false
        }
    }

    func refreshLinkedAccount() async {
        guard linkedAccount.isSignedIn else { return }
        if let updated = try? await AccountService.refreshEntitlement(current: linkedAccount) {
            linkedAccount = updated
            let batActive = rcBatteryCare || isServerBatteryCareEntitled(linkedAccount)
            hasPremium = rcActive || isServerEntitled(linkedAccount)
            hasBatteryCare = batActive
            BatteryCareMonitor.shared.enforceEntitlement(batActive)
        }
    }

    func refreshServerEntitlement() async {
        await refreshLinkedAccount()
    }

    func redeemReferralCode(_ code: String) async {
        isWorking = true
        defer { isWorking = false }
        do {
            linkedAccount = try await AccountService.redeemReferralCode(code, current: linkedAccount)
            alertMessage = "Referral code \(code.uppercased()) applied to your account!"
        } catch {
            alertMessage = error.localizedDescription
        }
    }

    func signOut() {
        linkedAccount = AccountService.clearAccount()
        Task { _ = try? await Purchases.shared.logOut() }
        let batActive = rcBatteryCare || isServerBatteryCareEntitled(linkedAccount)
        hasPremium = rcActive || isServerEntitled(linkedAccount)
        hasBatteryCare = batActive
        BatteryCareMonitor.shared.enforceEntitlement(batActive)
        alertMessage = "Signed out of your SWEEPR Cleaner account."
    }

    func unlinkSweeprAccount() {
        signOut()
    }

    func deleteAccount() async {
        guard linkedAccount.isSignedIn else { return }
        isWorking = true
        do {
            try await AccountService.deleteAccount(current: linkedAccount)
            signOut()
            alertMessage = "Your SWEEPR Cleaner account and associated data have been permanently deleted."
        } catch {
            CrashLogger.recordError("DeleteAccount", error: error)
            alertMessage = "Could not delete account: \(error.localizedDescription)"
        }
        isWorking = false
    }

    func requestAppStoreReview() {
        let defaults = UserDefaults.standard
        let count = defaults.integer(forKey: "sweepr_completed_cleanups") + 1
        defaults.set(count, forKey: "sweepr_completed_cleanups")
        guard count == 2 else { return }
        if let scene = UIApplication.shared.connectedScenes
            .first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene {
            SKStoreReviewController.requestReview(in: scene)
        }
    }
}

// MARK: - Asset Thumbnail View
struct AssetThumbnailView: View {
    let localIdentifier: String
    /// Requested image size in points; larger previews (e.g. Shrink before/after) ask for more pixels.
    var targetSize = CGSize(width: 180, height: 180)
    @State private var image: UIImage? = nil

    var body: some View {
        ZStack {
            if let image = image {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            } else {
                Color.gray.opacity(0.2)
                ProgressView()
            }
        }
        .task(id: localIdentifier) {
            let assets = PHAsset.fetchAssets(withLocalIdentifiers: [localIdentifier], options: nil)
            guard let asset = assets.firstObject else { return }
            let options = PHImageRequestOptions()
            options.deliveryMode = .opportunistic
            options.isNetworkAccessAllowed = false
            PHImageManager.default().requestImage(
                for: asset,
                targetSize: targetSize,
                contentMode: .aspectFill,
                options: options
            ) { result, _ in
                if let result = result {
                    self.image = result
                }
            }
        }
    }
}

// MARK: - Root Adaptive Content View (TabView on iPhone, NavigationSplitView on iPad/Landscape #32)
struct ContentView: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var vm = AppViewModel()
    @State private var selectedTab: SweeprNavigationItem = .dashboard
    @State private var splitSelection: SweeprNavigationItem? = .dashboard
    @State private var showPaywall = false

    private var useSplitNavigation: Bool {
        UIDevice.current.userInterfaceIdiom == .pad || horizontalSizeClass == .regular
    }

    var body: some View {
        Group {
            if useSplitNavigation {
                NavigationSplitView {
                    List(SweeprNavigationItem.allCases, selection: $splitSelection) { item in
                        Label(item.title, systemImage: item.systemImage)
                            .tag(item)
                    }
                    .navigationTitle("SWEEPR Cleaner")
                } detail: {
                    destinationView(for: splitSelection ?? .dashboard)
                }
            } else {
                TabView(selection: $selectedTab) {
                    ForEach(SweeprNavigationItem.allCases) { item in
                        destinationView(for: item)
                            .tabItem {
                                Label(item.title, systemImage: item.systemImage)
                            }
                            .tag(item)
                    }
                }
            }
        }
        .tint(.sweeprEmerald)
        .task {
            BatteryCareMonitor.shared.refresh()
            let photoStatus = PHPhotoLibrary.authorizationStatus(for: .readWrite)
            let contactsStatus = CNContactStore.authorizationStatus(for: .contacts)
            if !vm.hasScanned && !vm.isScanning &&
                (photoStatus == .authorized || photoStatus == .limited || contactsStatus == .authorized) {
                await vm.scan()
            }
        }
        .onChange(of: scenePhase) { newPhase in
            if newPhase == .active {
                vm.refreshSubscriptionStatus()
                BatteryCareMonitor.shared.refresh()
            }
        }
        .sheet(isPresented: Binding(
            get: { showPaywall || vm.showingPaywall },
            set: {
                showPaywall = $0
                vm.showingPaywall = $0
            }
        )) {
            PaywallView(vm: vm)
        }
        .alert(item: Binding<AlertItem?>(
            get: { vm.alertMessage.map { AlertItem(message: $0) } },
            set: { _ in vm.alertMessage = nil }
        )) { item in
            Alert(title: Text("SWEEPR Cleaner"), message: Text(item.message), dismissButton: .default(Text("OK")))
        }
    }

    @ViewBuilder
    private func destinationView(for item: SweeprNavigationItem) -> some View {
        switch item {
        case .dashboard:
            DashboardView(
                vm: vm,
                onShowPaywall: { vm.showingPaywall = true; showPaywall = true },
                onSelectTab: { item in
                    selectedTab = item
                    splitSelection = item
                }
            )
        case .swipeReview:
            SwipeReviewView(vm: vm, onShowPaywall: { vm.showingPaywall = true; showPaywall = true })
        case .batteryCare:
            BatteryCareView(vm: vm, onShowPaywall: { vm.showingPaywall = true; showPaywall = true })
        case .account:
            AccountView(vm: vm, onShowPaywall: { vm.showingPaywall = true; showPaywall = true })
        }
    }
}

struct AlertItem: Identifiable {
    let id = UUID()
    let message: String
}

// MARK: - Candidate 5: 3D Stacked Swipe Photo Deck (SwipeReviewView)
struct SwipeReviewView: View {
    @ObservedObject var vm: AppViewModel
    let onShowPaywall: () -> Void
    @SceneStorage("sweepr_swipe_index") private var currentIndex = 0
    @State private var selectedFilter: String = "All Media"
    @State private var offset: CGSize = .zero
    @State private var history: [(index: Int, id: String, wasSelected: Bool)] = []

    private static let monthFormatter: DateFormatter = {
        let df = DateFormatter()
        df.dateFormat = "MMM yyyy"
        return df
    }()

    private static let detailDateFormatter: DateFormatter = {
        let df = DateFormatter()
        df.dateStyle = .medium
        df.timeStyle = .short
        return df
    }()

    private var monthBuckets: [(key: String, items: [MediaItem])] {
        var groups: [String: [MediaItem]] = [:]
        var order: [String] = []
        for item in vm.mediaResult.allItems {
            let key = Self.monthFormatter.string(from: item.creationDate)
            if groups[key] == nil {
                order.append(key)
                groups[key] = []
            }
            groups[key]?.append(item)
        }
        return order.map { ($0, groups[$0] ?? []) }
    }

    private var filterOptions: [(key: String, label: String, count: Int)] {
        var list: [(String, String, Int)] = [
            ("All Media", "All Media", vm.mediaResult.allItems.count)
        ]
        let shotCount = vm.mediaResult.allItems.filter { $0.isScreenshot }.count
        if shotCount > 0 {
            list.append(("Screenshots", "Screenshots", shotCount))
        }
        let videoCount = vm.mediaResult.allItems.filter { $0.isVideo }.count
        if videoCount > 0 {
            list.append(("Videos", "Videos", videoCount))
        }
        for bucket in monthBuckets {
            list.append((bucket.key, bucket.key, bucket.items.count))
        }
        return list
    }

    private var filteredItems: [MediaItem] {
        switch selectedFilter {
        case "All Media":
            return vm.mediaResult.allItems
        case "Screenshots":
            return vm.mediaResult.allItems.filter { $0.isScreenshot }
        case "Videos":
            return vm.mediaResult.allItems.filter { $0.isVideo }
        default:
            return monthBuckets.first(where: { $0.key == selectedFilter })?.items ?? vm.mediaResult.allItems
        }
    }

    private var markedCount: Int {
        vm.selectedMediaIDs.count
    }

    private var markedBytes: Int64 {
        vm.mediaResult.allItems
            .filter { vm.selectedMediaIDs.contains($0.id) }
            .reduce(0) { $0 + $1.estimatedBytes }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.sweeprCanvas.ignoresSafeArea()

                VStack(spacing: 12) {
                    // Top Header Bar with PRO/FREE Badge (Undo is at bottom-center)
                    HStack(spacing: 10) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Swipe Photo Deck")
                                .font(.system(size: 19, weight: .heavy))
                                .foregroundColor(.primary)
                            Text(
                                filteredItems.isEmpty
                                    ? "Month-by-month photo & video review"
                                    : "\(min(currentIndex + 1, filteredItems.count)) of \(filteredItems.count) in \(selectedFilter)"
                            )
                            .font(.caption)
                            .foregroundColor(.sweeprMutedText)
                        }
                        Spacer()

                        Button {
                            onShowPaywall()
                        } label: {
                            Text(vm.hasPremium ? "PRO" : "FREE")
                                .font(.system(size: 11, weight: .heavy))
                                .foregroundColor(.sweeprEmerald)
                                .padding(.horizontal, 11)
                                .padding(.vertical, 6)
                                .background(Color.sweeprEmerald.opacity(0.14))
                                .clipShape(Capsule())
                                .overlay(
                                    Capsule().stroke(Color.sweeprEmerald.opacity(0.42), lineWidth: 1)
                                )
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 8)

                    if vm.mediaResult.allItems.isEmpty {
                        emptyDeckState
                    } else {
                        // Horizontal Filter & Month Capsules
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(filterOptions, id: \.key) { option in
                                    let isSelected = selectedFilter == option.key
                                    Button {
                                        withAnimation(.easeInOut(duration: 0.18)) {
                                            selectedFilter = option.key
                                            currentIndex = 0
                                            offset = .zero
                                        }
                                    } label: {
                                        Text("\(option.label) (\(option.count))")
                                            .font(.system(size: 12, weight: .bold))
                                            .foregroundColor(isSelected ? .white : .sweeprMutedText)
                                            .padding(.horizontal, 12)
                                            .padding(.vertical, 7)
                                            .background(isSelected ? Color.sweeprEmerald : Color.sweeprPanel)
                                            .clipShape(Capsule())
                                            .overlay(
                                                Capsule()
                                                    .stroke(isSelected ? Color.sweeprEmerald : Color.sweeprLine, lineWidth: 1)
                                            )
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                            .padding(.horizontal, 16)
                        }

                        if currentIndex >= filteredItems.count {
                            deckCompletedState
                        } else {
                            let item = filteredItems[currentIndex]

                            // 3D 3-Card Stacked Photo Deck
                            ZStack {
                                // Back Card (currentIndex + 2)
                                if currentIndex + 2 < filteredItems.count {
                                    let backItem = filteredItems[currentIndex + 2]
                                    AssetThumbnailView(localIdentifier: backItem.id, targetSize: CGSize(width: 420, height: 540))
                                        .frame(maxWidth: .infinity, maxHeight: 380)
                                        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                                        .overlay(
                                            RoundedRectangle(cornerRadius: 24, style: .continuous)
                                                .stroke(Color.sweeprLine, lineWidth: 1)
                                        )
                                        .scaleEffect(0.88)
                                        .offset(y: 22)
                                        .opacity(0.42)
                                        .allowsHitTesting(false)
                                }

                                // Middle Card (currentIndex + 1)
                                if currentIndex + 1 < filteredItems.count {
                                    let midItem = filteredItems[currentIndex + 1]
                                    AssetThumbnailView(localIdentifier: midItem.id, targetSize: CGSize(width: 520, height: 680))
                                        .frame(maxWidth: .infinity, maxHeight: 380)
                                        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                                        .overlay(
                                            RoundedRectangle(cornerRadius: 24, style: .continuous)
                                                .stroke(Color.sweeprLine, lineWidth: 1)
                                        )
                                        .scaleEffect(0.94)
                                        .offset(y: 11)
                                        .opacity(0.72)
                                        .allowsHitTesting(false)
                                }

                                // Active Front Card
                                ZStack {
                                    AssetThumbnailView(localIdentifier: item.id, targetSize: CGSize(width: 720, height: 960))
                                        .frame(maxWidth: .infinity, maxHeight: 380)
                                        .clipped()

                                    // Top & Bottom Gradient Scrim
                                    LinearGradient(
                                        stops: [
                                            .init(color: Color.black.opacity(0.45), location: 0.0),
                                            .init(color: .clear, location: 0.28),
                                            .init(color: .clear, location: 0.58),
                                            .init(color: Color.black.opacity(0.82), location: 1.0)
                                        ],
                                        startPoint: .top,
                                        endPoint: .bottom
                                    )

                                    // Top Metadata Overlay Pills + Bottom Info
                                    VStack {
                                        HStack {
                                            Text("\(formatByteCount(item.estimatedBytes)) · \(item.resolutionLabel)")
                                                .font(.system(size: 11, weight: .bold))
                                                .foregroundColor(.white)
                                                .padding(.horizontal, 10)
                                                .padding(.vertical, 5)
                                                .background(Color.black.opacity(0.55))
                                                .clipShape(Capsule())

                                            Spacer()

                                            Text(item.isScreenshot ? "Screenshot" : (item.isVideo ? "Video" : (item.isBlurry ? "Blurry Shot" : "Photo")))
                                                .font(.system(size: 11, weight: .bold))
                                                .foregroundColor(.sweeprLightEmerald)
                                                .padding(.horizontal, 10)
                                                .padding(.vertical, 5)
                                                .background(Color.sweeprEmerald.opacity(0.24))
                                                .clipShape(Capsule())
                                                .overlay(
                                                    Capsule().stroke(Color.sweeprEmerald.opacity(0.5), lineWidth: 1)
                                                )
                                        }

                                        Spacer()

                                        VStack(alignment: .leading, spacing: 8) {
                                            Text(Self.detailDateFormatter.string(from: item.creationDate))
                                                .font(.system(size: 14, weight: .heavy))
                                                .foregroundColor(.white)
                                            // Auto-hide swipe hints after 3 swipes
                                            if history.count < 3 {
                                                HStack(spacing: 8) {
                                                    Text("← Swipe Left: Trash")
                                                        .font(.system(size: 10, weight: .bold))
                                                        .foregroundColor(Color(red: 253 / 255, green: 164 / 255, blue: 175 / 255))
                                                        .padding(.horizontal, 9)
                                                        .padding(.vertical, 4)
                                                        .background(Color.sweeprRose.opacity(0.24))
                                                        .clipShape(Capsule())

                                                    Spacer()

                                                    Text("Swipe Right: Keep →")
                                                        .font(.system(size: 10, weight: .bold))
                                                        .foregroundColor(.sweeprLightEmerald)
                                                        .padding(.horizontal, 9)
                                                        .padding(.vertical, 4)
                                                        .background(Color.sweeprEmerald.opacity(0.24))
                                                        .clipShape(Capsule())
                                                }
                                            }
                                        }
                                    }
                                    .padding(14)

                                    // Dynamic Stamp Overlay During Drag
                                    if offset.width < -45 {
                                        Text("TRASH")
                                            .font(.title2.weight(.black))
                                            .foregroundColor(.sweeprRose)
                                            .padding(.horizontal, 14)
                                            .padding(.vertical, 8)
                                            .background(Color.black.opacity(0.65))
                                            .overlay(
                                                RoundedRectangle(cornerRadius: 10)
                                                    .stroke(Color.sweeprRose, lineWidth: 3)
                                            )
                                            .cornerRadius(10)
                                    } else if offset.width > 45 {
                                        Text("KEEP")
                                            .font(.title2.weight(.black))
                                            .foregroundColor(.sweeprEmerald)
                                            .padding(.horizontal, 14)
                                            .padding(.vertical, 8)
                                            .background(Color.black.opacity(0.65))
                                            .overlay(
                                                RoundedRectangle(cornerRadius: 10)
                                                    .stroke(Color.sweeprEmerald, lineWidth: 3)
                                            )
                                            .cornerRadius(10)
                                    }
                                }
                                .frame(maxWidth: .infinity, maxHeight: 380)
                                .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 24, style: .continuous)
                                        .stroke(Color.sweeprLine, lineWidth: 1)
                                )
                                .shadow(color: Color.black.opacity(0.28), radius: 14, x: 0, y: 8)
                                .offset(offset)
                                .rotationEffect(.degrees(Double(offset.width / 18)))
                                .gesture(
                                    DragGesture()
                                        .onChanged { gesture in
                                            offset = gesture.translation
                                        }
                                        .onEnded { gesture in
                                            if gesture.translation.width > 110 {
                                                withAnimation(.spring(response: 0.25, dampingFraction: 0.8)) {
                                                    offset = CGSize(width: 500, height: 0)
                                                }
                                                keepCurrent(item: item)
                                            } else if gesture.translation.width < -110 {
                                                withAnimation(.spring(response: 0.25, dampingFraction: 0.8)) {
                                                    offset = CGSize(width: -500, height: 0)
                                                }
                                                markForTrash(item: item)
                                            } else {
                                                withAnimation(.spring(response: 0.25, dampingFraction: 0.8)) {
                                                    offset = .zero
                                                }
                                            }
                                        }
                                )
                            }
                            .padding(.horizontal, 16)
                            .padding(.bottom, 10)

                            // Tactile Action Controls (Remove | Undo | Keep)
                            HStack(spacing: 28) {
                                Button {
                                    markForTrash(item: item)
                                } label: {
                                    VStack(spacing: 4) {
                                        ZStack {
                                            Circle()
                                                .fill(Color.sweeprRose.opacity(0.14))
                                                .overlay(Circle().stroke(Color.sweeprRose.opacity(0.45), lineWidth: 1.5))
                                                .frame(width: 56, height: 56)
                                            Image(systemName: "xmark")
                                                .font(.system(size: 20, weight: .black))
                                                .foregroundColor(.sweeprRose)
                                        }
                                        Text("Remove")
                                            .font(.system(size: 11, weight: .bold))
                                            .foregroundColor(.sweeprRose)
                                    }
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("Mark current photo for Trash")

                                Button {
                                    undoLastSwipe()
                                } label: {
                                    VStack(spacing: 4) {
                                        ZStack {
                                            Circle()
                                                .fill(Color.sweeprPanel)
                                                .overlay(Circle().stroke(Color.sweeprLine, lineWidth: 1))
                                                .frame(width: 46, height: 46)
                                            Image(systemName: "arrow.uturn.backward")
                                                .font(.system(size: 16, weight: .bold))
                                                .foregroundColor(history.isEmpty ? .sweeprMutedText.opacity(0.4) : .primary)
                                        }
                                        Text("Undo")
                                            .font(.system(size: 11, weight: .semibold))
                                            .foregroundColor(.sweeprMutedText)
                                    }
                                }
                                .buttonStyle(.plain)
                                .disabled(history.isEmpty)
                                .accessibilityLabel("Undo last swipe")

                                Button {
                                    keepCurrent(item: item)
                                } label: {
                                    VStack(spacing: 4) {
                                        ZStack {
                                            Circle()
                                                .fill(Color.sweeprEmerald.opacity(0.15))
                                                .overlay(Circle().stroke(Color.sweeprEmerald.opacity(0.5), lineWidth: 1.5))
                                                .frame(width: 56, height: 56)
                                            Image(systemName: "checkmark")
                                                .font(.system(size: 20, weight: .black))
                                                .foregroundColor(.sweeprEmerald)
                                        }
                                        Text("Keep")
                                            .font(.system(size: 11, weight: .bold))
                                            .foregroundColor(.sweeprEmerald)
                                    }
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("Keep current photo")
                            }
                            .padding(.top, 4)
                        }
                    }

                    Spacer(minLength: 4)

                    // Sticky Trash Tray Bar + Clear Action
                    if markedCount > 0 {
                        HStack(spacing: 8) {
                            Button {
                                commitMarkedTrash()
                            } label: {
                                HStack(spacing: 8) {
                                    Image(systemName: "trash.fill")
                                        .font(.subheadline.weight(.bold))
                                    Text("Move \(markedCount) Item\(markedCount == 1 ? "" : "s") to Trash · Free \(formatByteCount(markedBytes))")
                                        .font(.subheadline.weight(.heavy))
                                        .lineLimit(1)
                                        .minimumScaleFactor(0.8)
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                                .padding(.horizontal, 14)
                                .background(
                                    LinearGradient(
                                        colors: [.sweeprDarkEmerald, .sweeprEmerald],
                                        startPoint: .leading,
                                        endPoint: .trailing
                                    )
                                )
                                .foregroundColor(.white)
                                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                                .shadow(color: Color.sweeprEmerald.opacity(0.35), radius: 10, x: 0, y: 4)
                            }
                            .disabled(vm.isWorking)

                            Button {
                                vm.selectedMediaIDs.removeAll()
                            } label: {
                                Text("Clear")
                                    .font(.caption.weight(.bold))
                                    .foregroundColor(.sweeprRose)
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 14)
                                    .background(Color.sweeprPanel)
                                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                                            .stroke(Color.sweeprRose.opacity(0.45), lineWidth: 1)
                                    )
                            }
                            .buttonStyle(.plain)
                        }
                        .padding(.horizontal, 16)
                    }
                }
                .padding(.bottom, 10)
            }
            .toolbar(.hidden, for: .navigationBar)
        }
    }

    private var emptyDeckState: some View {
        VStack(spacing: 14) {
            SweeprIconBadge(systemName: "rectangle.stack.fill", tint: .sweeprEmerald, size: 64, iconSize: 28, cornerRadius: 20)
            Text(vm.isScanning ? "Scanning Your Photo Library…" : "Ready to Swipe & Clean")
                .font(.title3.weight(.heavy))
            Text(
                vm.isScanning
                    ? vm.scanStatus
                    : "Scan your photos and videos to review them month by month in a 3D stacked deck."
            )
            .font(.subheadline)
            .foregroundColor(.sweeprMutedText)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 28)

            if vm.isScanning {
                ProgressView()
                    .tint(.sweeprEmerald)
            } else {
                Button {
                    Task { await vm.scan() }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "sparkles")
                        Text("Start Photo Scan")
                    }
                    .font(.subheadline.weight(.heavy))
                    .foregroundColor(.white)
                    .padding(.horizontal, 24)
                    .padding(.vertical, 13)
                    .background(Color.sweeprEmerald)
                    .clipShape(Capsule())
                }
                .accessibilityLabel("Start Scan for Swipe Review")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }

    private var deckCompletedState: some View {
        let keptCount = max(0, filteredItems.count - markedCount)
        return VStack(spacing: 14) {
            SweeprIconBadge(systemName: "checkmark.seal.fill", tint: .sweeprEmerald, size: 64, iconSize: 30, cornerRadius: 20)
            Text("Deck Complete!")
                .font(.title2.weight(.heavy))
            Text(
                markedCount > 0
                    ? "You kept \(keptCount) photos and queued \(markedCount) (\(formatByteCount(markedBytes))) in your Trash Tray."
                    : "You've reviewed and kept all \(filteredItems.count) items in \(selectedFilter)."
            )
            .font(.subheadline)
            .foregroundColor(.sweeprMutedText)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 20)

            Button {
                currentIndex = 0
                history.removeAll()
            } label: {
                Text("Review \(selectedFilter) Again")
                    .font(.subheadline.weight(.bold))
                    .foregroundColor(.sweeprEmerald)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 10)
                    .background(Color.sweeprPanel)
                    .clipShape(Capsule())
                    .overlay(Capsule().stroke(Color.sweeprLine, lineWidth: 1))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }

    private func keepCurrent(item: MediaItem) {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        let prev = vm.selectedMediaIDs.contains(item.id)
        history.append((index: currentIndex, id: item.id, wasSelected: prev))
        vm.selectedMediaIDs.remove(item.id)
        offset = .zero
        currentIndex += 1
    }

    private func markForTrash(item: MediaItem) {
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        let prev = vm.selectedMediaIDs.contains(item.id)
        history.append((index: currentIndex, id: item.id, wasSelected: prev))
        vm.selectedMediaIDs.insert(item.id)
        offset = .zero
        currentIndex += 1
    }

    private func undoLastSwipe() {
        guard let last = history.popLast() else { return }
        UIImpactFeedbackGenerator(style: .rigid).impactOccurred()
        if last.wasSelected {
            vm.selectedMediaIDs.insert(last.id)
        } else {
            vm.selectedMediaIDs.remove(last.id)
        }
        offset = .zero
        currentIndex = last.index
    }

    private func commitMarkedTrash() {
        if vm.hasPremium {
            Task {
                await vm.deleteSelectedMedia()
                if currentIndex >= filteredItems.count {
                    currentIndex = 0
                }
                history.removeAll()
            }
        } else {
            onShowPaywall()
        }
    }
}
