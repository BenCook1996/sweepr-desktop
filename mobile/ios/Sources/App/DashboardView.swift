import SwiftUI

// MARK: - Home (Mockup #6: Quick Clean inside the storage ring)
struct DashboardView: View {
    @ObservedObject var vm: AppViewModel
    let onShowPaywall: () -> Void
    /// Switches the root tab / split selection (Swipe to Clean card, Battery tile).
    var onSelectTab: (SweeprNavigationItem) -> Void = { _ in }

    @State private var showQuickCleanReview = false

    private var usedPercent: Int {
        Int((vm.storage.usedFraction * 100).rounded())
    }

    private var photoSavingsBytes: Int64 {
        let result = vm.mediaResult
        let duplicateBytes: Int64 = result.duplicateGroups.reduce(Int64(0)) { $0 + $1.reclaimableBytes }
        let similarBytes: Int64 = result.similarGroups.reduce(Int64(0)) { $0 + $1.reclaimableBytes }
        let screenshotBytes: Int64 = result.screenshots.reduce(Int64(0)) { $0 + $1.estimatedBytes }
        let blurryBytes: Int64 = result.blurryPhotos.reduce(Int64(0)) { $0 + $1.estimatedBytes }
        return duplicateBytes + similarBytes + screenshotBytes + blurryBytes
    }

    private var videoSavingsBytes: Int64 {
        vm.mediaResult.largeVideos.reduce(Int64(0)) { $0 + $1.estimatedBytes }
    }

