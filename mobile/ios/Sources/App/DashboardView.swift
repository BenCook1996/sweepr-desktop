import SwiftUI
import UIKit

// MARK: - Home (Candidate 5: SWEEPR Signature Hybrid)
struct DashboardView: View {
    @ObservedObject var vm: AppViewModel
    @ObservedObject var batteryMonitor = BatteryCareMonitor.shared
    let onShowPaywall: () -> Void
    /// Switches the root tab / split selection (Swipe Photo Deck card, Battery Care card).
    var onSelectTab: (SweeprNavigationItem) -> Void = { _ in }

    @State private var showQuickCleanReview = false
    @State private var showStorageBreakdownSheet = false

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

    private var photoClutterCount: Int {
        let result = vm.mediaResult
        let dupCount = result.duplicateGroups.reduce(0) { $0 + $1.extras.count }
        let simCount = result.similarGroups.reduce(0) { $0 + $1.extras.count }
        return dupCount + simCount + result.screenshots.count + result.blurryPhotos.count
    }

    private var videoSavingsBytes: Int64 {
        vm.mediaResult.largeVideos.reduce(Int64(0)) { $0 + $1.estimatedBytes }
    }

    private var screenshotSavingsBytes: Int64 {
        vm.mediaResult.screenshots.reduce(Int64(0)) { $0 + $1.estimatedBytes }
    }

    private var contactIssueCount: Int {
        vm.contactGroups.count + vm.incompleteContacts.count
    }

    private var totalPhotosBytes: Int64 {
        vm.mediaResult.allItems.filter { !$0.isVideo }.reduce(Int64(0)) { $0 + $1.estimatedBytes }
    }

    private var totalVideosBytes: Int64 {
        vm.mediaResult.allItems.filter { $0.isVideo }.reduce(Int64(0)) { $0 + $1.estimatedBytes }
    }

