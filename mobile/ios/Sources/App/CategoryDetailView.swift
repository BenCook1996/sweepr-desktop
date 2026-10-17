import SwiftUI

typealias SmartCleanView = CategoryDetailView

struct BestShotBadge: View {
    var text: String = "Best Shot"

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: "star.fill")
                .font(.system(size: 9))
            Text(text)
                .font(.system(size: 10, weight: .bold))
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 3)
        .background(Color.sweeprEmerald)
        .foregroundColor(.white)
        .cornerRadius(6)
        .accessibilityLabel("\(text) recommended to keep")
    }
}

// MARK: - Category Detail / Smart Clean Hub
struct CategoryDetailView: View {
    @ObservedObject var vm: AppViewModel
    let onShowPaywall: () -> Void

    var body: some View {
        NavigationStack {
            List {
                if !vm.hasScanned {
                    Section {
                        VStack(spacing: 12) {
                            Image(systemName: "sparkles.rectangle.stack")
                                .font(.system(size: 40))
                                .foregroundColor(.sweeprEmerald)
                            Text("No scan results yet")
                                .font(.headline)
                            Text("Run an on-device scan to detect SHA-256 duplicates, similar bursts, screenshots, large videos, and duplicate contacts.")
                                .font(.caption)
                                .foregroundColor(.secondary)
                                .multilineTextAlignment(.center)
                            Button("Run Scan Now") {
                                Task { await vm.scan() }
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(.sweeprEmerald)
                            .accessibilityLabel("Run Scan Now")
                        }
                        .frame(maxWidth: .infinity)
                        .padding()
                    }
                } else {
                    Section(header: Text("Photo & Video Cleaner")) {
                        NavigationLink(destination: DuplicateReviewView(vm: vm)) {
                            categoryRow(
                                title: "Exact Duplicates",
                                subtitle: "SHA-256 verified identical files",
                                countText: "\(vm.mediaResult.duplicateGroups.count) groups",
                                icon: "doc.on.doc",
                                color: .blue
                            )
                        }

                        NavigationLink(destination: SimilarReviewView(vm: vm)) {
                            categoryRow(
                                title: "Similar Photos",
                                subtitle: "8×8 dHash + Best Shot recommendation",
                                countText: "\(vm.mediaResult.similarGroups.count) groups",
                                icon: "square.stack",
                                color: .purple
                            )
                        }

                        NavigationLink(destination: SingleMediaListView(vm: vm, title: "Screenshots", items: vm.mediaResult.screenshots)) {
                            categoryRow(
                                title: "Screenshots",
                                subtitle: "Screen captures & receipts",
                                countText: "\(vm.mediaResult.screenshots.count)",
                                icon: "camera.viewfinder",
                                color: .indigo
                            )
                        }

                        NavigationLink(destination: LargeVideosDetailView(vm: vm, onShowPaywall: onShowPaywall)) {
                            categoryRow(
                                title: "Large Videos (>50 MB)",
                                subtitle: "Hardware H.264/HEVC compression or delete",
                                countText: "\(vm.mediaResult.largeVideos.count)",
                                icon: "film",
                                color: .red
                            )
                        }

                        NavigationLink(destination: SingleMediaListView(vm: vm, title: "Blurry Photos", items: vm.mediaResult.blurryPhotos)) {
                            categoryRow(
                                title: "Blurry Photos",
                                subtitle: "Out-of-focus & motion blur shots",
                                countText: "\(vm.mediaResult.blurryPhotos.count)",
                                icon: "eye.slash",
                                color: .orange
                            )
                        }
                    }

                    Section(header: Text("Contacts Cleaner")) {
                        NavigationLink(destination: ContactsCleanerView(vm: vm)) {
                            categoryRow(
                                title: "Duplicate & Incomplete Contacts",
                                subtitle: "Smart merge & empty contact cleanup",
                                countText: "\(vm.contactGroups.count) dup · \(vm.incompleteContacts.count) inc",
                                icon: "person.crop.circle.badge.plus",
                                color: .green
                            )
                        }
                    }
                }
            }
            .navigationTitle("Smart Clean")
        }
    }

    private func categoryRow(
        title: String,
        subtitle: String,
        countText: String,
        icon: String,
        color: Color
    ) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundColor(color)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.body)
                    .fontWeight(.medium)
                Text(subtitle)
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
            Spacer()
            Text(countText)
                .font(.subheadline)
                .foregroundColor(.secondary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(title), \(countText). \(subtitle)")
    }
}

