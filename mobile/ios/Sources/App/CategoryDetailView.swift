import SwiftUI

typealias SmartCleanView = CategoryDetailView

struct BestShotBadge: View {
    var text: String = "✓ Best Photo (Kept)"

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

// MARK: - #5 Reusable Swipe Triage Mode Deck for Photo Categories
struct CategorySwipeTriageView: View {
    @ObservedObject var vm: AppViewModel
    let items: [MediaItem]
    let bestShotIDs: Set<String>

    @State private var currentIndex = 0
    @State private var dragOffset: CGSize = .zero

    private var markedBytes: Int64 {
        items.filter { vm.selectedMediaIDs.contains($0.id) }.reduce(0) { $0 + $1.estimatedBytes }
    }

    var body: some View {
        VStack(spacing: 14) {
            if items.isEmpty {
                emptyCategoryState(
                    icon: "checkmark.circle.fill",
                    title: "Nothing to Triage",
                    subtitle: "No items remain in this category."
                )
            } else {
                let displayIndex = min(currentIndex + 1, items.count)
                VStack(spacing: 6) {
                    Text("Photo \(displayIndex) of \(items.count) · \(formatByteCount(markedBytes)) marked for Trash")
                        .font(.caption)
                        .fontWeight(.medium)
                        .foregroundColor(.secondary)

                    ProgressView(value: Double(min(currentIndex, items.count)), total: Double(max(items.count, 1)))
                        .tint(.sweeprEmerald)
                }
                .padding(.horizontal)
                .padding(.top, 8)

                if currentIndex >= items.count {
                    Spacer()
                    VStack(spacing: 12) {
                        Image(systemName: "checkmark.seal.fill")
                            .font(.system(size: 54))
                            .foregroundColor(.sweeprEmerald)
                        Text("All Reviewed!")
                            .font(.title3)
                            .fontWeight(.bold)
                        Text("\(formatByteCount(markedBytes)) marked for Trash.")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                        if !vm.selectedMediaIDs.isEmpty {
                            Button("Move Marked to Trash") {
                                guard vm.hasPremium else { vm.showingPaywall = true; return }
                                Task { await vm.deleteSelectedMedia() }
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(.sweeprEmerald)
                            .disabled(vm.isWorking)
                        }
                        Button("Review Again") {
                            currentIndex = 0
                        }
                        .buttonStyle(.bordered)
                    }
                    Spacer()
                } else {
                    let item = items[currentIndex]
                    let isBestShot = bestShotIDs.contains(item.id)
                    let isMarkedTrash = vm.selectedMediaIDs.contains(item.id)

                    ZStack {
                        AssetThumbnailView(localIdentifier: item.id)
                            .frame(maxWidth: .infinity, maxHeight: 400)
                            .clipped()
                            .cornerRadius(20)
                            .overlay(alignment: .topLeading) {
                                HStack(spacing: 6) {
                                    if isBestShot {
                                        BestShotBadge(text: "✓ Best Photo (Kept)")
                                    }
                                    Spacer()
                                    if isMarkedTrash {
                                        Text("REMOVE")
                                            .font(.system(size: 10, weight: .bold))
                                            .padding(.horizontal, 7)
                                            .padding(.vertical, 3)
                                            .background(Color.red.opacity(0.9))
                                            .foregroundColor(.white)
                                            .cornerRadius(6)
                                    }
                                }
                                .padding(12)
                            }
                            .overlay(alignment: .bottomLeading) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("\(formatByteCount(item.estimatedBytes)) · \(item.resolutionLabel)")
                                        .font(.subheadline)
                                        .fontWeight(.bold)
                                        .foregroundColor(.white)
                                    Text(item.creationDate.formatted(date: .abbreviated, time: .shortened))
                                        .font(.caption2)
                                        .foregroundColor(.white.opacity(0.85))
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(12)
                                .background(Color.black.opacity(0.55))
                                .cornerRadius(20)
                            }
                            .offset(dragOffset)
                            .rotationEffect(.degrees(Double(dragOffset.width / 22)))
                            .gesture(
                                DragGesture()
                                    .onChanged { gesture in
                                        dragOffset = gesture.translation
                                    }
                                    .onEnded { gesture in
                                        if gesture.translation.width > 100 {
                                            markKeep(item)
                                        } else if gesture.translation.width < -100 {
                                            markTrash(item)
                                        } else {
                                            withAnimation(.spring()) {
                                                dragOffset = .zero
                                            }
                                        }
                                    }
                            )

                        if dragOffset.width < -50 {
                            Text("TRASH")
                                .font(.title2)
                                .fontWeight(.black)
                                .foregroundColor(.red)
                                .padding(10)
                                .border(Color.red, width: 3)
                                .cornerRadius(8)
                        } else if dragOffset.width > 50 {
                            Text("KEEP")
                                .font(.title2)
                                .fontWeight(.black)
                                .foregroundColor(.sweeprEmerald)
                                .padding(10)
                                .border(Color.sweeprEmerald, width: 3)
                                .cornerRadius(8)
                        }
                    }
                    .padding(.horizontal)

                    HStack(spacing: 32) {
                        Button {
                            markTrash(item)
                        } label: {
                            VStack(spacing: 4) {
                                Image(systemName: "xmark")
                                    .font(.title3.bold())
                                    .foregroundColor(.white)
                                    .frame(width: 58, height: 58)
                                    .background(Color.red)
                                    .clipShape(Circle())
                                Text("Trash")
                                    .font(.caption2)
                                    .foregroundColor(.secondary)
                            }
                        }
                        .accessibilityLabel("Mark photo for Trash")

                        Button {
                            if currentIndex > 0 {
                                dragOffset = .zero
                                currentIndex -= 1
                            }
                        } label: {
                            VStack(spacing: 4) {
                                Image(systemName: "arrow.uturn.backward")
                                    .font(.subheadline.bold())
                                    .foregroundColor(.white)
                                    .frame(width: 44, height: 44)
                                    .background(Color.gray)
                                    .clipShape(Circle())
                                Text("Undo")
                                    .font(.caption2)
                                    .foregroundColor(.secondary)
                            }
                        }
                        .disabled(currentIndex == 0)
                        .accessibilityLabel("Undo previous photo decision")

                        Button {
                            markKeep(item)
                        } label: {
                            VStack(spacing: 4) {
                                Image(systemName: "checkmark")
                                    .font(.title3.bold())
                                    .foregroundColor(.white)
                                    .frame(width: 58, height: 58)
                                    .background(Color.sweeprEmerald)
                                    .clipShape(Circle())
                                Text("Keep")
                                    .font(.caption2)
                                    .foregroundColor(.secondary)
                            }
                        }
                        .accessibilityLabel("Keep photo")
                    }
                    .padding(.bottom, 8)
                }
            }
        }
    }

    private func markTrash(_ item: MediaItem) {
        vm.selectAllMedia(ids: [item.id], select: true)
        dragOffset = .zero
        currentIndex = min(currentIndex + 1, items.count)
    }

    private func markKeep(_ item: MediaItem) {
        vm.selectAllMedia(ids: [item.id], select: false)
        dragOffset = .zero
        currentIndex = min(currentIndex + 1, items.count)
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
                                subtitle: "Identical copies safe to remove",
                                countText: "\(vm.mediaResult.duplicateGroups.count) groups",
                                icon: "doc.on.doc",
                                color: .blue
                            )
                        }

