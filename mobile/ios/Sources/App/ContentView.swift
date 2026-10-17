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
    case smartClean = 1
    case swipeReview = 2
    case account = 3

    var id: Int { rawValue }

    var title: String {
        switch self {
        case .dashboard: return "Dashboard"
        case .smartClean: return "Smart Clean"
        case .swipeReview: return "Swipe"
        case .account: return "Account"
        }
    }

    var systemImage: String {
        switch self {
        case .dashboard: return "gauge.medium"
        case .smartClean: return "sparkles"
        case .swipeReview: return "hand.draw"
        case .account: return "person.crop.circle"
        }
    }
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
    @Published var selectedMediaIDs: Set<String> = []
    @Published var selectedContactGroupIDs: Set<String> = []
    @Published var selectedIncompleteContactIDs: Set<String> = []
    @Published var storage = StorageInfo.current()

    @Published var hasPremium = false
    @Published var subscriptionInfoText = "Free Plan"
    @Published var linkedAccount = AccountService.loadAccount()
    @Published var isWorking = false
    @Published var alertMessage: String? = nil

    private static let entitlementIDs = ["premium", "Sweepr Pro"]

    init() {
        refreshStorage()
        checkSubscription()
        if linkedAccount.isSignedIn {
            Task { await refreshLinkedAccount() }
        }
    }

    func refreshStorage() {
        storage = StorageInfo.current()
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
        let rcActive = Self.entitlementIDs.contains { info.entitlements[$0]?.isActive == true }
        let active = rcActive || linkedAccount.serverActive
        hasPremium = active
        if active {
            if let exp = info.entitlements.all.values.first(where: { $0.isActive })?.expirationDate {
                let formatter = DateFormatter()
                formatter.dateStyle = .medium
                subscriptionInfoText = "Sweepr Pro (Renews \(formatter.string(from: exp)))"
            } else if linkedAccount.serverActive {
                subscriptionInfoText = "Sweepr Pro (Cross-Platform Account Linked)"
            } else {
                subscriptionInfoText = "Sweepr Pro (Active)"
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

    func selectAllMedia(ids: [String], select: Bool) {
        if select {
            selectedMediaIDs.formUnion(ids)
        } else {
            selectedMediaIDs.subtract(ids)
        }
    }

    func performSmartCleanAll() async {
        await deleteSelectedMedia()
        if !selectedContactGroupIDs.isEmpty {
            await mergeSelectedContacts()
        }
        requestAppStoreReview()
    }

    func deleteSelectedMedia() async {
        guard !selectedMediaIDs.isEmpty else { return }
        isWorking = true
        let idsToDelete = Array(selectedMediaIDs)
        do {
            try await PhotoScanner.deleteAssets(identifiers: idsToDelete)
            mediaResult = mediaResult.removing(ids: Set(idsToDelete))
            selectedMediaIDs.subtract(idsToDelete)
            alertMessage = "Moved \(idsToDelete.count) items to Recently Deleted (recoverable for 30 days)."
            requestAppStoreReview()
        } catch {
            CrashLogger.recordError("DeleteSelectedMedia", error: error)
            alertMessage = "Deletion was cancelled or failed."
        }
        isWorking = false
        refreshStorage()
    }

    func deleteSingleMedia(id: String) async {
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

    func compressVideo(id: String) async {
        isWorking = true
        do {
            let result = try await PhotoScanner.compressVideo(assetId: id, deleteOriginal: true)
            mediaResult = mediaResult.removing(ids: [id])
            selectedMediaIDs.remove(id)
            alertMessage = "Video compressed! Saved \(formatByteCount(result.savedBytes)) using hardware encoder."
            requestAppStoreReview()
        } catch {
            CrashLogger.recordError("CompressVideo", error: error)
            alertMessage = error.localizedDescription
        }
        isWorking = false
        refreshStorage()
    }

    func mergeSelectedContacts() async {
        guard !selectedContactGroupIDs.isEmpty else { return }
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
        alertMessage = "Smart-merged \(mergedCount) duplicate contact groups."
        if mergedCount > 0 {
            requestAppStoreReview()
        }
    }

    func deleteSelectedIncompleteContacts() async {
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
            hasPremium = hasPremium || linked.serverActive
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
            hasPremium = hasPremium || updated.serverActive
        }
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
        hasPremium = false
        alertMessage = "Signed out of your Sweepr account."
    }

    func deleteAccount() async {
        guard linkedAccount.isSignedIn else { return }
        isWorking = true
        do {
            try await AccountService.deleteAccount(current: linkedAccount)
            signOut()
            alertMessage = "Your Sweepr account and associated data have been permanently deleted."
        } catch {
            CrashLogger.recordError("DeleteAccount", error: error)
            alertMessage = "Could not delete account: \(error.localizedDescription)"
        }
        isWorking = false
    }

    func requestAppStoreReview() {
        if let scene = UIApplication.shared.connectedScenes
            .first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene {
            SKStoreReviewController.requestReview(in: scene)
        }
    }
}

// MARK: - Asset Thumbnail View
struct AssetThumbnailView: View {
    let localIdentifier: String
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
                targetSize: CGSize(width: 180, height: 180),
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
                    .navigationTitle("Sweepr")
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
        .sheet(isPresented: $showPaywall) {
            PaywallView(vm: vm)
        }
        .alert(item: Binding<AlertItem?>(
            get: { vm.alertMessage.map { AlertItem(message: $0) } },
            set: { _ in vm.alertMessage = nil }
        )) { item in
            Alert(title: Text("Sweepr"), message: Text(item.message), dismissButton: .default(Text("OK")))
        }
    }

    @ViewBuilder
    private func destinationView(for item: SweeprNavigationItem) -> some View {
        switch item {
        case .dashboard:
            DashboardView(vm: vm, onShowPaywall: { showPaywall = true })
        case .smartClean:
            CategoryDetailView(vm: vm, onShowPaywall: { showPaywall = true })
        case .swipeReview:
            SwipeReviewView(vm: vm, onShowPaywall: { showPaywall = true })
        case .account:
            AccountView(vm: vm, onShowPaywall: { showPaywall = true })
        }
    }
}

struct AlertItem: Identifiable {
    let id = UUID()
    let message: String
}

// MARK: - Swipe Review View (Tinder-style photo cleaner)
struct SwipeReviewView: View {
    @ObservedObject var vm: AppViewModel
    let onShowPaywall: () -> Void
    @State private var currentIndex = 0
    @State private var offset: CGSize = .zero

    var body: some View {
        NavigationStack {
            VStack {
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
                } else if currentIndex >= vm.mediaResult.allItems.count {
                    VStack(spacing: 12) {
                        Image(systemName: "checkmark.seal.fill")
                            .font(.system(size: 60))
                            .foregroundColor(.sweeprEmerald)
                        Text("You're all caught up!")
                            .font(.title2)
                            .fontWeight(.bold)
                        Button("Review Again") {
                            currentIndex = 0
                        }
                    }
                } else {
                    let item = vm.mediaResult.allItems[currentIndex]

                    ZStack {
                        AssetThumbnailView(localIdentifier: item.id)
                            .frame(maxWidth: .infinity, maxHeight: 440)
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
                                            advance()
                                        } else if gesture.translation.width < -120 {
                                            withAnimation {
                                                offset = CGSize(width: -500, height: 0)
                                            }
                                            trashCurrent(item: item)
                                        } else {
                                            withAnimation { offset = .zero }
                                        }
                                    }
                            )

                        if offset.width < -50 {
                            Text("TRASH")
                                .font(.title)
                                .fontWeight(.black)
                                .foregroundColor(.red)
                                .padding()
                                .border(Color.red, width: 4)
                                .cornerRadius(8)
                        } else if offset.width > 50 {
                            Text("KEEP")
                                .font(.title)
                                .fontWeight(.black)
                                .foregroundColor(.green)
                                .padding()
                                .border(Color.green, width: 4)
                                .cornerRadius(8)
                        }
                    }
                    .padding()

                    HStack(spacing: 40) {
                        Button {
                            trashCurrent(item: item)
                        } label: {
                            Image(systemName: "trash.fill")
                                .font(.title)
                                .foregroundColor(.red)
                                .frame(width: 64, height: 64)
                                .background(Color.cardBackground)
                                .clipShape(Circle())
                        }
                        .accessibilityLabel("Move current photo to Trash")

                        Button {
                            advance()
                        } label: {
                            Image(systemName: "checkmark")
                                .font(.title)
                                .foregroundColor(.green)
                                .frame(width: 64, height: 64)
                                .background(Color.cardBackground)
                                .clipShape(Circle())
                        }
                        .accessibilityLabel("Keep current photo")
                    }
                    .padding(.bottom, 20)
                }
            }
            .navigationTitle("Swipe Clean")
        }
    }

    private func advance() {
        offset = .zero
        currentIndex += 1
    }

    private func trashCurrent(item: MediaItem) {
        if vm.hasPremium {
            Task {
                await vm.deleteSingleMedia(id: item.id)
                advance()
            }
        } else {
            onShowPaywall()
            withAnimation { offset = .zero }
        }
    }
}