// MARK: - Duplicate Review
struct DuplicateReviewView: View {
    @ObservedObject var vm: AppViewModel

    var body: some View {
        ScrollView {
            if vm.mediaResult.duplicateGroups.isEmpty {
                emptyCategoryState(
                    icon: "checkmark.circle.fill",
                    title: "No Exact Duplicates",
                    subtitle: "No identical SHA-256 photo or video files were found."
                )
            } else {
                LazyVStack(spacing: 20) {
                    ForEach(vm.mediaResult.duplicateGroups) { group in
                        VStack(alignment: .leading, spacing: 10) {
                            HStack {
                                Text("Duplicate Set (\(group.items.count) copies)")
                                    .font(.headline)
                                Spacer()
                                Text("Reclaim \(formatByteCount(group.reclaimableBytes))")
                                    .font(.caption)
                                    .fontWeight(.semibold)
                                    .foregroundColor(.sweeprEmerald)
                            }

                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 12) {
                                    ForEach(Array(group.items.enumerated()), id: \.element.id) { index, item in
                                        let isSelected = vm.selectedMediaIDs.contains(item.id)
                                        VStack(alignment: .leading, spacing: 4) {
                                            ZStack(alignment: .topTrailing) {
                                                AssetThumbnailView(localIdentifier: item.id)
                                                    .frame(width: 132, height: 132)
                                                    .cornerRadius(10)

                                                if index == 0 {
                                                    VStack {
                                                        HStack {
                                                            BestShotBadge(text: "Keep Original")
                                                                .padding(6)
                                                            Spacer()
                                                        }
                                                        Spacer()
                                                    }
                                                }

                                                Button {
                                                    vm.toggleMediaSelection(id: item.id)
                                                } label: {
                                                    Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                                                        .font(.title3)
                                                        .foregroundColor(isSelected ? .sweeprEmerald : .white)
                                                        .background(Circle().fill(Color.black.opacity(0.45)))
                                                        .padding(6)
                                                }
                                                .accessibilityLabel(isSelected ? "Selected for deletion" : "Keep item")
                                            }
                                            .frame(width: 132, height: 132)

                                            HStack {
                                                Text(formatByteCount(item.estimatedBytes))
                                                    .font(.caption2)
                                                    .foregroundColor(.secondary)
                                                Spacer()
                                                Text(item.resolutionLabel)
                                                    .font(.caption2)
                                                    .foregroundColor(.secondary)
                                            }
                                            .frame(width: 132)
                                        }
                                    }
                                }
                            }
                        }
                        .padding()
                        .background(Color.cardBackground)
                        .cornerRadius(14)
                    }
                }
                .padding()
            }
        }
        .navigationTitle("Exact Duplicates")
        .toolbar {
            ToolbarItem(placement: .bottomBar) {
                Button("Move Selected to Recently Deleted") {
                    Task { await vm.deleteSelectedMedia() }
                }
                .buttonStyle(.borderedProminent)
                .tint(.sweeprEmerald)
                .disabled(vm.selectedMediaIDs.isEmpty || vm.isWorking)
                .accessibilityLabel("Move selected duplicate items to Recently Deleted")
            }
        }
    }
}

// MARK: - Similar Photos Review ("Best Shot" Recommendation)
struct SimilarReviewView: View {
    @ObservedObject var vm: AppViewModel