                        NavigationLink(destination: SimilarReviewView(vm: vm)) {
                            categoryRow(
                                title: "Similar Photos",
                                subtitle: "Keeps your sharpest shot automatically",
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
                                title: "Shrink Videos & Photos",
                                subtitle: "Save up to 75% space & strip GPS location",
                                countText: "\(vm.mediaResult.largeVideos.count) vid · \(vm.mediaResult.optimizablePhotos.count) img",
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

                    Section(header: Text("Contacts & Calendar Cleaner")) {
                        NavigationLink(destination: ContactsCleanerView(vm: vm)) {
                            categoryRow(
                                title: "Contacts & Old Calendar Events",
                                subtitle: "Smart merge contacts & remove events >1 yr old",
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

// MARK: - Duplicate Review (Grid / Swipe Triage Mode #5)
struct DuplicateReviewView: View {
    @ObservedObject var vm: AppViewModel
    @State private var isSwipeMode = false

    private var allItems: [MediaItem] {
        vm.mediaResult.duplicateGroups.flatMap(\.items)
    }

    private var bestShotIDs: Set<String> {
        Set(vm.mediaResult.duplicateGroups.map { $0.keep.id })
    }

    var body: some View {
        Group {
            if isSwipeMode {
                CategorySwipeTriageView(vm: vm, items: allItems, bestShotIDs: bestShotIDs)
            } else {
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
                                                                .frame(width: 44, height: 44)
                                                        }
                                                        .accessibilityLabel(isSelected ? "Selected for deletion" : "Keep item")
                                                    }
                                                    .frame(width: 132, height: 132)
                                                    .contentShape(Rectangle())
                                                    .onTapGesture {
                                                        vm.toggleMediaSelection(id: item.id)
                                                    }

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
            }
        }
        .navigationTitle("Exact Duplicates")
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button(isSwipeMode ? "Back to Grid" : "Swipe One-by-One") {
                    isSwipeMode.toggle()
                }
                .font(.caption.bold())
            }
            ToolbarItem(placement: .bottomBar) {
                Button("Move Selected to Trash") {
                    guard vm.hasPremium else { vm.showingPaywall = true; return }
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

// MARK: - Similar Photos Review ("Best Shot" Recommendation + Swipe Triage Mode #5)
struct SimilarReviewView: View {
    @ObservedObject var vm: AppViewModel
    @State private var isSwipeMode = false

    private var allItems: [MediaItem] {
        vm.mediaResult.similarGroups.flatMap(\.items)
    }

    private var bestShotIDs: Set<String> {
        Set(vm.mediaResult.similarGroups.map { $0.keep.id })
    }

    var body: some View {
        Group {
            if isSwipeMode {
                CategorySwipeTriageView(vm: vm, items: allItems, bestShotIDs: bestShotIDs)
            } else {
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
                                                                .frame(width: 44, height: 44)
                                                        }
                                                        .accessibilityLabel(
                                                            index == 0
                                                                ? (isSelected ? "Best Shot selected for deletion" : "Best Shot kept")
                                                                : (isSelected ? "Similar photo selected for deletion" : "Similar photo kept")
                                                        )
                                                    }
                                                    .frame(width: 140, height: 140)
                                                    .contentShape(Rectangle())
                                                    .onTapGesture {
                                                        vm.toggleMediaSelection(id: item.id)
                                                    }

                                                    HStack {
                                                        Text(formatByteCount(item.estimatedBytes))
                                                            .font(.caption2)
                                                            .foregroundColor(.secondary)
                                                        Spacer()
                                                        Text(item.resolutionLabel)
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
            }
        }
        .navigationTitle("Similar Photos")
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button(isSwipeMode ? "Back to Grid" : "Swipe One-by-One") {
                    isSwipeMode.toggle()
                }
                .font(.caption.bold())
            }
            ToolbarItem(placement: .bottomBar) {
                Button("Move Selected to Trash") {
                    guard vm.hasPremium else { vm.showingPaywall = true; return }
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

// MARK: - Quick Clean Review (Mockup #7)
struct QuickCleanReviewView: View {
    @ObservedObject var vm: AppViewModel
    let onShowPaywall: () -> Void

    private enum ReviewCategory: String, CaseIterable, Identifiable {
        case duplicates, similar, screenshots, blurry, largeVideos

        var id: String { rawValue }

        var title: String {
            switch self {
            case .duplicates: return "Identical copies"
            case .similar: return "Similar photos"
            case .screenshots: return "Screenshots"
            case .blurry: return "Blurry photos"
            case .largeVideos: return "Big videos"
            }
        }

        /// Auto-selected by the scan and safe to remove; others need a quick look first.
        var isSafeToClean: Bool {
            switch self {
            case .duplicates, .similar, .screenshots: return true
            case .blurry, .largeVideos: return false
            }
        }
    }

    private enum CheckState {
        case unchecked, partial, all
    }

    private var selectedMediaBytes: Int64 {
        vm.mediaResult.allItems
            .filter { vm.selectedMediaIDs.contains($0.id) }
            .reduce(Int64(0)) { $0 + $1.estimatedBytes }
    }

    /// Items marked elsewhere (e.g. Swipe to Clean) that are not part of any category below.
    private var otherSelectedIDs: [String] {
        let categorized = Set(ReviewCategory.allCases.flatMap { items(for: $0).map(\.id) })
        return vm.selectedMediaIDs.filter { !categorized.contains($0) }.sorted()
    }

    private var hasSelection: Bool {
        !vm.selectedMediaIDs.isEmpty || !vm.selectedContactGroupIDs.isEmpty
    }

    var body: some View {
        ScrollView {
            if !vm.hasScanned {
                emptyCategoryState(
                    icon: "sparkles",
                    title: "No scan results yet",
                    subtitle: "Run a Quick Clean scan from Home to see what is safe to remove."
                )
            } else if !hasAnyRows {
                emptyCategoryState(
                    icon: "checkmark.circle.fill",
                    title: "Nothing to clean",
                    subtitle: "Your library and contacts look spotless."
                )
            } else {
                VStack(alignment: .leading, spacing: 18) {
                    reviewSection(title: "SAFE TO CLEAN", safe: true)
                    reviewSection(title: "REVIEW FIRST", safe: false)
                }
                .padding(.vertical, 12)
            }
        }
        .background(Color.sweeprCanvas.ignoresSafeArea())
        .navigationTitle("Quick Clean review")
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
            if vm.hasScanned && hasAnyRows {
                selectionDock
            }
        }
    }

    private var hasAnyRows: Bool {
        ReviewCategory.allCases.contains { !items(for: $0).isEmpty }
            || !vm.contactGroups.isEmpty
            || !otherSelectedIDs.isEmpty
    }

    @ViewBuilder
    private func reviewSection(title: String, safe: Bool) -> some View {
        let categories = ReviewCategory.allCases.filter { $0.isSafeToClean == safe && !items(for: $0).isEmpty }
        let showContacts = safe && !vm.contactGroups.isEmpty
        let showOther = safe && !otherSelectedIDs.isEmpty
        if !categories.isEmpty || showContacts || showOther {
            VStack(alignment: .leading, spacing: 8) {
                Text(title)
                    .font(.system(size: 11, weight: .heavy))
                    .tracking(0.9)
                    .foregroundColor(.sweeprMutedText)
                    .padding(.horizontal, 20)
                    .accessibilityAddTraits(.isHeader)

                VStack(spacing: 0) {
                    ForEach(categories) { category in
                        mediaRow(category)
                        if category != categories.last || showContacts || showOther {
                            Divider().overlay(Color.sweeprLine)
                        }
                    }
                    if showContacts {
                        contactsRow
                        if showOther {
                            Divider().overlay(Color.sweeprLine)
                        }
                    }
                    if showOther {
                        otherSelectedRow
                    }
                }
                .sweeprCard()
                .padding(.horizontal, 16)
            }
        }
    }

    private func items(for category: ReviewCategory) -> [MediaItem] {
        switch category {
        case .duplicates: return vm.mediaResult.duplicateGroups.flatMap(\.extras)
        case .similar: return vm.mediaResult.similarGroups.flatMap(\.extras)
        case .screenshots: return vm.mediaResult.screenshots
        case .blurry: return vm.mediaResult.blurryPhotos
        case .largeVideos: return vm.mediaResult.largeVideos
        }
    }

    @ViewBuilder
    private func destination(for category: ReviewCategory) -> some View {
        switch category {
        case .duplicates:
            DuplicateReviewView(vm: vm)
        case .similar:
            SimilarReviewView(vm: vm)
        case .screenshots:
            SingleMediaListView(vm: vm, title: "Screenshots", items: vm.mediaResult.screenshots)
        case .blurry:
            SingleMediaListView(vm: vm, title: "Blurry Photos", items: vm.mediaResult.blurryPhotos)
        case .largeVideos:
            LargeVideosDetailView(vm: vm, onShowPaywall: onShowPaywall)
        }
    }

    private func checkState(selected: Int, total: Int) -> CheckState {
        if selected == 0 { return .unchecked }
        return selected >= total ? .all : .partial
    }

    private func mediaRow(_ category: ReviewCategory) -> some View {
        let categoryItems = items(for: category)
        let ids = categoryItems.map(\.id)
        let selectedCount = ids.filter { vm.selectedMediaIDs.contains($0) }.count
        let bytes = categoryItems.reduce(Int64(0)) { $0 + $1.estimatedBytes }
        let state = checkState(selected: selectedCount, total: ids.count)
        var detail = "\(formatByteCount(bytes)) • \(ids.count) \(ids.count == 1 ? "item" : "items")"
        if state == .partial {
            detail += " · \(selectedCount) selected"
        }

        return HStack(spacing: 12) {
            Button {
                vm.selectAllMedia(ids: ids, select: state != .all)
            } label: {
                ReviewCheckbox(isOn: state != .unchecked, isPartial: state == .partial)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(category.title), \(state == .unchecked ? "not selected" : "selected")")

            NavigationLink(destination: destination(for: category)) {
                reviewRowLabel(
                    title: category.title,
                    detail: detail,
                    badge: (category == .duplicates || category == .similar) ? "✓ Best Kept" : nil,
                    showsChevron: true
                )
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    private var contactsRow: some View {
        let ids = vm.contactGroups.map(\.id)
        let selectedCount = ids.filter { vm.selectedContactGroupIDs.contains($0) }.count
        let state = checkState(selected: selectedCount, total: ids.count)
        let detail = "\(ids.count) duplicate \(ids.count == 1 ? "group" : "groups") to merge"

        return HStack(spacing: 12) {
            Button {
                if state == .all {
                    vm.selectedContactGroupIDs.subtract(ids)
                } else {
                    vm.selectedContactGroupIDs.formUnion(ids)
                }
            } label: {
                ReviewCheckbox(isOn: state != .unchecked, isPartial: state == .partial)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Duplicate contacts, \(state == .unchecked ? "not selected" : "selected")")

            NavigationLink(destination: ContactsCleanerView(vm: vm)) {
                reviewRowLabel(title: "Duplicate contacts", detail: detail, showsChevron: true)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    private var otherSelectedRow: some View {
        let ids = otherSelectedIDs
        let bytes = vm.mediaResult.allItems
            .filter { ids.contains($0.id) }
            .reduce(Int64(0)) { $0 + $1.estimatedBytes }
        let detail = "\(formatByteCount(bytes)) • \(ids.count) \(ids.count == 1 ? "item" : "items")"

        return HStack(spacing: 12) {
            Button {
                vm.selectAllMedia(ids: ids, select: false)
            } label: {
                ReviewCheckbox(isOn: true, isPartial: false)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Marked while swiping, selected. Double tap to deselect")

            reviewRowLabel(title: "Marked while swiping", detail: detail, showsChevron: false)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    private func reviewRowLabel(
        title: String,
        detail: String,
        badge: String? = nil,
        showsChevron: Bool
    ) -> some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(title)
                        .font(.subheadline.weight(.bold))
                        .foregroundColor(.primary)
                        .lineLimit(1)
                    if let badge = badge {
                        Text(badge)
                            .font(.system(size: 10, weight: .heavy))
                            .foregroundColor(.sweeprEmerald)
                            .lineLimit(1)
                            .fixedSize(horizontal: true, vertical: false)
                            .padding(.horizontal, 7)
                            .padding(.vertical, 2)
                            .background(Color.sweeprEmerald.opacity(0.15))
                            .clipShape(Capsule())
                    }
                }
                Text(detail)
                    .font(.caption)
                    .foregroundColor(.sweeprMutedText)
            }
            Spacer(minLength: 4)
            if showsChevron {
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.bold))
                    .foregroundColor(.sweeprMutedText)
            }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private var selectionLabel: String {
        let groups = vm.selectedContactGroupIDs.count
        guard groups > 0 else {
            return "SELECTED (\(formatByteCount(selectedMediaBytes)))"
        }
        return "SELECTED (\(formatByteCount(selectedMediaBytes)) · \(groups) CONTACT \(groups == 1 ? "GROUP" : "GROUPS"))"
    }

    private var selectionDock: some View {
        SweeprBottomDock {
            Text(selectionLabel)
                .font(.system(size: 11, weight: .heavy))
                .tracking(0.9)
                .foregroundColor(.sweeprAccentText)
                .frame(maxWidth: .infinity, alignment: .leading)

            Button {
                if vm.hasPremium {
                    Task { await vm.performSmartCleanAll() }
                } else {
                    onShowPaywall()
                }
            } label: {
                HStack(spacing: 8) {
                    if vm.isWorking {
                        ProgressView()
                            .tint(.white)
                    } else {
                        Image(systemName: "sparkles")
                    }
                    Text(vm.hasPremium ? "Finish Cleaning" : "Unlock 1-Click Clean Up with Pro")
                }
            }
            .buttonStyle(SweeprPrimaryButtonStyle())
            .disabled(vm.isWorking || !hasSelection)
            .accessibilityLabel(
                vm.hasPremium
                    ? "Finish cleaning \(vm.selectedMediaIDs.count) selected media items and \(vm.selectedContactGroupIDs.count) duplicate contact groups"
                    : "Unlock 1-Click Clean Up with SWEEPR Cleaner Pro"
            )
            .accessibilityHint("Moves selected photos and videos to Recently Deleted for 30 days and merges selected duplicate contacts")
        }
    }
}

/// Emerald rounded checkbox used by the Quick Clean review rows.
struct ReviewCheckbox: View {
    let isOn: Bool
    var isPartial = false

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(isOn ? Color.sweeprEmerald : Color.clear)
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .stroke(isOn ? Color.sweeprEmerald : Color.sweeprMutedText, lineWidth: 1.5)
            if isOn {
                Image(systemName: isPartial ? "minus" : "checkmark")
                    .font(.system(size: 11, weight: .heavy))
                    .foregroundColor(.white)
            }
        }
        .frame(width: 22, height: 22)
        .frame(width: 44, height: 44)
        .contentShape(Rectangle())
    }
}

// MARK: - Photos & Media Overview (Mockup #8)
struct PhotosMediaOverviewView: View {
    @ObservedObject var vm: AppViewModel
    let onShowPaywall: () -> Void

    private enum CleanupKind: String, CaseIterable, Identifiable {
        case similar, blurry, screenshots, bigVideos

        var id: String { rawValue }

        var title: String {
            switch self {
            case .similar: return "Similar photos"
            case .blurry: return "Blurry photos"
            case .screenshots: return "Screenshots"
            case .bigVideos: return "Big videos"
            }
        }

        var subtitle: String {
            switch self {
            case .similar: return "Keeps the best one"
            case .blurry: return "Out of focus or shaky"
            case .screenshots: return "Screen captures & receipts"
            case .bigVideos: return "Shrink or remove"
            }
        }

        var icon: String {
            switch self {
            case .similar: return "square.stack"
            case .blurry: return "eye.slash"
            case .screenshots: return "camera.viewfinder"
            case .bigVideos: return "film"
            }
        }
    }

    private struct DonutSegment: Identifiable {
        let id: String
        let start: Double
        let end: Double
        let color: Color
    }

    private var photoItems: [MediaItem] {
        vm.mediaResult.allItems.filter { !$0.isVideo && !$0.isScreenshot }
    }

    private var videoItems: [MediaItem] {
        vm.mediaResult.allItems.filter(\.isVideo)
    }

    private var screenshotItems: [MediaItem] {
        vm.mediaResult.allItems.filter { $0.isScreenshot && !$0.isVideo }
    }

    private var mediaBytes: Int64 {
        vm.mediaResult.allItems.reduce(Int64(0)) { $0 + $1.estimatedBytes }
    }

    var body: some View {
        ScrollView {
            if !vm.hasScanned {
                VStack(spacing: 12) {
                    emptyCategoryState(
                        icon: "photo.on.rectangle",
                        title: "No scan results yet",
                        subtitle: "Scan your library on-device to see what is filling your iPhone."
                    )
                    Button("Run Scan Now") {
                        Task { await vm.scan() }
                    }
                    .buttonStyle(SweeprPrimaryButtonStyle())
                    .disabled(vm.isScanning)
                    .padding(.horizontal, 24)
                }
            } else {
                VStack(spacing: 16) {
                    mediaDonut
                        .padding(.top, 20)
                        .padding(.bottom, 14)

                    Text("Photos you can clean up")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .accessibilityAddTraits(.isHeader)

                    cleanupGrid

                    VStack(spacing: 0) {
                        NavigationLink(destination: DuplicateReviewView(vm: vm)) {
                            overviewLinkRow(
                                icon: "doc.on.doc",
                                title: "Exact duplicates",
                                detail: "\(vm.mediaResult.duplicateGroups.count) groups · \(formatByteCount(duplicateBytes))"
                            )
                        }
                        Divider().overlay(Color.sweeprLine)
                        NavigationLink(destination: LargeVideosDetailView(vm: vm, onShowPaywall: onShowPaywall)) {
                            overviewLinkRow(
                                icon: "arrow.down.right.and.arrow.up.left",
                                title: "Shrink photos & videos",
                                detail: "\(vm.mediaResult.optimizablePhotos.count) photos · \(vm.mediaResult.largeVideos.count) videos"
                            )
                        }
                    }
                    .buttonStyle(.plain)
                    .sweeprCard()
                }
                .padding()
            }
        }
        .background(Color.sweeprCanvas.ignoresSafeArea())
        .navigationTitle("Photos & Videos")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var duplicateBytes: Int64 {
        vm.mediaResult.duplicateGroups.reduce(Int64(0)) { $0 + $1.reclaimableBytes }
    }

    // MARK: Donut

    /// Segment fractions are relative to total device storage, so the grey remainder is everything else.
    private var donutSegments: [DonutSegment] {
        let photoBytes = Double(photoItems.reduce(Int64(0)) { $0 + $1.estimatedBytes })
        let videoBytes = Double(videoItems.reduce(Int64(0)) { $0 + $1.estimatedBytes })
        let shotBytes = Double(screenshotItems.reduce(Int64(0)) { $0 + $1.estimatedBytes })
        let deviceTotal = Double(vm.storage.totalBytes)
        let denominator = max(deviceTotal, photoBytes + videoBytes + shotBytes, 1)

        var segments: [DonutSegment] = []
        var cursor = 0.0
        let parts: [(String, Double, Color)] = [
            ("photos", photoBytes, .sweeprDarkEmerald),
            ("videos", videoBytes, .sweeprTeal),
            ("screenshots", shotBytes, .sweeprLightEmerald)
        ]
        for part in parts where part.1 > 0 {
            let end = min(1, cursor + part.1 / denominator)
            segments.append(DonutSegment(id: part.0, start: cursor, end: end, color: part.2))
            cursor = end
        }
        return segments
    }

    private var mediaPercentOfStorage: Int? {
        guard vm.storage.totalBytes > 0 else { return nil }
        return Int((Double(mediaBytes) / Double(vm.storage.totalBytes) * 100).rounded())
    }

    private var mediaDonut: some View {
        ZStack {
            Circle()
                .stroke(Color.sweeprMutedText.opacity(0.18), lineWidth: 16)
            ForEach(donutSegments) { segment in
                Circle()
                    .trim(from: CGFloat(segment.start), to: CGFloat(segment.end))
                    .stroke(segment.color, style: StrokeStyle(lineWidth: 16, lineCap: .butt))
                    .rotationEffect(.degrees(-90))
            }
            VStack(spacing: 2) {
                if let percent = mediaPercentOfStorage {
                    Text("\(percent)%")
                        .font(.system(size: 26, weight: .heavy))
                    Text("of storage is media")
                        .font(.caption2)
                        .foregroundColor(.sweeprMutedText)
                }
                Text(formatByteCount(mediaBytes))
                    .font(.system(size: 16, weight: .heavy))
                    .padding(.top, 2)
            }
        }
        .frame(width: 180, height: 180)
        .overlay(alignment: .topLeading) {
            calloutChip(icon: "film", text: "\(videoItems.count) Videos", background: .sweeprTeal, foreground: .white)
                .offset(x: -34, y: 4)
        }
        .overlay(alignment: .topTrailing) {
            calloutChip(
                icon: "camera.viewfinder",
                text: "\(screenshotItems.count) Screenshots",
                background: .sweeprLightEmerald,
                foreground: Color(red: 6 / 255, green: 78 / 255, blue: 59 / 255)
            )
            .offset(x: 40, y: 32)
        }
        .overlay(alignment: .bottom) {
            calloutChip(icon: "photo", text: "\(photoItems.count) Photos", background: .sweeprDarkEmerald, foreground: .white)
                .offset(y: 14)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Media usage")
        .accessibilityValue(
            "\(formatByteCount(mediaBytes)) of media. \(photoItems.count) photos, \(videoItems.count) videos, \(screenshotItems.count) screenshots"
        )
    }

    private func calloutChip(icon: String, text: String, background: Color, foreground: Color) -> some View {
        HStack(spacing: 4) {
            Image(systemName: icon)
            Text(text)
        }
        .font(.system(size: 11, weight: .heavy))
        .foregroundColor(foreground)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(background))
        .shadow(color: Color.black.opacity(0.3), radius: 6, x: 0, y: 4)
        .fixedSize()
    }

    // MARK: Cleanup cards

    private func thumbnailIDs(for kind: CleanupKind) -> [String] {
        switch kind {
        case .similar: return Array(vm.mediaResult.similarGroups.flatMap(\.items).prefix(3).map(\.id))
        case .blurry: return Array(vm.mediaResult.blurryPhotos.prefix(3).map(\.id))
        case .screenshots: return Array(vm.mediaResult.screenshots.prefix(3).map(\.id))
        case .bigVideos: return Array(vm.mediaResult.largeVideos.prefix(3).map(\.id))
        }
    }

    private func savingsBytes(for kind: CleanupKind) -> Int64 {
        switch kind {
        case .similar: return vm.mediaResult.similarGroups.reduce(Int64(0)) { $0 + $1.reclaimableBytes }
        case .blurry: return vm.mediaResult.blurryPhotos.reduce(Int64(0)) { $0 + $1.estimatedBytes }
        case .screenshots: return vm.mediaResult.screenshots.reduce(Int64(0)) { $0 + $1.estimatedBytes }
        case .bigVideos: return vm.mediaResult.largeVideos.reduce(Int64(0)) { $0 + $1.estimatedBytes }
        }
    }

    @ViewBuilder
    private func destination(for kind: CleanupKind) -> some View {
        switch kind {
        case .similar:
            SimilarReviewView(vm: vm)
        case .blurry:
            SingleMediaListView(vm: vm, title: "Blurry Photos", items: vm.mediaResult.blurryPhotos)
        case .screenshots:
            SingleMediaListView(vm: vm, title: "Screenshots", items: vm.mediaResult.screenshots)
        case .bigVideos:
            LargeVideosDetailView(vm: vm, onShowPaywall: onShowPaywall)
        }
    }

    private var cleanupGrid: some View {
        let largestKind = CleanupKind.allCases.max { savingsBytes(for: $0) < savingsBytes(for: $1) }
        let largestBytes = largestKind.map { savingsBytes(for: $0) } ?? 0

        return LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
            ForEach(CleanupKind.allCases) { kind in
                let bytes = savingsBytes(for: kind)
                NavigationLink(destination: destination(for: kind)) {
                    cleanupCard(
                        kind: kind,
                        bytes: bytes,
                        isLargest: largestBytes > 0 && kind == largestKind
                    )
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func cleanupCard(kind: CleanupKind, bytes: Int64, isLargest: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            ThumbnailStack(ids: thumbnailIDs(for: kind), fallbackIcon: kind.icon)
            Text(kind.title)
                .font(.subheadline.weight(.bold))
                .foregroundColor(.primary)
                .lineLimit(1)
            Text(kind.subtitle)
                .font(.caption2)
                .foregroundColor(.sweeprMutedText)
                .lineLimit(1)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .sweeprCard(cornerRadius: 14)
        .overlay(alignment: .topTrailing) {
            sizeBadge(bytes: bytes, isLargest: isLargest)
                .padding(8)
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(kind.title), \(formatByteCount(bytes)). \(kind.subtitle)")
        .accessibilityAddTraits(.isButton)
    }

    private func sizeBadge(bytes: Int64, isLargest: Bool) -> some View {
        let tint = isLargest ? Color.sweeprRose : Color.sweeprEmerald
        return Text(formatByteCount(bytes))
            .font(.system(size: 10.5, weight: .heavy))
            .foregroundColor(isLargest ? Color.sweeprRose : Color.sweeprAccentText)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(Capsule().fill(tint.opacity(0.14)))
            .overlay(Capsule().stroke(tint.opacity(0.3), lineWidth: 1))
    }

    private func overviewLinkRow(icon: String, title: String, detail: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.body.weight(.semibold))
                .foregroundColor(.sweeprAccentText)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline.weight(.bold))
                    .foregroundColor(.primary)
                Text(detail)
                    .font(.caption)
                    .foregroundColor(.sweeprMutedText)
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.caption.weight(.bold))
                .foregroundColor(.sweeprMutedText)
        }
        .padding(14)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// Up to three overlapping real thumbnails (front item first), with an icon placeholder when empty.
private struct ThumbnailStack: View {
    let ids: [String]
    let fallbackIcon: String

    var body: some View {
        ZStack(alignment: .topLeading) {
            if ids.isEmpty {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [.sweeprTeal, .sweeprDeepEmerald],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 64, height: 52)
                    .overlay(
                        Image(systemName: fallbackIcon)
                            .foregroundColor(.white)
                    )
                    .offset(x: 6, y: 16)
            } else {
                let entries = Array(Array(ids.prefix(3)).enumerated().reversed())
                ForEach(entries, id: \.offset) { entry in
                    AssetThumbnailView(localIdentifier: entry.element)
                        .frame(width: 64, height: 52)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .stroke(Color.sweeprPanel, lineWidth: 2)
                        )
                        .opacity(stackOpacity(for: entry.offset))
                        .offset(x: CGFloat(6 + entry.offset * 8), y: CGFloat(16 - entry.offset * 8))
                }
            }
        }
        .frame(height: 70, alignment: .topLeading)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityHidden(true)
    }

    private func stackOpacity(for index: Int) -> Double {
        switch index {
        case 0: return 1
        case 1: return 0.8
        default: return 0.55
        }
    }
}

// MARK: - Unified Media Optimizer & Privacy (#1 Photo Optimizer + #9 EXIF GPS Stripper + #17 Video Compressor)
struct LargeVideosDetailView: View {
    @ObservedObject var vm: AppViewModel
    let onShowPaywall: () -> Void

    @State private var selectedSegment = 0 // 0 = Video Compressor, 1 = Photo Optimizer & GPS Privacy
    @State private var photoPreset: PhotoCompressionPreset = .balanced
    @State private var videoPreset: VideoCompressionPreset = .balanced
    @State private var compressFileSize = true
    @State private var stripGpsCoordinates = true
    @State private var moveOriginalsToTrash = false
    @State private var selectedPhotoIDs: Set<String> = []
    @State private var showAdvancedOptions = false
    @State private var previewSplit: CGFloat = 0.5

    var body: some View {
        VStack(spacing: 0) {
            Picker("Media Optimizer Mode", selection: $selectedSegment) {
                Text("Videos (\(vm.mediaResult.largeVideos.count))").tag(0)
                Text("Photos (\(vm.mediaResult.optimizablePhotos.count))").tag(1)
            }
            .pickerStyle(.segmented)
            .padding()

            if selectedSegment == 0 {
                videoCompressorList
            } else {
                photoOptimizerList
            }
        }
        .background(Color.sweeprCanvas.ignoresSafeArea())
        .navigationTitle("Shrink Videos & Photos")
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
            if selectedSegment == 1 && !vm.mediaResult.optimizablePhotos.isEmpty {
                SweeprBottomDock {
                    shrinkPhotosButton
                }
            }
        }
        .onAppear {
            if selectedPhotoIDs.isEmpty {
                selectedPhotoIDs = Set(vm.mediaResult.optimizablePhotos.prefix(12).map(\.id))
            }
        }
    }

    // MARK: Sleek 3-stop interactive strength slider (Mockup #9)

    private func strengthSliderCard(
        selectedIndex: Int,
        stopReductions: [Int],
        specBadge: String,
        description: String,
        onSelect: @escaping (Int) -> Void
    ) -> some View {
        let clamped = min(max(selectedIndex, 0), 2)
        let stopTitles = ["Gentle", "Balanced", "Maximum"]
        let activeReduction = stopReductions.indices.contains(clamped) ? stopReductions[clamped] : 58
        let sliderBinding = Binding<Double>(
            get: { Double(clamped) },
            set: { newValue in
                onSelect(min(max(Int(newValue.rounded()), 0), 2))
            }
        )

        return VStack(alignment: .leading, spacing: 10) {
            // Header row: eyebrow + active preset title on left, spec badge + savings pill on right
            HStack(alignment: .center, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("COMPRESSION STRENGTH")
                        .font(.system(size: 10, weight: .heavy))
                        .tracking(0.8)
                        .foregroundColor(.sweeprMutedText)
                    HStack(spacing: 6) {
                        Text(stopTitles[clamped])
                            .font(.system(size: 15, weight: .heavy))
                            .foregroundColor(.primary)
                        if clamped == 1 {
                            Text("Best")
                                .font(.system(size: 10, weight: .heavy))
                                .foregroundColor(.sweeprAccentText)
                                .lineLimit(1)
                                .fixedSize(horizontal: true, vertical: false)
                                .padding(.horizontal, 7)
                                .padding(.vertical, 2)
                                .background(Capsule().fill(Color.sweeprEmerald.opacity(0.16)))
                        }
                    }
                }
                Spacer(minLength: 4)
                HStack(spacing: 6) {
                    Text(specBadge)
                        .font(.system(size: 10.5, weight: .bold))
                        .foregroundColor(.sweeprMutedText)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 3)
                        .background(
                            RoundedRectangle(cornerRadius: 7, style: .continuous)
                                .fill(Color.sweeprMutedText.opacity(0.14))
                        )
                    Text("-\(activeReduction)%")
                        .font(.system(size: 11, weight: .heavy))
                        .foregroundColor(.sweeprAccentText)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Capsule().fill(Color.sweeprEmerald.opacity(0.16)))
                        .overlay(Capsule().stroke(Color.sweeprEmerald.opacity(0.35), lineWidth: 1))
                }
            }

            // Smooth draggable slider
            Slider(value: sliderBinding, in: 0...2, step: 1)
                .tint(.sweeprEmerald)
                .accessibilityLabel("Compression strength")
                .accessibilityValue("\(stopTitles[clamped]), minus \(activeReduction) percent")

            // Interactive 3-stop pills underneath (tap or slide!)
            HStack(spacing: 8) {
                ForEach(0..<3, id: \.self) { stop in
                    let isSelected = stop == clamped
                    let pct = stopReductions.indices.contains(stop) ? stopReductions[stop] : 50
                    Button {
                        onSelect(stop)
                    } label: {
                        VStack(spacing: 2) {
                            Text(stopTitles[stop])
                                .font(.system(size: 11.5, weight: isSelected ? .heavy : .semibold))
                                .foregroundColor(isSelected ? .sweeprAccentText : .primary)
                            Text("-\(pct)%")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundColor(isSelected ? .sweeprAccentText : .sweeprMutedText)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                        .padding(.horizontal, 4)
                        .background(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .fill(isSelected ? Color.sweeprEmerald.opacity(0.16) : Color.clear)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .stroke(
                                    isSelected ? Color.sweeprEmerald : Color.sweeprMutedText.opacity(0.25),
                                    lineWidth: 1
                                )
                        )
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(stopTitles[stop]), saves \(pct) percent")
                }
            }

            Text(description)
                .font(.caption)
                .foregroundColor(.sweeprMutedText)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(14)
        .sweeprCard(cornerRadius: 14)
    }

    // MARK: Video compressor

    private var videoCompressorList: some View {
        let videos = vm.mediaResult.largeVideos
        let totalBytes = videos.reduce(Int64(0)) { $0 + $1.estimatedBytes }
        let estimatedSavings = Int64(Double(totalBytes) * videoPreset.estimatedSavingsRatio)

        return ScrollView {
            if videos.isEmpty {
                emptyCategoryState(
                    icon: "film",
                    title: "No Large Videos (>50 MB)",
                    subtitle: "Videos over 50 MB will appear here for hardware compression or cleanup."
                )
            } else {
                LazyVStack(spacing: 14) {
                    statsRow([
                        ("\(videos.count)", "large videos", false),
                        ("\(videoPreset.savedPercentEstimate)%", "smaller", false),
                        ("~\(formatByteCount(estimatedSavings))", "total saved", true)
                    ])

                    strengthSliderCard(
                        selectedIndex: videoPreset.rawValue,
                        stopReductions: VideoCompressionPreset.allCases.map(\.savedPercentEstimate),
                        specBadge: videoPreset.specBadge,
                        description: videoPreset.summaryDescription
                    ) { stop in
                        if let preset = VideoCompressionPreset(rawValue: stop) {
                            videoPreset = preset
                        }
                    }

                    ForEach(videos) { video in
                        let isSelected = vm.selectedMediaIDs.contains(video.id)
                        let estSavings = Int64(Double(video.estimatedBytes) * videoPreset.estimatedSavingsRatio)

                        HStack(spacing: 14) {
                            ZStack(alignment: .bottomLeading) {
                                AssetThumbnailView(localIdentifier: video.id)
                                    .frame(width: 96, height: 96)
                                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

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
                                Text("\(video.resolutionLabel) · Saves ~\(formatByteCount(estSavings)) (-\(videoPreset.savedPercentEstimate)%)")
                                    .font(.caption)
                                    .foregroundColor(.sweeprMutedText)
                                    .lineLimit(1)

                                HStack(spacing: 8) {
                                    Button {
                                        if vm.hasPremium {
                                            Task { await vm.compressVideo(id: video.id, preset: videoPreset) }
                                        } else {
                                            onShowPaywall()
                                        }
                                    } label: {
                                        Label("Shrink Video Size", systemImage: "arrow.down.right.and.arrow.up.left")
                                            .font(.caption)
                                            .fontWeight(.semibold)
                                            .padding(.horizontal, 10)
                                            .padding(.vertical, 6)
                                            .background(Capsule().fill(Color.sweeprEmerald))
                                            .foregroundColor(.white)
                                    }
                                    .disabled(vm.isWorking)

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
                                        .background(Capsule().fill(Color.sweeprMutedText.opacity(0.15)))
                                        .foregroundColor(.primary)
                                    }
                                }
                            }
                            Spacer()
                        }
                        .padding(12)
                        .sweeprCard(cornerRadius: 14)
                    }
                }
                .padding()
            }
        }
    }

    // MARK: Photo optimizer

    private var photoOptimizerList: some View {
        let candidates = vm.mediaResult.optimizablePhotos
        let gpsCount = candidates.filter(\.hasLocation).count
        let selectedItems = candidates.filter { selectedPhotoIDs.contains($0.id) }
        let selectedBytes = selectedItems.reduce(Int64(0)) { $0 + $1.estimatedBytes }
        let estSavedBytes = compressFileSize
            ? Int64(Double(selectedBytes) * photoPreset.estimatedSavingsRatio)
            : 0
        let previewItem = selectedItems.first ?? candidates.first
        let screenLongEdge = max(UIScreen.main.bounds.width, UIScreen.main.bounds.height) * UIScreen.main.scale
        let screenMultiple = Double(photoPreset.maxPixelSize) / max(Double(screenLongEdge), 1.0)

        return ScrollView {
            VStack(spacing: 14) {
                if candidates.isEmpty {
                    emptyCategoryState(
                        icon: "photo.badge.checkmark",
                        title: "No Optimizable or GPS-Tagged Photos",
                        subtitle: "Photos over 1.5 MB or containing EXIF GPS location coordinates will appear here."
                    )
                } else {
                    if let previewItem = previewItem {
                        beforeAfterPreview(for: previewItem)
                    }

                    Text(compressFileSize ? "Looks the same on your phone screen" : "Only hidden location info is removed")
                        .font(.subheadline.weight(.bold))
                        .multilineTextAlignment(.center)

                    statsRow([
                        (
                            compressFileSize ? String(format: "%.1f×", screenMultiple) : "\(selectedItems.count)",
                            compressFileSize ? "screen size" : "selected",
                            false
                        ),
                        (
                            compressFileSize ? "\(photoPreset.savedPercentEstimate)%" : "0%",
                            "smaller",
                            false
                        ),
                        (
                            "~\(formatByteCount(estSavedBytes))",
                            "total saved",
                            true
                        )
                    ])

                    strengthSliderCard(
                        selectedIndex: photoPreset.rawValue,
                        stopReductions: PhotoCompressionPreset.allCases.map(\.savedPercentEstimate),
                        specBadge: photoPreset.specBadge,
                        description: photoPreset.summaryDescription
                    ) { stop in
                        if let preset = PhotoCompressionPreset(rawValue: stop) {
                            photoPreset = preset
                            compressFileSize = true
                        }
                    }

                    // Inline GPS privacy toggle card
                    HStack(spacing: 10) {
                        Image(systemName: "location.slash.fill")
                            .foregroundColor(.sweeprAccentText)
                        Toggle(
                            "Remove hidden GPS location tags (\(gpsCount) photos)",
                            isOn: $stripGpsCoordinates
                        )
                        .font(.caption.weight(.semibold))
                        .tint(.sweeprEmerald)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .sweeprCard(cornerRadius: 14)

                    advancedOptions(gpsCount: gpsCount)

                    photoGrid(candidates)
                }
            }
            .padding(.horizontal)
            .padding(.bottom)
        }
    }

    private var shrinkPhotosButton: some View {
        let candidates = vm.mediaResult.optimizablePhotos
        let selectedBytes = candidates
            .filter { selectedPhotoIDs.contains($0.id) }
            .reduce(Int64(0)) { $0 + $1.estimatedBytes }
        let estSavedBytes = compressFileSize
            ? Int64(Double(selectedBytes) * photoPreset.estimatedSavingsRatio)
            : 0

        return Button {
            if vm.hasPremium {
                Task {
                    await vm.optimizePhotos(
                        ids: Array(selectedPhotoIDs),
                        compressQuality: compressFileSize,
                        stripGps: stripGpsCoordinates,
                        deleteOriginals: moveOriginalsToTrash,
                        preset: photoPreset
                    )
                }
            } else {
                onShowPaywall()
            }
        } label: {
            HStack(spacing: 8) {
                if vm.isWorking {
                    ProgressView()
                        .tint(.white)
                }
                if compressFileSize && estSavedBytes > 0 {
                    Text(
                        "Shrink \(selectedPhotoIDs.count) \(selectedPhotoIDs.count == 1 ? "Photo" : "Photos") (Save ~\(formatByteCount(estSavedBytes)))"
                    )
                } else {
                    Text("Shrink \(selectedPhotoIDs.count) \(selectedPhotoIDs.count == 1 ? "Photo" : "Photos")")
                }
            }
        }
        .buttonStyle(SweeprPrimaryButtonStyle())
        .disabled(selectedPhotoIDs.isEmpty || vm.isWorking || (!compressFileSize && !stripGpsCoordinates))
        .accessibilityLabel("Shrink \(selectedPhotoIDs.count) selected photos")
    }

    private func beforeAfterPreview(for item: MediaItem) -> some View {
        let afterBytes = compressFileSize
            ? max(Int64(1), Int64(Double(item.estimatedBytes) * (1.0 - photoPreset.estimatedSavingsRatio)))
            : item.estimatedBytes

        return GeometryReader { geo in
            let width = max(geo.size.width, 1)
            let splitX = width * previewSplit
            ZStack {
                AssetThumbnailView(localIdentifier: item.id, targetSize: CGSize(width: 800, height: 800))
                    .frame(width: width, height: 180)
                    .clipped()

                // "After" side emerald wash to make the split comparison tactile
                Rectangle()
                    .fill(Color.sweeprEmerald.opacity(0.08))
                    .frame(width: max(0, width - splitX), height: 180)
                    .frame(maxWidth: .infinity, alignment: .trailing)

                // Draggable split divider line + handle
                Rectangle()
                    .fill(Color.white)
                    .frame(width: 2, height: 180)
                    .position(x: splitX, y: 90)

                Image(systemName: "arrow.left.and.right")
                    .font(.system(size: 12, weight: .heavy))
                    .foregroundColor(.sweeprDeepEmerald)
                    .frame(width: 30, height: 30)
                    .background(Circle().fill(Color.white))
                    .shadow(color: Color.black.opacity(0.25), radius: 4, x: 0, y: 2)
                    .position(x: splitX, y: 90)
            }
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        let ratio = value.location.x / width
                        previewSplit = min(max(ratio, 0.08), 0.92)
                    }
            )
        }
        .frame(height: 180)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(alignment: .bottomLeading) {
            previewTag("Before · \(formatByteCount(item.estimatedBytes))")
                .padding(8)
        }
        .overlay(alignment: .bottomTrailing) {
            previewTag(
                compressFileSize
                    ? "After · ~\(formatByteCount(afterBytes)) (-\(photoPreset.savedPercentEstimate)%)"
                    : "After · no location"
            )
            .padding(8)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            "Before and after preview photo, \(formatByteCount(item.estimatedBytes)) before, about \(formatByteCount(afterBytes)) after"
        )
    }

    private func previewTag(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 11, weight: .heavy))
            .foregroundColor(.white)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .fill(Color.black.opacity(0.65))
            )
    }

    private func statsRow(_ stats: [(value: String, label: String, highlight: Bool)]) -> some View {
        HStack(spacing: 6) {
            ForEach(Array(stats.enumerated()), id: \.offset) { entry in
                VStack(spacing: 2) {
                    Text(entry.element.value)
                        .font(.system(size: 18, weight: .heavy))
                        .foregroundColor(entry.element.highlight ? .sweeprAccentText : .primary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                    Text(entry.element.label)
                        .font(.caption2)
                        .foregroundColor(.sweeprMutedText)
                }
                .frame(maxWidth: .infinity)
            }
        }
        .padding(.vertical, 12)
        .padding(.horizontal, 6)
        .sweeprCard(cornerRadius: 14)
        .accessibilityElement(children: .combine)
    }

    private func advancedOptions(gpsCount: Int) -> some View {
        DisclosureGroup("Advanced options", isExpanded: $showAdvancedOptions) {
            VStack(alignment: .leading, spacing: 10) {
                Toggle("Shrink Photo File Size", isOn: $compressFileSize)
                    .font(.subheadline.weight(.semibold))
                Toggle("Remove GPS Location (\(gpsCount) photos)", isOn: $stripGpsCoordinates)
                    .font(.subheadline.weight(.semibold))
                Toggle("Move Original to 30-Day Trash", isOn: $moveOriginalsToTrash)
                    .font(.subheadline.weight(.semibold))
            }
            .tint(.sweeprEmerald)
            .padding(.top, 8)
        }
        .font(.subheadline.weight(.bold))
        .padding(14)
        .sweeprCard(cornerRadius: 14)
    }

    private var safetyNote: some View {
        HStack(spacing: 10) {
            Image(systemName: "checkmark.shield.fill")
                .foregroundColor(.sweeprAccentText)
            Text(
                moveOriginalsToTrash
                    ? "Originals kept in Recently Deleted for 30 days"
                    : "Originals stay in your library — a smaller copy is saved alongside"
            )
            .font(.caption)
            .foregroundColor(.primary)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .sweeprCard(cornerRadius: 14)
        .accessibilityElement(children: .combine)
    }

    private func photoGrid(_ candidates: [MediaItem]) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 105), spacing: 8)], spacing: 8) {
            ForEach(candidates) { item in
                let isSelected = selectedPhotoIDs.contains(item.id)
                ZStack(alignment: .topTrailing) {
                    AssetThumbnailView(localIdentifier: item.id)
                        .frame(height: 110)
                        .clipped()
                        .cornerRadius(8)

                    if item.hasLocation {
                        VStack {
                            HStack {
                                Text("GPS")
                                    .font(.system(size: 9, weight: .bold))
                                    .padding(.horizontal, 5)
                                    .padding(.vertical, 2)
                                    .background(Color.sweeprEmerald)
                                    .foregroundColor(.white)
                                    .cornerRadius(4)
                                    .padding(4)
                                Spacer()
                            }
                            Spacer()
                        }
                    }

                    Button {
                        if isSelected {
                            selectedPhotoIDs.remove(item.id)
                        } else {
                            selectedPhotoIDs.insert(item.id)
                        }
                    } label: {
                        Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                            .font(.subheadline)
                            .foregroundColor(isSelected ? .sweeprEmerald : .white)
                            .background(Circle().fill(Color.black.opacity(0.45)))
                            .padding(4)
                    }
                    .accessibilityLabel(
                        "Photo, \(formatByteCount(item.estimatedBytes)), \(isSelected ? "selected" : "not selected")"
                    )
                }
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

// MARK: - Single Media Grid / Swipe Triage View (Screenshots & Blurry Photos #5)
struct SingleMediaListView: View {
    @ObservedObject var vm: AppViewModel
    let title: String
    let items: [MediaItem]
    @State private var isSwipeMode = false

    private let columns = [GridItem(.adaptive(minimum: 105), spacing: 8)]

    var body: some View {
        Group {
            if isSwipeMode {
                CategorySwipeTriageView(vm: vm, items: items, bestShotIDs: [])
            } else {
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
                                            .frame(width: 44, height: 44)
                                    }
                                    .accessibilityLabel(
                                        "\(title) item, \(formatByteCount(item.estimatedBytes)), \(isSelected ? "selected" : "not selected")"
                                    )
                                }
                                .contentShape(Rectangle())
                                .onTapGesture {
                                    vm.toggleMediaSelection(id: item.id)
                                }
                            }
                        }
                        .padding(8)
                    }
                }
            }
        }
        .navigationTitle(title)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button(isSwipeMode ? "Back to Grid" : "Swipe One-by-One") {
                    isSwipeMode.toggle()
                }
                .font(.caption.bold())
            }
            ToolbarItem(placement: .bottomBar) {
                HStack {
                    Button(vm.selectedMediaIDs.isSuperset(of: items.map(\.id)) ? "Deselect All" : "Select All") {
                        let allIDs = items.map(\.id)
                        let select = !vm.selectedMediaIDs.isSuperset(of: allIDs)
                        vm.selectAllMedia(ids: allIDs, select: select)
                    }
                    .disabled(items.isEmpty)
                    Spacer()
                    Button("Move Selected to Trash") {
                        guard vm.hasPremium else { vm.showingPaywall = true; return }
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

// MARK: - Contacts & Old Calendar Events Cleaner View (#18)
struct ContactsCleanerView: View {
    @ObservedObject var vm: AppViewModel
    @State private var selectedMode = 0 // 0 = Duplicates, 1 = Incomplete, 2 = Old Calendar Events (>1 yr)
    @State private var showMergeConfirm = false
    @State private var showIncompleteDeleteConfirm = false
    @State private var showCalendarDeleteConfirm = false

    var body: some View {
        VStack(spacing: 0) {
            Picker("Contacts & Calendar Mode", selection: $selectedMode) {
                Text("Dupes (\(vm.contactGroups.count))").tag(0)
                Text("Incomplete (\(vm.incompleteContacts.count))").tag(1)
                Text("Calendar").tag(2)
            }
            .pickerStyle(.segmented)
            .padding()
            .onChange(of: selectedMode) { newMode in
                if newMode == 2 {
                    Task { await vm.scanOldCalendarEvents() }
                }
            }

            if selectedMode == 0 {
                duplicatesList
            } else if selectedMode == 1 {
                incompleteList
            } else {
                calendarEventsList
            }
        }
        .navigationTitle("Contacts & Calendar")
        .confirmationDialog(
            "Smart Merge \(vm.selectedContactGroupIDs.count) Contact Group(s)?",
            isPresented: $showMergeConfirm,
            titleVisibility: .visible
        ) {
            Button("Merge Selected Contacts") {
                Task { await vm.mergeSelectedContacts() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Combines phone numbers and emails into a single primary contact per group and removes duplicate entries.")
        }
        .confirmationDialog(
            "Delete \(vm.selectedIncompleteContactIDs.count) Incomplete Contact(s)?",
            isPresented: $showIncompleteDeleteConfirm,
            titleVisibility: .visible
        ) {
            Button("Delete Incomplete Contacts", role: .destructive) {
                Task { await vm.deleteSelectedIncompleteContacts() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Permanently removes selected contacts that are missing names, phone numbers, or email addresses.")
        }
        .confirmationDialog(
            "Delete \(vm.selectedCalendarEventIDs.count) Old Calendar Event(s)?",
            isPresented: $showCalendarDeleteConfirm,
            titleVisibility: .visible
        ) {
            Button("Delete Old Events", role: .destructive) {
                Task { await vm.deleteSelectedCalendarEvents() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Permanently removes selected past calendar events older than 1 year.")
        }
        .toolbar {
            ToolbarItem(placement: .bottomBar) {
                if selectedMode == 0 {
                    Button("Smart Merge Selected (\(vm.selectedContactGroupIDs.count))") {
                        guard vm.hasPremium else { vm.showingPaywall = true; return }
                        showMergeConfirm = true
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.sweeprEmerald)
                    .disabled(vm.selectedContactGroupIDs.isEmpty || vm.isWorking)
                    .accessibilityLabel("Smart merge \(vm.selectedContactGroupIDs.count) duplicate contact groups")
                } else if selectedMode == 1 {
                    Button("Delete Incomplete (\(vm.selectedIncompleteContactIDs.count))") {
                        guard vm.hasPremium else { vm.showingPaywall = true; return }
                        showIncompleteDeleteConfirm = true
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.red)
                    .disabled(vm.selectedIncompleteContactIDs.isEmpty || vm.isWorking)
                    .accessibilityLabel("Delete \(vm.selectedIncompleteContactIDs.count) incomplete contacts")
                } else {
                    Button("Delete Old Events (\(vm.selectedCalendarEventIDs.count))") {
                        guard vm.hasPremium else { vm.showingPaywall = true; return }
                        showCalendarDeleteConfirm = true
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.red)
                    .disabled(vm.selectedCalendarEventIDs.isEmpty || vm.isWorking)
                    .accessibilityLabel("Delete \(vm.selectedCalendarEventIDs.count) expired calendar events older than 1 year")
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

    private var calendarEventsList: some View {
        List {
            if vm.oldCalendarEvents.isEmpty {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("No expired calendar events older than 1 year found.")
                            .foregroundColor(.secondary)
                        Button("Scan Calendar (>1 yr)") {
                            Task { await vm.scanOldCalendarEvents() }
                        }
                        .font(.caption.bold())
                    }
                }
            } else {
                ForEach(vm.oldCalendarEvents) { event in
                    let isSelected = vm.selectedCalendarEventIDs.contains(event.id)
                    HStack {
                        Button {
                            vm.toggleCalendarEventSelection(id: event.id)
                        } label: {
                            Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                                .foregroundColor(isSelected ? .sweeprEmerald : .secondary)
                                .font(.title3)
                        }
                        .buttonStyle(.plain)

                        VStack(alignment: .leading, spacing: 2) {
                            Text(event.title)
                                .font(.subheadline)
                                .fontWeight(.medium)
                            Text("\(event.endDate.formatted(date: .abbreviated, time: .shortened)) · \(event.calendarTitle)")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                        Spacer()
                    }
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
