import Contacts
import Photos
import RevenueCat
import StoreKit
import SwiftUI
import UIKit

// MARK: - Color Palette
extension Color {
    static let sweeprEmerald = Color(red: 16 / 255, green: 185 / 255, blue: 129 / 255)
    static let sweeprDarkEmerald = Color(red: 5 / 255, green: 150 / 255, blue: 105 / 255)
    static let cardBackground = Color(UIColor.secondarySystemBackground)

    /// Emerald 700 (#047857): gradient end stop.
    static let sweeprDeepEmerald = Color(red: 4 / 255, green: 120 / 255, blue: 87 / 255)
    /// Emerald 400 (#34d399): highlights on dark surfaces.
    static let sweeprLightEmerald = Color(red: 52 / 255, green: 211 / 255, blue: 153 / 255)
    /// Teal (#0d9488): secondary chart / callout colour.
    static let sweeprTeal = Color(red: 13 / 255, green: 148 / 255, blue: 136 / 255)
    /// Mint (#ecfdf5): light-mode tinted surfaces.
    static let sweeprMint = Color(red: 236 / 255, green: 253 / 255, blue: 245 / 255)
    /// Rose (#f43f5e): draws the eye to the largest saving.
    static let sweeprRose = Color(red: 244 / 255, green: 63 / 255, blue: 94 / 255)