    var body: some View {
        ScrollView {
            if vm.mediaResult.similarGroups.isEmpty {
                emptyCategoryState(
                    icon: "sparkles",
                    title: "No Similar Bursts Found",
                    subtitle: "Your photo library has no redundant burst or near-identical shots."
                )
            } else {
                LazyVStack(spacing: 20) {
                    ForEach(vm.mediaResult.similarGroups) { group in
                        VStack(alignment: .leading, spacing: 10) {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Similar Series (\(group.items.count) photos)")
                                        .font(.headline)
                                    Text("Ranked by sharpness & resolution")
                                        .font(.caption2)
                                        .foregroundColor(.secondary)
                                }
                                Spacer()
                                Text("Save \(formatByteCount(group.reclaimableBytes))")
                                    .font(.caption)
                                    .fontWeight(.semibold)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 4)
                                    .background(Color.sweeprEmerald.opacity(0.15))
                                    .foregroundColor(.sweeprEmerald)
                                    .cornerRadius(6)
                            }

                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 12) {
                                    ForEach(Array(group.items.enumerated()), id: \.element.id) { index, item in
                                        let isSelected = vm.selectedMediaIDs.contains(item.id)
                                        VStack(alignment: .leading, spacing: 4) {
                                            ZStack(alignment: .topTrailing) {
                                                AssetThumbnailView(localIdentifier: item.id)
                                                    .frame(width: 140, height: 140)
                                                    .cornerRadius(10)

                                                if index == 0 {
                                                    VStack {
                                                        HStack {
                                                            BestShotBadge(text: "Best Shot")
                                                                .padding(6)
                                                            Spacer()
                                                        }
                                                        Spacer()
                                                    }
                                                }

                                                Button {
                                                    vm.toggleMediaSelection(id: item.id)
                                                } label: {
                                                    Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                                                        .font(.title3)
                                                        .foregroundColor(isSelected ? .sweeprEmerald : .white)
                                                        .background(Circle().fill(Color.black.opacity(0.45)))
                                                        .padding(6)
                                                }
                                                .accessibilityLabel(
                                                    index == 0
                                                        ? (isSelected ? "Best Shot selected for deletion" : "Best Shot kept")
                                                        : (isSelected ? "Similar photo selected for deletion" : "Similar photo kept")
                                                )
                                            }
                                            .frame(width: 140, height: 140)

                                            HStack {
                                                Text(formatByteCount(item.estimatedBytes))
                                                    .font(.caption2)
                                                    .foregroundColor(.secondary)
                                                Spacer()
                                                Text("Sharp \(Int(item.sharpness))")
                                                    .font(.caption2)
                                                    .foregroundColor(index == 0 ? .sweeprEmerald : .secondary)
                                            }
                                            .frame(width: 140)
                                        }
                                    }
                                }
                            }
                        }
                        .padding()
                        .background(Color.cardBackground)
                        .cornerRadius(14)
                    }
                }
                .padding()
            }
        }
        .navigationTitle("Similar Photos")
        .toolbar {
            ToolbarItem(placement: .bottomBar) {
                Button("Delete Selected Extras") {
                    Task { await vm.deleteSelectedMedia() }
                }
                .buttonStyle(.borderedProminent)
                .tint(.sweeprEmerald)
                .disabled(vm.selectedMediaIDs.isEmpty || vm.isWorking)
                .accessibilityLabel("Delete selected similar photos while keeping Best Shots")
            }
        }
    }
}

// MARK: - Large Videos (>50 MB) with Hardware Video Compression
struct LargeVideosDetailView: View {
    @ObservedObject var vm: AppViewModel
    let onShowPaywall: () -> Void

    var body: some View {
        ScrollView {
            if vm.mediaResult.largeVideos.isEmpty {
                emptyCategoryState(
                    icon: "film",
                    title: "No Large Videos (>50 MB)",
                    subtitle: "Videos over 50 MB will appear here for hardware compression or cleanup."
                )
            } else {
                LazyVStack(spacing: 14) {
                    ForEach(vm.mediaResult.largeVideos) { video in
                        let isSelected = vm.selectedMediaIDs.contains(video.id)
                        let estSavings = Int64(Double(video.estimatedBytes) * 0.55)

                        HStack(spacing: 14) {
                            ZStack(alignment: .bottomLeading) {
                                AssetThumbnailView(localIdentifier: video.id)
                                    .frame(width: 96, height: 96)
                                    .cornerRadius(10)

                                Text(formatDuration(video.duration))
                                    .font(.caption2)
                                    .fontWeight(.semibold)
                                    .padding(.horizontal, 5)
                                    .padding(.vertical, 2)
                                    .background(Color.black.opacity(0.65))
                                    .foregroundColor(.white)
                                    .cornerRadius(4)
                                    .padding(4)
                            }

                            VStack(alignment: .leading, spacing: 6) {
                                Text(formatByteCount(video.estimatedBytes))
                                    .font(.headline)
                                Text("\(video.resolutionLabel) · Saves ~\(formatByteCount(estSavings)) with Medium Preset")
                                    .font(.caption)
                                    .foregroundColor(.secondary)

                                HStack(spacing: 8) {
                                    Button {
                                        if vm.hasPremium {
                                            Task { await vm.compressVideo(id: video.id) }
                                        } else {
                                            onShowPaywall()
                                        }
                                    } label: {
                                        Label("Compress", systemImage: "arrow.down.right.and.arrow.up.left")
                                            .font(.caption)
                                            .fontWeight(.semibold)
                                            .padding(.horizontal, 10)
                                            .padding(.vertical, 6)
                                            .background(Color.sweeprEmerald)
                                            .foregroundColor(.white)
                                            .cornerRadius(8)
                                    }
                                    .disabled(vm.isWorking)
                                    .accessibilityLabel("Hardware compress video of size \(formatByteCount(video.estimatedBytes))")
                                    .accessibilityHint("Uses AVAssetExportSession medium quality preset to shrink video size by approximately 55 percent")

                                    Button {
                                        vm.toggleMediaSelection(id: video.id)
                                    } label: {
                                        Label(
                                            isSelected ? "Selected" : "Select",
                                            systemImage: isSelected ? "checkmark.circle.fill" : "circle"
                                        )
                                        .font(.caption)
                                        .padding(.horizontal, 10)
                                        .padding(.vertical, 6)
                                        .background(Color.secondary.opacity(0.15))
                                        .foregroundColor(.primary)
                                        .cornerRadius(8)
                                    }
                                    .accessibilityLabel(isSelected ? "Selected for deletion" : "Select video for deletion")
                                }
                            }
                            Spacer()
                        }
                        .padding(12)
                        .background(Color.cardBackground)
                        .cornerRadius(14)
                    }
                }
                .padding()
            }
        }
        .navigationTitle("Large Videos (>50 MB)")
        .toolbar {
            ToolbarItem(placement: .bottomBar) {
                Button("Delete Selected Videos") {
                    Task { await vm.deleteSelectedMedia() }
                }
                .buttonStyle(.borderedProminent)
                .tint(.sweeprEmerald)
                .disabled(vm.selectedMediaIDs.isEmpty || vm.isWorking)
                .accessibilityLabel("Delete selected large videos")
            }
        }
    }