    private var contactIssueCount: Int {
        vm.contactGroups.count + vm.incompleteContacts.count
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    quickCleanRing
                    storageStats
                    if vm.isScanning {
                        scanProgressLabel
                    }
                    categoryTileGrid
                    swipeToCleanCard
                }
                .padding()
            }
            .background(Color.sweeprCanvas.ignoresSafeArea())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    HStack(spacing: 8) {
                        SweeprLogoView(size: 28)
                        SweeprWordmark()
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("SWEEPR Cleaner")
                    .accessibilityAddTraits(.isHeader)
                }
                ToolbarItemGroup(placement: .navigationBarTrailing) {
                    planPill
                    Button {
                        Task { await vm.scan() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .disabled(vm.isScanning)
                    .accessibilityLabel("Rescan library and contacts")
                    .accessibilityHint("Scans your photos, videos, and contacts on-device for reclaimable storage")
                }
            }
            .navigationDestination(isPresented: $showQuickCleanReview) {
                QuickCleanReviewView(vm: vm, onShowPaywall: onShowPaywall)
            }
        }
        .fullScreenCover(item: $vm.lastCleanSummary) { summary in
            CleaningCompleteView(
                vm: vm,
                summary: summary,
                onDone: {
                    vm.lastCleanSummary = nil
                    showQuickCleanReview = false
                },
                onOpenBatteryCare: {
                    vm.lastCleanSummary = nil
                    showQuickCleanReview = false
                    onSelectTab(.batteryCare)
                }
            )
        }
    }

    // MARK: Header pill

    private var planPill: some View {
        Button {
            if !vm.hasPremium {
                onShowPaywall()
            }
        } label: {
            Text(vm.hasPremium ? "Pro" : "Free")
                .font(.system(size: 12, weight: .heavy))
                .foregroundColor(.sweeprAccentText)
                .padding(.horizontal, 10)
                .padding(.vertical, 3)
                .background(Capsule().fill(Color.sweeprEmerald.opacity(0.12)))
                .overlay(Capsule().stroke(Color.sweeprEmerald.opacity(0.35), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(vm.hasPremium ? "SWEEPR Cleaner Pro active" : "Free plan")
        .accessibilityHint(vm.hasPremium ? "" : "Shows SWEEPR Cleaner Pro upgrade options")
    }

    // MARK: Quick Clean ring

    private var quickCleanRing: some View {
        ZStack {
            Circle()
                .stroke(Color.sweeprMutedText.opacity(0.18), lineWidth: 10)
            Circle()
                .trim(from: 0, to: CGFloat(vm.storage.usedFraction))
                .stroke(Color.sweeprEmerald, style: StrokeStyle(lineWidth: 10, lineCap: .round))
                .rotationEffect(.degrees(-90))

            Button(action: quickCleanTapped) {
                quickCleanCore
            }
            .buttonStyle(.plain)
            .padding(22)
            .disabled(vm.isScanning)
            .accessibilityLabel(quickCleanAccessibilityLabel)
            .accessibilityHint(
                vm.hasScanned
                    ? "Opens the Quick Clean review list"
                    : "Finds duplicate photos, large videos, and duplicate contacts on your iPhone"
            )
        }
        .frame(width: 220, height: 220)
        .padding(.top, 8)
    }

    private var quickCleanCore: some View {
        ZStack {
            Circle()
                .fill(
                    LinearGradient(
                        colors: [.sweeprEmerald, .sweeprDeepEmerald],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .shadow(color: Color.sweeprEmerald.opacity(0.45), radius: 18)

            VStack(spacing: 4) {
                if vm.isScanning {
                    ProgressView()
                        .tint(.white)
                    Text("SCANNING")
                        .font(.system(size: 14, weight: .heavy))
                        .tracking(1)
                } else {
                    Text("QUICK CLEAN")
                        .font(.system(size: 14, weight: .heavy))
                        .tracking(1)
                    Text(vm.hasScanned ? "+\(formatByteCount(vm.mediaResult.totalReclaimableBytes))" : "SCAN")
                        .font(.system(size: 26, weight: .heavy))
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                    Text(vm.hasScanned ? "tap to review" : "tap to scan")
                        .font(.caption2)
                        .opacity(0.85)
                }
            }
            .foregroundColor(.white)
            .padding(.horizontal, 14)
        }
        .contentShape(Circle())
    }

    private var quickCleanAccessibilityLabel: String {
        if vm.isScanning {
            return "Scanning"
        }
        if vm.hasScanned {
            return "Quick Clean, \(formatByteCount(vm.mediaResult.totalReclaimableBytes)) reclaimable"
        }
        return "Scan My iPhone"
    }

    private func quickCleanTapped() {
        if vm.hasScanned {
            showQuickCleanReview = true
        } else {
            Task { await vm.scan() }
        }
    }

    // MARK: Storage stats

    private var storageStats: some View {
        HStack {
            statColumn(
                value: "\(usedPercent)%",
                label: "Storage used",
                valueColor: .sweeprAccentText,
                labelColor: .sweeprAccentText
            )
            statColumn(
                value: formatByteCount(vm.storage.freeBytes),
                label: "Free space",
                valueColor: .primary,
                labelColor: .sweeprMutedText
            )
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Device storage usage")
        .accessibilityValue(
            "\(usedPercent) percent used, \(formatByteCount(vm.storage.freeBytes)) available out of \(formatByteCount(vm.storage.totalBytes))"
        )
    }

    private func statColumn(value: String, label: String, valueColor: Color, labelColor: Color) -> some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.system(size: 26, weight: .heavy))
                .foregroundColor(valueColor)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text(label)
                .font(.caption)
                .foregroundColor(labelColor)
        }
        .frame(maxWidth: .infinity)
    }

    private var scanProgressLabel: some View {
        Text(vm.scanStatus.isEmpty ? "Analyzing library on-device…" : vm.scanStatus)
            .font(.subheadline)
            .foregroundColor(.sweeprMutedText)
            .multilineTextAlignment(.center)
            .accessibilityLabel("Scan in progress: \(vm.scanStatus)")
    }

    // MARK: 2x2 tiles

    private var categoryTileGrid: some View {
        VStack(spacing: 1) {
            HStack(spacing: 1) {
                NavigationLink(destination: PhotosMediaOverviewView(vm: vm, onShowPaywall: onShowPaywall)) {
                    DashboardTile(icon: "photo.on.rectangle", title: "Photos", detail: savingsDetail(photoSavingsBytes))
                }
                NavigationLink(destination: LargeVideosDetailView(vm: vm, onShowPaywall: onShowPaywall)) {
                    DashboardTile(icon: "film", title: "Videos", detail: savingsDetail(videoSavingsBytes))
                }
            }
            HStack(spacing: 1) {
                NavigationLink(destination: ContactsCleanerView(vm: vm)) {
                    DashboardTile(icon: "person.2", title: "Contacts", detail: contactsDetail)
                }
                Button {
                    onSelectTab(.batteryCare)
                } label: {
                    DashboardTile(
                        icon: "battery.100.bolt",
                        title: "Battery",
                        detail: vm.hasBatteryCare ? "Care on" : nil
                    )
                }
            }
        }
        .buttonStyle(.plain)
        .background(Color.sweeprLine)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(Color.sweeprLine, lineWidth: 1)
        )
    }

    /// Savings hint for a tile; hidden until a scan has produced real numbers.
    private func savingsDetail(_ bytes: Int64) -> String? {
        guard vm.hasScanned else { return nil }
        return bytes > 0 ? "+\(formatByteCount(bytes))" : "All clean"
    }

    private var contactsDetail: String? {
        guard vm.hasScanned else { return nil }
        return contactIssueCount > 0 ? "\(contactIssueCount) to fix" : "All clean"
    }

    // MARK: Swipe to Clean

    private var swipeToCleanCard: some View {
        Button {
            onSelectTab(.swipeReview)
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "hand.draw")
                    .font(.title3)
                    .foregroundColor(.sweeprAccentText)
                    .frame(width: 36, height: 36)
                    .background(Circle().fill(Color.sweeprEmerald.opacity(0.14)))
                VStack(alignment: .leading, spacing: 2) {
                    Text("Swipe to Clean")
                        .font(.subheadline.weight(.bold))
                        .foregroundColor(.primary)
                    Text("Keep or remove photos one by one")
                        .font(.caption)
                        .foregroundColor(.sweeprMutedText)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.bold))
                    .foregroundColor(.sweeprMutedText)
            }
            .padding(14)
            .sweeprCard()
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Swipe to Clean. Keep or remove photos one by one")
        .accessibilityAddTraits(.isButton)
    }
}

