import SwiftUI

struct DashboardView: View {
    @ObservedObject var vm: AppViewModel
    let onShowPaywall: () -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    // Storage Ring Gauge Card
                    storageRingCard

                    // Scan / Status Banner
                    scanStatusBanner

                    // Scan Summary & Category Cards
                    if vm.hasScanned {
                        reclaimableSummarySection
                    }
                }
                .padding()
            }
            .navigationTitle("SWEEPR Cleaner")
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    SweeprLogoView(size: 30)
                }
                ToolbarItem(placement: .navigationBarTrailing) {
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
        }
    }

    private var storageRingCard: some View {
        VStack(spacing: 16) {
            ZStack {
                Circle()
                    .stroke(Color.gray.opacity(0.15), lineWidth: 16)
                    .frame(width: 168, height: 168)
                Circle()
                    .trim(from: 0, to: CGFloat(vm.storage.usedFraction))
                    .stroke(
                        LinearGradient(
                            colors: [.sweeprEmerald, .sweeprDarkEmerald],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        style: StrokeStyle(lineWidth: 16, lineCap: .round)
                    )
                    .frame(width: 168, height: 168)
                    .rotationEffect(.degrees(-90))

                VStack(spacing: 4) {
                    Text("\(Int(vm.storage.usedFraction * 100))%")
                        .font(.system(size: 36, weight: .bold))
                    Text("Storage Used")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
            .padding(.top, 8)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Device storage usage gauge")
            .accessibilityValue(
                "\(Int(vm.storage.usedFraction * 100)) percent used, \(formatByteCount(vm.storage.freeBytes)) available out of \(formatByteCount(vm.storage.totalBytes))"
            )

            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Used Space")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Text(formatByteCount(vm.storage.usedBytes))
                        .font(.headline)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Used space: \(formatByteCount(vm.storage.usedBytes))")

                Spacer()

                VStack(alignment: .trailing, spacing: 2) {
                    Text("Available Space")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Text(formatByteCount(vm.storage.freeBytes))
                        .font(.headline)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Available space: \(formatByteCount(vm.storage.freeBytes))")
            }
        }
        .padding(20)
        .background(Color.cardBackground)
        .cornerRadius(20)
    }

    @ViewBuilder
    private var scanStatusBanner: some View {
        if vm.isScanning {
            HStack(spacing: 12) {
                ProgressView()
                Text(vm.scanStatus.isEmpty ? "Analyzing library on-device…" : vm.scanStatus)
                    .font(.subheadline)
            }
            .padding()
            .frame(maxWidth: .infinity)
            .background(Color.sweeprEmerald.opacity(0.1))
            .cornerRadius(12)
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Scan in progress: \(vm.scanStatus)")
        } else if !vm.hasScanned {
            Button {
                Task { await vm.scan() }
            } label: {
                HStack {
                    Image(systemName: "sparkles")
                    Text("Start On-Device Smart Scan")
                        .fontWeight(.bold)
                }
                .frame(maxWidth: .infinity)
                .padding()
                .background(Color.sweeprEmerald)
                .foregroundColor(.white)
                .cornerRadius(14)
            }
            .accessibilityLabel("Start On-Device Smart Scan")
            .accessibilityHint("Analyzes photos, videos, and contacts locally on your device")
        }
    }

    private var reclaimableSummarySection: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Reclaimable Space")
                        .font(.headline)
                    Text("Best Shots are automatically preserved")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                Spacer()
                Text(formatByteCount(vm.mediaResult.totalReclaimableBytes))
                    .font(.title3)
                    .fontWeight(.bold)
                    .foregroundColor(.sweeprEmerald)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Reclaimable space: \(formatByteCount(vm.mediaResult.totalReclaimableBytes)). Best shots are automatically preserved.")

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                NavigationLink(destination: DuplicateReviewView(vm: vm)) {
                    StatCard(
                        title: "Exact Duplicates",
                        count: vm.mediaResult.duplicateGroups.count,
                        subtitle: "SHA-256 Verified",
                        icon: "doc.on.doc",
                        color: .blue
                    )
                }
                .buttonStyle(.plain)

                NavigationLink(destination: SimilarReviewView(vm: vm)) {
                    StatCard(
                        title: "Similar Photos",
                        count: vm.mediaResult.similarGroups.count,
                        subtitle: "Best Shot Kept",
                        icon: "square.stack",
                        color: .purple,
                        badgeText: "Best Shot"
                    )
                }
                .buttonStyle(.plain)

                NavigationLink(destination: SingleMediaListView(vm: vm, title: "Screenshots", items: vm.mediaResult.screenshots)) {
                    StatCard(
                        title: "Screenshots",
                        count: vm.mediaResult.screenshots.count,
                        subtitle: formatByteCount(vm.mediaResult.screenshots.reduce(0) { $0 + $1.estimatedBytes }),
                        icon: "camera.viewfinder",
                        color: .indigo
                    )
                }
                .buttonStyle(.plain)

                NavigationLink(destination: LargeVideosDetailView(vm: vm, onShowPaywall: onShowPaywall)) {
                    StatCard(
                        title: "Large Videos (>50MB)",
                        count: vm.mediaResult.largeVideos.count,
                        subtitle: "HW Compress",
                        icon: "film",
                        color: .red,
                        badgeText: "Compress"
                    )
                }
                .buttonStyle(.plain)

                NavigationLink(destination: SingleMediaListView(vm: vm, title: "Blurry Photos", items: vm.mediaResult.blurryPhotos)) {
                    StatCard(
                        title: "Blurry Photos",
                        count: vm.mediaResult.blurryPhotos.count,
                        subtitle: "Low Sharpness",
                        icon: "eye.slash",
                        color: .orange
                    )
                }
                .buttonStyle(.plain)

                NavigationLink(destination: ContactsCleanerView(vm: vm)) {
                    StatCard(
                        title: "Contacts Cleaner",
                        count: vm.contactGroups.count + vm.incompleteContacts.count,
                        subtitle: "\(vm.contactGroups.count) dup · \(vm.incompleteContacts.count) incomplete",
                        icon: "person.crop.circle.badge.plus",
                        color: .green
                    )
                }
                .buttonStyle(.plain)
            }

            // 1-Click Clean Up CTA
            Button {
                if vm.hasPremium {
                    Task {
                        await vm.performSmartCleanAll()
                    }
                } else {
                    onShowPaywall()
                }
            } label: {
                HStack {
                    Image(systemName: "trash")
                    Text(
                        vm.hasPremium
                            ? "Clean Up Selected (\(vm.selectedMediaIDs.count) media, \(vm.selectedContactGroupIDs.count) contact groups)"
                            : "Unlock 1-Click Clean Up with Pro"
                    )
                    .fontWeight(.bold)
                }
                .frame(maxWidth: .infinity)
                .padding()
                .background(Color.sweeprEmerald)
                .foregroundColor(.white)
                .cornerRadius(14)
            }
            .disabled(
                vm.isWorking || (
                    vm.selectedMediaIDs.isEmpty
                        && vm.selectedContactGroupIDs.isEmpty
                        && vm.selectedIncompleteContactIDs.isEmpty
                )
            )
            .accessibilityLabel(
                vm.hasPremium
                    ? "Clean up \(vm.selectedMediaIDs.count) selected media items and \(vm.selectedContactGroupIDs.count) duplicate contact groups"
                    : "Unlock 1-Click Clean Up with SWEEPR Cleaner Pro"
            )
            .accessibilityHint("Moves selected photos and videos to Recently Deleted for 30 days and merges selected duplicate contacts")
        }
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