    private func formatDuration(_ seconds: TimeInterval) -> String {
        let total = max(0, Int(seconds.rounded()))
        let mins = total / 60
        let secs = total % 60
        return String(format: "%d:%02d", mins, secs)
    }
}

// MARK: - Single Media Grid List View (Screenshots & Blurry Photos)
struct SingleMediaListView: View {
    @ObservedObject var vm: AppViewModel
    let title: String
    let items: [MediaItem]

    private let columns = [GridItem(.adaptive(minimum: 105), spacing: 8)]

    var body: some View {
        ScrollView {
            if items.isEmpty {
                emptyCategoryState(
                    icon: "checkmark.circle.fill",
                    title: "Nothing to Clean in \(title)",
                    subtitle: "Your library looks spotless in this category."
                )
            } else {
                LazyVGrid(columns: columns, spacing: 8) {
                    ForEach(items) { item in
                        let isSelected = vm.selectedMediaIDs.contains(item.id)
                        ZStack(alignment: .topTrailing) {
                            AssetThumbnailView(localIdentifier: item.id)
                                .frame(height: 110)
                                .clipped()
                                .cornerRadius(8)

                            Button {
                                vm.toggleMediaSelection(id: item.id)
                            } label: {
                                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                                    .font(.subheadline)
                                    .foregroundColor(isSelected ? .sweeprEmerald : .white)
                                    .background(Circle().fill(Color.black.opacity(0.45)))
                                    .padding(4)
                            }
                            .accessibilityLabel(
                                "\(title) item, \(formatByteCount(item.estimatedBytes)), \(isSelected ? "selected" : "not selected")"
                            )
                        }
                    }
                }
                .padding(8)
            }
        }
        .navigationTitle(title)
        .toolbar {
            ToolbarItem(placement: .bottomBar) {
                HStack {
                    Button(vm.selectedMediaIDs.isSuperset(of: items.map(\.id)) ? "Deselect All" : "Select All") {
                        let allIDs = items.map(\.id)
                        let select = !vm.selectedMediaIDs.isSuperset(of: allIDs)
                        vm.selectAllMedia(ids: allIDs, select: select)
                    }
                    .disabled(items.isEmpty)
                    Spacer()
                    Button("Delete Selected") {
                        Task { await vm.deleteSelectedMedia() }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.sweeprEmerald)
                    .disabled(vm.selectedMediaIDs.isEmpty || vm.isWorking)
                }
            }
        }
    }
}

// MARK: - Contacts Cleaner View (Duplicate Merge + Incomplete Contacts Cleanup)
struct ContactsCleanerView: View {
    @ObservedObject var vm: AppViewModel
    @State private var selectedMode = 0 // 0 = Duplicates, 1 = Incomplete