private struct DashboardTile: View {
    let icon: String
    let title: String
    let detail: String?

    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .semibold))
                .foregroundColor(.sweeprAccentText)
                .frame(width: 38, height: 38)
                .background(Circle().fill(Color.sweeprEmerald.opacity(0.14)))
            Text(title)
                .font(.subheadline.weight(.bold))
                .foregroundColor(.primary)
            Text(detail ?? " ")
                .font(.caption.weight(.bold))
                .foregroundColor(.sweeprAccentText)
                .lineLimit(1)
                .opacity(detail == nil ? 0 : 1)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 14)
        .padding(.horizontal, 8)
        .background(Color.sweeprPanel)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(detail.map { "\(title), \($0)" } ?? title)
        .accessibilityAddTraits(.isButton)
    }
}

// MARK: - Cleaning Complete (Mockup #10)
struct CleaningCompleteView: View {
    @ObservedObject var vm: AppViewModel
    let summary: CleanSummary
    let onDone: () -> Void
    let onOpenBatteryCare: () -> Void

    private struct SummaryStat: Hashable {
        let value: String
        let label: String
    }

    private var beforePercent: Int { Int((summary.usedFractionBefore * 100).rounded()) }
    private var afterPercent: Int { Int((summary.usedFractionAfter * 100).rounded()) }

    private var headline: String {
        if summary.removedBytes > 0 {
            return "\(formatByteCount(summary.removedBytes)) freed!"
        }
        if summary.removedMediaCount > 0 {
            return "\(summary.removedMediaCount) items cleaned!"
        }
        return "\(summary.mergedContactGroups) contacts merged!"
    }

    private var stats: [SummaryStat] {
        var items: [SummaryStat] = []
        if summary.removedMediaCount > 0 {
            items.append(SummaryStat(value: "\(summary.removedMediaCount)", label: "files removed"))
        }
        if summary.mergedContactGroups > 0 {
            items.append(SummaryStat(value: "\(summary.mergedContactGroups)", label: "contacts merged"))
        }
        if summary.removedMediaCount > 0 {
            items.append(SummaryStat(value: "30 days", label: "to undo"))
        }
        return items
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                SweeprLogoView(size: 26)
                SweeprWordmark(fontSize: 16)
                Spacer()
            }
            .padding(.horizontal, 20)
            .padding(.top, 16)
            .padding(.bottom, 8)