    // Adaptive surfaces matching the approved mockups (dark = slate/navy, light = slate-50/white).
    static let sweeprCanvas = Color.sweeprAdaptive(light: 0xF8FAFC, dark: 0x0B1220)
    static let sweeprPanel = Color.sweeprAdaptive(light: 0xFFFFFF, dark: 0x111A2E)
    static let sweeprPanelAlt = Color.sweeprAdaptive(light: 0xF1F5F9, dark: 0x172238)
    static let sweeprAccentText = Color.sweeprAdaptive(light: 0x047857, dark: 0x34D399)
    static let sweeprMutedText = Color.sweeprAdaptive(light: 0x64748B, dark: 0x94A3B8)
    static let sweeprLine = Color(UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(sweeprHex: 0x94A3B8, alpha: 0.14)
            : UIColor(sweeprHex: 0xE2E8F0)
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
        case .swipeReview: return "hand.draw"
        case .batteryCare: return "battery.100.bolt"
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
        .onChange(of: scenePhase) { newPhase in
            if newPhase == .active {
                vm.refreshSubscriptionStatus()
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

// MARK: - Swipe Review View (Batch-mark & Undo Tinder-style photo cleaner)
struct SwipeReviewView: View {
    @ObservedObject var vm: AppViewModel
    let onShowPaywall: () -> Void
    @SceneStorage("sweepr_swipe_index") private var currentIndex = 0
    @State private var offset: CGSize = .zero
    @State private var history: [(index: Int, id: String, wasSelected: Bool)] = []

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
            VStack(spacing: 12) {
                if vm.mediaResult.allItems.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "hand.draw")
                            .font(.system(size: 48))
                            .foregroundColor(.sweeprEmerald)
                        Text("Scan first to start swipe cleaning.")
                            .foregroundColor(.secondary)
                        Button("Start Scan") {
                            Task { await vm.scan() }
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.sweeprEmerald)
                        .accessibilityLabel("Start Scan for Swipe Review")
                    }
                    .frame(maxHeight: .infinity)
                } else if currentIndex >= vm.mediaResult.allItems.count {
                    VStack(spacing: 14) {
                        Image(systemName: "checkmark.seal.fill")
                            .font(.system(size: 60))
                            .foregroundColor(.sweeprEmerald)
                        Text("You're all caught up!")
                            .font(.title2)
                            .fontWeight(.bold)
                        if markedCount > 0 {
                            Button("Move \(markedCount) Marked (\(formatByteCount(markedBytes))) to Trash") {
                                commitMarkedTrash()
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(.sweeprEmerald)
                        }
                        Button("Review Again") {
                            currentIndex = 0
                            history.removeAll()
                        }
                    }
                    .frame(maxHeight: .infinity)
                } else {
                    let item = vm.mediaResult.allItems[currentIndex]

                    Text("Swipe right to Keep, left to Remove. Nothing is deleted until you tap Move to Trash.")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)

                    HStack {
                        Text("Photo \(currentIndex + 1) of \(vm.mediaResult.allItems.count)")
                            .font(.caption.weight(.semibold))
                            .foregroundColor(.secondary)
                        Spacer()
                        Text("\(formatByteCount(item.estimatedBytes)) · \(item.resolutionLabel)")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    .padding(.horizontal)

                    ZStack {
                        AssetThumbnailView(localIdentifier: item.id)
                            .frame(maxWidth: .infinity, maxHeight: 420)
                            .cornerRadius(20)
                            .shadow(radius: 8)
                            .offset(offset)
                            .rotationEffect(.degrees(Double(offset.width / 20)))
                            .gesture(
                                DragGesture()
                                    .onChanged { gesture in
                                        offset = gesture.translation
                                    }
                                    .onEnded { gesture in
                                        if gesture.translation.width > 120 {
                                            withAnimation {
                                                offset = CGSize(width: 500, height: 0)
                                            }
                                            keepCurrent(item: item)
                                        } else if gesture.translation.width < -120 {
                                            withAnimation {
                                                offset = CGSize(width: -500, height: 0)
                                            }
                                            markForTrash(item: item)
                                        } else {
                                            withAnimation { offset = .zero }
                                        }
                                    }
                            )

                        if offset.width < -50 {
                            Text("MARK TRASH")
                                .font(.title2)
                                .fontWeight(.black)
                                .foregroundColor(.red)
                                .padding(10)
                                .border(Color.red, width: 4)
                                .cornerRadius(8)
                        } else if offset.width > 50 {
                            Text("KEEP")
                                .font(.title2)
                                .fontWeight(.black)
                                .foregroundColor(.green)
                                .padding(10)
                                .border(Color.green, width: 4)
                                .cornerRadius(8)
                        }
                    }
                    .padding(.horizontal)

                    HStack(spacing: 32) {
                        Button {
                            markForTrash(item: item)
                        } label: {
                            Image(systemName: "trash.fill")
                                .font(.title2)
                                .foregroundColor(.red)
                                .frame(width: 60, height: 60)
                                .background(Color.cardBackground)
                                .clipShape(Circle())
                        }
                        .accessibilityLabel("Mark current photo for Trash")

                        Button {
                            undoLastSwipe()
                        } label: {
                            Image(systemName: "arrow.uturn.backward")
                                .font(.title3.weight(.bold))
                                .foregroundColor(history.isEmpty ? .secondary : .primary)
                                .frame(width: 48, height: 48)
                                .background(Color.cardBackground)
                                .clipShape(Circle())
                        }
                        .disabled(history.isEmpty)
                        .accessibilityLabel("Undo last swipe")

                        Button {
                            keepCurrent(item: item)
                        } label: {
                            Image(systemName: "checkmark")
                                .font(.title2)
                                .foregroundColor(.green)
                                .frame(width: 60, height: 60)
                                .background(Color.cardBackground)
                                .clipShape(Circle())
                        }
                        .accessibilityLabel("Keep current photo")
                    }

                    if markedCount > 0 {
                        Button {
                            commitMarkedTrash()
                        } label: {
                            HStack {
                                Image(systemName: "trash")
                                Text("Move \(markedCount) Marked (\(formatByteCount(markedBytes))) to Trash")
                                    .fontWeight(.bold)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 12)
                            .background(Color.sweeprEmerald)
                            .foregroundColor(.white)
                            .cornerRadius(14)
                        }
                        .padding(.horizontal)
                        .disabled(vm.isWorking)
                    }
                }
            }
            .padding(.bottom, 12)
            .navigationTitle("Swipe Clean")
        }
    }

    private func keepCurrent(item: MediaItem) {
        let prev = vm.selectedMediaIDs.contains(item.id)
        history.append((index: currentIndex, id: item.id, wasSelected: prev))
        vm.selectedMediaIDs.remove(item.id)
        offset = .zero
        currentIndex += 1
    }

    private func markForTrash(item: MediaItem) {
        let prev = vm.selectedMediaIDs.contains(item.id)
        history.append((index: currentIndex, id: item.id, wasSelected: prev))
        vm.selectedMediaIDs.insert(item.id)
        offset = .zero
        currentIndex += 1
    }

    private func undoLastSwipe() {
        guard let last = history.popLast() else { return }
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
                if currentIndex >= vm.mediaResult.allItems.count {
                    currentIndex = 0
                }
                history.removeAll()
            }
        } else {
            onShowPaywall()
        }
    }
}