    var body: some View {
        VStack(spacing: 0) {
            Picker("Contacts Mode", selection: $selectedMode) {
                Text("Duplicates (\(vm.contactGroups.count))").tag(0)
                Text("Incomplete (\(vm.incompleteContacts.count))").tag(1)
            }
            .pickerStyle(.segmented)
            .padding()

            if selectedMode == 0 {
                duplicatesList
            } else {
                incompleteList
            }
        }
        .navigationTitle("Contacts Cleaner")
        .toolbar {
            ToolbarItem(placement: .bottomBar) {
                if selectedMode == 0 {
                    Button("Smart Merge Selected (\(vm.selectedContactGroupIDs.count))") {
                        Task { await vm.mergeSelectedContacts() }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.sweeprEmerald)
                    .disabled(vm.selectedContactGroupIDs.isEmpty || vm.isWorking)
                    .accessibilityLabel("Smart merge \(vm.selectedContactGroupIDs.count) duplicate contact groups")
                } else {
                    Button("Delete Incomplete (\(vm.selectedIncompleteContactIDs.count))") {
                        Task { await vm.deleteSelectedIncompleteContacts() }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.red)
                    .disabled(vm.selectedIncompleteContactIDs.isEmpty || vm.isWorking)
                    .accessibilityLabel("Delete \(vm.selectedIncompleteContactIDs.count) incomplete contacts")
                }
            }
        }
    }

    private var duplicatesList: some View {
        List {
            if vm.contactGroups.isEmpty {
                Section {
                    Text("No duplicate contacts found.")
                        .foregroundColor(.secondary)
                }
            } else {
                ForEach(vm.contactGroups) { group in
                    let isSelected = vm.selectedContactGroupIDs.contains(group.id)
                    HStack(alignment: .top, spacing: 12) {
                        Button {
                            vm.toggleContactGroupSelection(id: group.id)
                        } label: {
                            Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                                .foregroundColor(isSelected ? .sweeprEmerald : .secondary)
                                .font(.title3)
                        }
                        .buttonStyle(.plain)

                        VStack(alignment: .leading, spacing: 6) {
                            Text(group.reason)
                                .font(.headline)
                                .foregroundColor(.primary)

                            ForEach(group.contacts) { contact in
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(contact.displayName)
                                        .font(.subheadline)
                                        .fontWeight(.medium)
                                    if !contact.phones.isEmpty {
                                        Text(contact.phones.joined(separator: " · "))
                                            .font(.caption)
                                            .foregroundColor(.secondary)
                                    }
                                    if !contact.emails.isEmpty {
                                        Text(contact.emails.joined(separator: " · "))
                                            .font(.caption2)
                                            .foregroundColor(.secondary)
                                    }
                                }
                                .padding(.vertical, 2)
                            }
                        }
                    }
                    .padding(.vertical, 4)
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("\(group.reason), \(group.contacts.count) entries, \(isSelected ? "selected for merge" : "not selected")")
                }
            }
        }
    }

    private var incompleteList: some View {
        List {
            if vm.incompleteContacts.isEmpty {
                Section {
                    Text("No incomplete contacts found.")
                        .foregroundColor(.secondary)
                }
            } else {
                ForEach(vm.incompleteContacts) { contact in
                    let isSelected = vm.selectedIncompleteContactIDs.contains(contact.id)
                    HStack {
                        Button {
                            vm.toggleIncompleteContactSelection(id: contact.id)
                        } label: {
                            Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                                .foregroundColor(isSelected ? .sweeprEmerald : .secondary)
                                .font(.title3)
                        }
                        .buttonStyle(.plain)

                        VStack(alignment: .leading, spacing: 2) {
                            Text(contact.displayName)
                                .font(.subheadline)
                                .fontWeight(.medium)
                            Text(contact.incompleteReason ?? "Incomplete contact")
                                .font(.caption)
                                .foregroundColor(.orange)
                        }
                        Spacer()
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("\(contact.displayName), \(contact.incompleteReason ?? "incomplete"), \(isSelected ? "selected" : "not selected")")
                }
            }
        }
    }
}

private func emptyCategoryState(icon: String, title: String, subtitle: String) -> some View {
    VStack(spacing: 12) {
        Image(systemName: icon)
            .font(.system(size: 48))
            .foregroundColor(.sweeprEmerald)
        Text(title)
            .font(.headline)
        Text(subtitle)
            .font(.caption)
            .foregroundColor(.secondary)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 24)
    }
    .frame(maxWidth: .infinity)
    .padding(.vertical, 60)
}