            ScrollView {
                VStack(spacing: 16) {
                    completeRing
                        .padding(.top, 12)

                    Text(headline)
                        .font(.system(size: 26, weight: .heavy))
                        .multilineTextAlignment(.center)

                    if afterPercent < beforePercent {
                        (
                            Text("Storage went from ")
                                + Text("\(beforePercent)%").bold().foregroundColor(.primary)
                                + Text(" to ")
                                + Text("\(afterPercent)%").bold().foregroundColor(.sweeprAccentText)
                                + Text(" used.")
                        )
                        .font(.subheadline)
                        .foregroundColor(.sweeprMutedText)
                        .multilineTextAlignment(.center)
                    }

                    if summary.removedMediaCount > 0 {
                        Text("Photos and videos were moved to Recently Deleted. iOS fully releases the space when that album is emptied.")
                            .font(.caption)
                            .foregroundColor(.sweeprMutedText)
                            .multilineTextAlignment(.center)
                    }

                    if !stats.isEmpty {
                        HStack(spacing: 6) {
                            ForEach(stats, id: \.self) { stat in
                                VStack(spacing: 2) {
                                    Text(stat.value)
                                        .font(.system(size: 18, weight: .heavy))
                                        .lineLimit(1)
                                        .minimumScaleFactor(0.7)
                                    Text(stat.label)
                                        .font(.caption2)
                                        .foregroundColor(.sweeprMutedText)
                                }
                                .frame(maxWidth: .infinity)
                            }
                        }
                        .padding(.vertical, 12)
                        .padding(.horizontal, 6)
                        .sweeprCard()
                        .accessibilityElement(children: .combine)
                    }

                    if !vm.hasBatteryCare {
                        keepCleanCard
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 20)
            }
        }
        .background(Color.sweeprCanvas.ignoresSafeArea())
        .safeAreaInset(edge: .bottom) {
            SweeprBottomDock {
                Button("Done", action: onDone)
                    .buttonStyle(SweeprPrimaryButtonStyle())
                    .accessibilityHint("Returns to the home screen")
            }
        }
    }

    private var completeRing: some View {
        ZStack {
            Circle()
                .stroke(Color.sweeprMutedText.opacity(0.18), lineWidth: 10)
            Circle()
                .trim(from: 0, to: CGFloat(summary.usedFractionAfter))
                .stroke(Color.sweeprEmerald, style: StrokeStyle(lineWidth: 10, lineCap: .round))
                .rotationEffect(.degrees(-90))
            ZStack {
                Circle()
                    .fill(
                        LinearGradient(
                            colors: [.sweeprEmerald, .sweeprDeepEmerald],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .shadow(color: Color.sweeprEmerald.opacity(0.45), radius: 18)
                VStack(spacing: 4) {
                    Image(systemName: "checkmark")
                        .font(.system(size: 40, weight: .heavy))
                    Text("ALL CLEAN")
                        .font(.system(size: 13, weight: .heavy))
                        .tracking(1)
                }
                .foregroundColor(.white)
            }
            .padding(22)
        }
        .frame(width: 200, height: 200)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("All clean. Storage \(afterPercent) percent used")
    }

    /// Soft upsell into the existing Battery Care add-on (background junk cleanup).
    private var keepCleanCard: some View {
        Button(action: onOpenBatteryCare) {
            HStack(spacing: 12) {
                Image(systemName: "calendar.badge.clock")
                    .font(.title3)
                    .foregroundColor(.sweeprAccentText)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Keep it clean automatically?")
                        .font(.subheadline.weight(.bold))
                        .foregroundColor(.primary)
                    Text("Battery Care includes background junk cleanup")
                        .font(.caption)
                        .foregroundColor(.sweeprMutedText)
                }
                Spacer()
                Text("Turn On")
                    .font(.system(size: 11, weight: .heavy))
                    .foregroundColor(.sweeprAccentText)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Capsule().fill(Color.sweeprEmerald.opacity(0.14)))
                    .overlay(Capsule().stroke(Color.sweeprEmerald.opacity(0.3), lineWidth: 1))
            }
            .padding(12)
            .sweeprCard()
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Keep it clean automatically. Battery Care includes background junk cleanup")
        .accessibilityHint("Opens Battery and Vault")
        .accessibilityAddTraits(.isButton)
    }
}

struct StatCard: View {
    let title: String
    let count: Int
    var subtitle: String = ""
    let icon: String
    let color: Color
    var badgeText: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: icon)
                    .font(.title2)
                    .foregroundColor(color)
                    .frame(width: 32, alignment: .leading)
                Spacer()
                if let badgeText = badgeText {
                    Text(badgeText)
                        .font(.system(size: 10, weight: .bold))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.sweeprEmerald.opacity(0.18))
                        .foregroundColor(.sweeprEmerald)
                        .cornerRadius(4)
                }
            }

            VStack(alignment: .leading, spacing: 2) {
                Text("\(count)")
                    .font(.title3)
                    .fontWeight(.bold)
                    .foregroundColor(.primary)
                Text(title)
                    .font(.caption)
                    .fontWeight(.medium)
                    .foregroundColor(.primary)
                    .lineLimit(1)
                if !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.caption2)
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.cardBackground)
        .cornerRadius(14)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(title): \(count) items. \(subtitle)")
        .accessibilityAddTraits(.isButton)
    }
}