    private var appsAndOSBytes: Int64 {
        max(0, vm.storage.usedBytes - totalPhotosBytes - totalVideosBytes)
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.sweeprCanvas.ignoresSafeArea()

                ScrollView(showsIndicators: false) {
                    VStack(spacing: 14) {
                        // Top Header Bar with PRO/FREE badge
                        SweeprWordmarkHeaderView(vm: vm, onShowPaywall: onShowPaywall)
                            .padding(.top, 4)

                        // Candidate 5 Signature Smart Clean Ring
                        quickCleanRing

                        if vm.isScanning {
                            scanProgressLabel
                        }

                        // Multi-Segment Device Storage Breakdown Card
                        storageBreakdownCard

                        // 2x2 Bento Category Grid (4 100% Storage-Focused Categories)
                        bentoCategoryGrid
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 16)
                }
            }
            .safeAreaInset(edge: .bottom) {
                if vm.hasScanned && vm.mediaResult.totalReclaimableBytes > 0 && !vm.isScanning {
                    SweeprBottomDock {
                        HStack(spacing: 10) {
                            Button {
                                Task { await vm.performSmartCleanAll() }
                            } label: {
                                Text("Clean +\(formatByteCount(vm.mediaResult.totalReclaimableBytes))")
                            }
                            .buttonStyle(SweeprPrimaryButtonStyle())

                            Button {
                                showQuickCleanReview = true
                            } label: {
                                Text("Review")
                                    .font(.system(size: 13, weight: .heavy))
                                    .foregroundColor(.primary)
                                    .padding(.horizontal, 16)
                                    .padding(.vertical, 15)
                                    .background(Color.sweeprPanel)
                                    .clipShape(Capsule())
                                    .overlay(
                                        Capsule().stroke(Color.sweeprLine, lineWidth: 1)
                                    )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(isPresented: $showQuickCleanReview) {
                QuickCleanReviewView(vm: vm, onShowPaywall: onShowPaywall)
            }
            .sheet(isPresented: $showStorageBreakdownSheet) {
                storageBreakdownDetailSheet
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

    // MARK: - Candidate 5 Signature Smart Clean Ring (36 Ticks + Bioluminescent Glow)

    private var quickCleanRing: some View {
        let activeFraction = vm.isScanning ? 0.65 : max(0.08, vm.storage.usedFraction)
        return ZStack {
            // Bioluminescent radial glow
            Circle()
                .fill(
                    RadialGradient(
                        colors: [
                            Color.sweeprEmerald.opacity(0.22),
                            Color.sweeprCyan.opacity(0.08),
                            Color.clear
                        ],
                        center: .center,
                        startRadius: 40,
                        endRadius: 118
                    )
                )
                .frame(width: 236, height: 236)

            // 36 Outer Precision Tick Marks
            Canvas { context, size in
                let center = CGPoint(x: size.width / 2, y: size.height / 2)
                let outerRadius = min(size.width, size.height) / 2 - 2
                let tickCount = 36
                for i in 0..<tickCount {
                    let fraction = Double(i) / Double(tickCount)
                    let angleDeg = -90.0 + fraction * 360.0
                    let angleRad = angleDeg * .pi / 180.0
                    let isMajor = i % 3 == 0
                    let innerRadius = outerRadius - (isMajor ? 7.0 : 4.5)
                    let start = CGPoint(
                        x: center.x + CGFloat(cos(angleRad)) * innerRadius,
                        y: center.y + CGFloat(sin(angleRad)) * innerRadius
                    )
                    let end = CGPoint(
                        x: center.x + CGFloat(cos(angleRad)) * outerRadius,
                        y: center.y + CGFloat(sin(angleRad)) * outerRadius
                    )
                    var path = Path()
                    path.move(to: start)
                    path.addLine(to: end)
                    let isLit = fraction <= activeFraction
                    context.stroke(
                        path,
                        with: .color(isLit ? Color.sweeprEmerald.opacity(0.85) : Color.sweeprMutedText.opacity(0.22)),
                        style: StrokeStyle(lineWidth: isMajor ? 2.0 : 1.3, lineCap: .round)
                    )
                }
            }
            .frame(width: 212, height: 212)

            // Ring Track
            Circle()
                .stroke(Color.sweeprLine, lineWidth: 13)
                .frame(width: 184, height: 184)

            // Angular Sweep Progress Arc
            Circle()
                .trim(from: 0, to: CGFloat(activeFraction))
                .stroke(
                    AngularGradient(
                        gradient: Gradient(colors: [
                            .sweeprEmerald,
                            .sweeprCyan,
                            .sweeprLightEmerald,
                            .sweeprEmerald
                        ]),
                        center: .center,
                        startAngle: .degrees(-90),
                        endAngle: .degrees(270)
                    ),
                    style: StrokeStyle(lineWidth: 13, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
                .frame(width: 184, height: 184)

            // Inner Glass Core Button
            Button(action: quickCleanTapped) {
                quickCleanCore
            }
            .buttonStyle(.plain)
            .disabled(vm.isScanning)
            .accessibilityLabel(quickCleanAccessibilityLabel)
            .accessibilityHint(
                vm.hasScanned
                    ? "Opens the Quick Clean review list"
                    : "Finds duplicate photos, large videos, and duplicate contacts on your iPhone"
            )
        }
        .padding(.vertical, 4)
    }

    private var quickCleanCore: some View {
        ZStack {
            Circle()
                .fill(
                    LinearGradient(
                        colors: [Color.sweeprPanelAlt, Color.sweeprPanel],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .frame(width: 152, height: 152)
                .overlay(
                    Circle()
                        .stroke(Color.sweeprEmerald.opacity(0.32), lineWidth: 1.2)
                )
                .shadow(color: Color.sweeprEmerald.opacity(0.18), radius: 14, x: 0, y: 6)

            VStack(spacing: 4) {
                if vm.isScanning {
                    ProgressView()
                        .tint(.sweeprEmerald)
                    Text("SCANNING")
                        .font(.system(size: 11, weight: .heavy))
                        .tracking(1.3)
                        .foregroundColor(.sweeprEmerald)
                } else {
                    Text(vm.hasScanned ? "SAFE TO CLEAN" : "SMART CLEAN")
                        .font(.system(size: 9, weight: .heavy))
                        .tracking(1.4)
                        .foregroundColor(.sweeprEmerald)

                    Text(
                        vm.hasScanned
                            ? (vm.mediaResult.totalReclaimableBytes > 0
                                ? "+\(formatByteCount(vm.mediaResult.totalReclaimableBytes))"
                                : "All Clean")
                            : "Scan"
                    )
                    .font(.system(size: 26, weight: .heavy, design: .rounded))
                    .foregroundColor(.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)

                    Text(vm.hasScanned ? "Duplicates, blur & shots" : "Find junk & duplicates")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundColor(.sweeprMutedText)

                    Text(vm.hasScanned ? "Tap to review" : "Tap to scan")
                        .font(.system(size: 10, weight: .heavy))
                        .foregroundColor(.sweeprEmerald)
                        .padding(.horizontal, 11)
                        .padding(.vertical, 4)
                        .background(Color.sweeprEmerald.opacity(0.15))
                        .clipShape(Capsule())
                        .padding(.top, 2)
                }
            }
            .padding(.horizontal, 10)
        }
        .contentShape(Circle())
    }

    private var quickCleanAccessibilityLabel: String {
        if vm.isScanning {
            return "Scanning"
        }
        if vm.hasScanned {
            return "Smart Clean, \(formatByteCount(vm.mediaResult.totalReclaimableBytes)) reclaimable"
        }
        return "Scan My iPhone"
    }

    private func quickCleanTapped() {
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        if vm.hasScanned {
            showQuickCleanReview = true
        } else {
            Task { await vm.scan() }
        }
    }

    private var scanProgressLabel: some View {
        Text(vm.scanStatus.isEmpty ? "Analyzing library on-device…" : vm.scanStatus)
            .font(.caption.weight(.semibold))
            .foregroundColor(.sweeprMutedText)
            .multilineTextAlignment(.center)
            .accessibilityLabel("Scan in progress: \(vm.scanStatus)")
    }

    // MARK: - Multi-Segment Device Storage Breakdown Card

    private var storageBreakdownCard: some View {
        let total = max(Int64(1), vm.storage.totalBytes)
        let photosFrac = vm.hasScanned
            ? min(0.45, max(0.05, Double(totalPhotosBytes) / Double(total)))
            : vm.storage.usedFraction * 0.25
        let videosFrac = vm.hasScanned
            ? min(0.45, max(0.04, Double(totalVideosBytes) / Double(total)))
            : vm.storage.usedFraction * 0.20
        let appsFrac = max(0.05, vm.storage.usedFraction - photosFrac - videosFrac)
        let freeFrac = max(0.04, 1.0 - (photosFrac + videosFrac + appsFrac))

        return Button {
            showStorageBreakdownSheet = true
        } label: {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .center) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(formatByteCount(vm.storage.usedBytes)) of \(formatByteCount(vm.storage.totalBytes)) Used (\(usedPercent)%)")
                            .font(.system(size: 13, weight: .heavy))
                            .foregroundColor(.primary)
                        let cloudSavings = CloudSavings.breakdown(result: vm.mediaResult).reclaimBytes
                        Text(
                            vm.hasScanned && cloudSavings > 0
                                ? "\(formatByteCount(vm.storage.freeBytes)) free · +\(formatByteCount(cloudSavings)) reclaimable"
                                : "\(formatByteCount(vm.storage.freeBytes)) available · Tap for breakdown"
                        )
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(.sweeprMutedText)
                        .lineLimit(1)
                    }
                    Spacer()
                    Button {
                        Task { await vm.scan() }
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "arrow.clockwise")
                                .font(.system(size: 10, weight: .bold))
                            Text("Rescan")
                                .font(.system(size: 11, weight: .bold))
                        }
                        .foregroundColor(.sweeprEmerald)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(Color.sweeprPanelAlt)
                        .clipShape(Capsule())
                        .overlay(Capsule().stroke(Color.sweeprLine, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .disabled(vm.isScanning)
                    .accessibilityLabel("Rescan library and contacts")
                }

                // 4-Segment Progress Bar
                GeometryReader { geo in
                    let w = geo.size.width
                    HStack(spacing: 2) {
                        RoundedRectangle(cornerRadius: 4)
                            .fill(Color.sweeprEmerald)
                            .frame(width: max(6, w * CGFloat(photosFrac)))
                        RoundedRectangle(cornerRadius: 4)
                            .fill(Color.sweeprCyan)
                            .frame(width: max(6, w * CGFloat(videosFrac)))
                        RoundedRectangle(cornerRadius: 4)
                            .fill(Color.sweeprIndigo)
                            .frame(width: max(8, w * CGFloat(appsFrac)))
                        RoundedRectangle(cornerRadius: 4)
                            .fill(Color.sweeprMutedText.opacity(0.22))
                            .frame(maxWidth: .infinity)
                            .frame(width: max(6, w * CGFloat(freeFrac)))
                    }
                }
                .frame(height: 9)
                .clipShape(Capsule())

                // 4-Dot Legend
                HStack(spacing: 12) {
                    storageLegendDot(color: .sweeprEmerald, label: "Photos")
                    storageLegendDot(color: .sweeprCyan, label: "Videos")
                    storageLegendDot(color: .sweeprIndigo, label: "Apps & iOS")
                    storageLegendDot(color: Color.sweeprMutedText.opacity(0.45), label: "Free")
                    Spacer()
                }
            }
            .padding(14)
            .sweeprCard(cornerRadius: 18)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func storageLegendDot(color: Color, label: String) -> some View {
        HStack(spacing: 5) {
            Circle()
                .fill(color)
                .frame(width: 7, height: 7)
            Text(label)
                .font(.system(size: 10, weight: .semibold))
                .foregroundColor(.sweeprMutedText)
        }
    }

    private var storageBreakdownDetailSheet: some View {
        NavigationStack {
            List {
                Section(header: Text("iPhone Storage Breakdown")) {
                    HStack {
                        storageLegendDot(color: .sweeprEmerald, label: "Photos & Screenshots")
                        Spacer()
                        Text(vm.hasScanned ? formatByteCount(totalPhotosBytes) : "Scan to calculate")
                            .font(.subheadline.weight(.bold))
                    }
                    HStack {
                        storageLegendDot(color: .sweeprCyan, label: "Videos")
                        Spacer()
                        Text(vm.hasScanned ? formatByteCount(totalVideosBytes) : "Scan to calculate")
                            .font(.subheadline.weight(.bold))
                    }
                    HStack {
                        storageLegendDot(color: .sweeprIndigo, label: "Apps, iOS & System Data")
                        Spacer()
                        Text(formatByteCount(appsAndOSBytes))
                            .font(.subheadline.weight(.bold))
                    }
                    HStack {
                        storageLegendDot(color: .sweeprMutedText, label: "Available Free Space")
                        Spacer()
                        Text(formatByteCount(vm.storage.freeBytes))
                            .font(.subheadline.weight(.bold))
                            .foregroundColor(.sweeprEmerald)
                    }
                }
            }
            .navigationTitle("Storage Breakdown")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") { showStorageBreakdownSheet = false }
                }
            }
        }
        .presentationDetents([.medium])
    }

    // MARK: - 2x2 Bento Category Grid (4 100% Storage-Focused Categories)

    private var bentoCategoryGrid: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                NavigationLink(destination: PhotosMediaOverviewView(vm: vm, onShowPaywall: onShowPaywall)) {
                    BentoCategoryCard(
                        icon: "photo.on.rectangle.angled",
                        tint: .sweeprEmerald,
                        title: "Duplicates",
                        subtitle: vm.hasScanned ? "\(photoClutterCount) items" : "Photos & blur",
                        badgeText: vm.hasScanned
                            ? (photoSavingsBytes > 0 ? "+\(formatByteCount(photoSavingsBytes))" : "Clean")
                            : "Scan"
                    )
                }

                NavigationLink(destination: LargeVideosDetailView(vm: vm, onShowPaywall: onShowPaywall)) {
                    BentoCategoryCard(
                        icon: "video.fill",
                        tint: .sweeprCyan,
                        title: "Large Videos",
                        subtitle: vm.hasScanned ? "\(vm.mediaResult.largeVideos.count) clips" : "4K clips",
                        badgeText: vm.hasScanned
                            ? (videoSavingsBytes > 0 ? "+\(formatByteCount(videoSavingsBytes))" : "Clean")
                            : "Scan"
                    )
                }
            }

            HStack(spacing: 10) {
                NavigationLink(
                    destination: SingleMediaListView(
                        vm: vm,
                        title: "Screenshots",
                        items: vm.mediaResult.screenshots
                    )
                ) {
                    BentoCategoryCard(
                        icon: "camera.viewfinder",
                        tint: .sweeprTeal,
                        title: "Screenshots",
                        subtitle: vm.hasScanned ? "\(vm.mediaResult.screenshots.count) captures" : "Screen captures",
                        badgeText: vm.hasScanned
                            ? (screenshotSavingsBytes > 0 ? "+\(formatByteCount(screenshotSavingsBytes))" : "Clean")
                            : "Scan"
                    )
                }

                NavigationLink(destination: ContactsCleanerView(vm: vm)) {
                    BentoCategoryCard(
                        icon: "person.2.fill",
                        tint: .sweeprIndigo,
                        title: "Contacts",
                        subtitle: vm.hasScanned ? "\(contactIssueCount) duplicates" : "Duplicates",
                        badgeText: vm.hasScanned
                            ? (contactIssueCount > 0 ? "\(contactIssueCount)" : "Clean")
                            : "Scan"
                    )
                }
            }
        }
        .buttonStyle(.plain)
    }

    // MARK: - Swipe Photo Deck Promo Card

    private var swipeToCleanCard: some View {
        Button {
            onSelectTab(.swipeReview)
        } label: {
            HStack(spacing: 12) {
                SweeprIconBadge(
                    systemName: "rectangle.stack.fill",
                    tint: .sweeprEmerald,
                    size: 42,
                    iconSize: 19,
                    cornerRadius: 13
                )
                VStack(alignment: .leading, spacing: 2) {
                    Text("Swipe Photo Deck")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundColor(.primary)
                    Text(
                        vm.mediaResult.allItems.isEmpty
                            ? "Review photos month by month · Right keep, left trash"
                            : "\(vm.mediaResult.allItems.count) photos ready · Right keep, left trash"
                    )
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(.sweeprMutedText)
                    .lineLimit(1)
                }
                Spacer()
                Text("Swipe →")
                    .font(.system(size: 11, weight: .heavy))
                    .foregroundColor(.sweeprEmerald)
                    .padding(.horizontal, 11)
                    .padding(.vertical, 6)
                    .background(Color.sweeprEmerald.opacity(0.14))
                    .clipShape(Capsule())
                    .overlay(
                        Capsule()
                            .stroke(Color.sweeprEmerald.opacity(0.38), lineWidth: 1)
                    )
            }
            .padding(14)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(Color.sweeprPanel)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(Color.sweeprEmerald.opacity(0.32), lineWidth: 1)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Swipe Photo Deck. Keep or remove photos one by one")
        .accessibilityAddTraits(.isButton)
    }

    // MARK: - More Tools Bento Section

    private var moreToolsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("MORE TOOLS")
                .font(.system(size: 11, weight: .heavy))
                .tracking(0.8)
                .foregroundColor(.sweeprMutedText)

            VStack(spacing: 0) {
                NavigationLink(
                    destination: SingleMediaListView(
                        vm: vm,
                        title: "Screenshots",
                        items: vm.mediaResult.screenshots
                    )
                ) {
                    moreToolRow(
                        icon: "camera.viewfinder",
                        tint: .sweeprCyan,
                        title: "Screenshots",
                        subtitle: "\(vm.mediaResult.screenshots.count) captures",
                        badge: screenshotSavingsBytes > 0 ? formatByteCount(screenshotSavingsBytes) : "View"
                    )
                }
                .buttonStyle(.plain)

                Divider()
                    .background(Color.sweeprLine)
                    .padding(.leading, 56)

                NavigationLink(
                    destination: PhotosMediaOverviewView(vm: vm, onShowPaywall: onShowPaywall)
                ) {
                    moreToolRow(
                        icon: "arrow.down.right.and.arrow.up.left",
                        tint: .sweeprEmerald,
                        title: "Shrink & Privacy Guard",
                        subtitle: "Compress photos up to 75% & strip GPS",
                        badge: vm.mediaResult.optimizablePhotos.isEmpty
                            ? "Open"
                            : "\(vm.mediaResult.optimizablePhotos.count) ready"
                    )
                }
                .buttonStyle(.plain)

                Divider()
                    .background(Color.sweeprLine)
                    .padding(.leading, 56)

                NavigationLink(
                    destination: CalendarCleanerView(vm: vm)
                ) {
                    moreToolRow(
                        icon: "calendar.badge.clock",
                        tint: .sweeprIndigo,
                        title: "Old Calendar Events",
                        subtitle: vm.oldCalendarEvents.isEmpty
                            ? "Remove expired calendar entries"
                            : "\(vm.oldCalendarEvents.count) past events found",
                        badge: vm.oldCalendarEvents.isEmpty ? "Scan" : "\(vm.oldCalendarEvents.count)"
                    )
                }
                .buttonStyle(.plain)
            }
            .sweeprCard(cornerRadius: 18)
        }
    }

    private func moreToolRow(
        icon: String,
        tint: Color,
        title: String,
        subtitle: String,
        badge: String
    ) -> some View {
        HStack(spacing: 12) {
            SweeprIconBadge(systemName: icon, tint: tint, size: 36, iconSize: 15, cornerRadius: 10)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundColor(.primary)
                Text(subtitle)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(.sweeprMutedText)
            }
            Spacer()
            Text(badge)
                .font(.system(size: 11, weight: .bold))
                .foregroundColor(tint)
                .padding(.horizontal, 9)
                .padding(.vertical, 4)
                .background(tint.opacity(0.14))
                .clipShape(Capsule())
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
    }
}

private struct BentoCategoryCard: View {
    let icon: String
    let tint: Color
    let title: String
    let subtitle: String
    let badgeText: String

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center) {
                SweeprIconBadge(systemName: icon, tint: tint, size: 38, iconSize: 17, cornerRadius: 12)
                Spacer(minLength: 4)
                Text(badgeText)
                    .font(.system(size: 10, weight: .heavy))
                    .foregroundColor(tint)
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(tint.opacity(0.14))
                    .clipShape(Capsule())
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 13.5, weight: .bold))
                    .foregroundColor(.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
                Text(subtitle)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(.sweeprMutedText)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .sweeprCard(cornerRadius: 18)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(title), \(badgeText), \(subtitle)")
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

                    if summary.removedBytes > 0 {
                        let approxPhotos = max(1, Int(summary.removedBytes / 3_500_000))
                        let approxMinutes4K = max(1, Int(summary.removedBytes / 350_000_000))
                        HStack(spacing: 10) {
                            SweeprIconBadge(
                                systemName: "sparkles",
                                tint: .sweeprEmerald,
                                size: 34,
                                iconSize: 16,
                                cornerRadius: 10
                            )
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Room for ~\(approxPhotos) photos or \(approxMinutes4K) min of 4K video")
                                    .font(.system(size: 12, weight: .heavy))
                                    .foregroundColor(.primary)
                                Text("Also frees iCloud backup space")
                                    .font(.system(size: 11, weight: .medium))
                                    .foregroundColor(.sweeprMutedText)
                            }
                            Spacer()
                        }
                        .padding(12)
                        .sweeprCard()
                    }

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
        .onAppear {
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        }
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
