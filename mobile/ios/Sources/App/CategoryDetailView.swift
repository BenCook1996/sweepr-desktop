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
                                        BestShotBadge(text: "Best Shot")
                                    }
                                    Text("Sharp \(Int(item.sharpness))")
                                        .font(.system(size: 10, weight: .semibold))
                                        .padding(.horizontal, 7)
                                        .padding(.vertical, 3)
                                        .background(Color.black.opacity(0.6))
                                        .foregroundColor(.white)
                                        .cornerRadius(6)
                                    Spacer()
                                    if isMarkedTrash {
                                        Text("TRASH")
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
                                title: "Media Optimizer & Privacy",
                                subtitle: "HW Video Compressor + Photo 82% JPEG & EXIF GPS Stripper",
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
            }
        }
        .navigationTitle("Exact Duplicates")
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button(isSwipeMode ? "Grid View" : "Swipe Triage") {
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
            }
        }
        .navigationTitle("Similar Photos")
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button(isSwipeMode ? "Grid View" : "Swipe Triage") {
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

// MARK: - Unified Media Optimizer & Privacy (#1 Photo Optimizer + #9 EXIF GPS Stripper + #17 Video Compressor)
struct LargeVideosDetailView: View {
    @ObservedObject var vm: AppViewModel
    let onShowPaywall: () -> Void

    @State private var selectedSegment = 0 // 0 = Video Compressor, 1 = Photo Optimizer & GPS Privacy
    @State private var compressFileSize = true
    @State private var stripGpsCoordinates = true
    @State private var moveOriginalsToTrash = false
    @State private var selectedPhotoIDs: Set<String> = []

    var body: some View {
        VStack(spacing: 0) {
            Picker("Media Optimizer Mode", selection: $selectedSegment) {
                Text("Video Compressor (\(vm.mediaResult.largeVideos.count))").tag(0)
                Text("Photo Optimizer & GPS (\(vm.mediaResult.optimizablePhotos.count))").tag(1)
            }
            .pickerStyle(.segmented)
            .padding()

            if selectedSegment == 0 {
                videoCompressorList
            } else {
                photoOptimizerList
            }
        }
        .navigationTitle("Media Optimizer")
        .onAppear {
            if selectedPhotoIDs.isEmpty {
                selectedPhotoIDs = Set(vm.mediaResult.optimizablePhotos.prefix(12).map(\.id))
            }
        }
    }

    private var videoCompressorList: some View {
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
    }

    private var photoOptimizerList: some View {
        let candidates = vm.mediaResult.optimizablePhotos
        let gpsCount = candidates.filter(\.hasLocation).count

        return ScrollView {
            VStack(spacing: 14) {
                VStack(alignment: .leading, spacing: 10) {
                    Toggle("Compress File Size (82% JPEG)", isOn: $compressFileSize)
                        .font(.subheadline.weight(.semibold))
                    Toggle("Strip EXIF GPS Location Coordinates (\(gpsCount) with GPS)", isOn: $stripGpsCoordinates)
                        .font(.subheadline.weight(.semibold))
                    Toggle("Move Original to 30-Day Trash", isOn: $moveOriginalsToTrash)
                        .font(.subheadline.weight(.semibold))

                    Button {
                        if vm.hasPremium {
                            Task {
                                await vm.optimizePhotos(
                                    ids: Array(selectedPhotoIDs),
                                    compressQuality: compressFileSize,
                                    stripGps: stripGpsCoordinates,
                                    deleteOriginals: moveOriginalsToTrash
                                )
                            }
                        } else {
                            onShowPaywall()
                        }
                    } label: {
                        Text("Optimize \(selectedPhotoIDs.count) Selected Photos")
                            .fontWeight(.bold)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            .background(Color.sweeprEmerald)
                            .foregroundColor(.white)
                            .cornerRadius(10)
                    }
                    .disabled(selectedPhotoIDs.isEmpty || vm.isWorking || (!compressFileSize && !stripGpsCoordinates))
                }
                .padding()
                .background(Color.cardBackground)
                .cornerRadius(14)
                .padding(.horizontal)

                if candidates.isEmpty {
                    emptyCategoryState(
                        icon: "photo.badge.checkmark",
                        title: "No Optimizable or GPS-Tagged Photos",
                        subtitle: "Photos over 1.5 MB or containing EXIF GPS location coordinates will appear here."
                    )
                } else {
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
                            }
                        }
                    }
                    .padding(.horizontal)
                }
            }
            .padding(.bottom)
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
            }
        }
        .navigationTitle(title)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button(isSwipeMode ? "Grid View" : "Swipe Triage") {
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

    var body: some View {
        VStack(spacing: 0) {
            Picker("Contacts & Calendar Mode", selection: $selectedMode) {
                Text("Duplicates (\(vm.contactGroups.count))").tag(0)
                Text("Incomplete (\(vm.incompleteContacts.count))").tag(1)
                Text("Old Calendar (>1 yr)").tag(2)
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
        .toolbar {
            ToolbarItem(placement: .bottomBar) {
                if selectedMode == 0 {
                    Button("Smart Merge Selected (\(vm.selectedContactGroupIDs.count))") {
                        guard vm.hasPremium else { vm.showingPaywall = true; return }
                        Task { await vm.mergeSelectedContacts() }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.sweeprEmerald)
                    .disabled(vm.selectedContactGroupIDs.isEmpty || vm.isWorking)
                    .accessibilityLabel("Smart merge \(vm.selectedContactGroupIDs.count) duplicate contact groups")
                } else if selectedMode == 1 {
                    Button("Delete Incomplete (\(vm.selectedIncompleteContactIDs.count))") {
                        guard vm.hasPremium else { vm.showingPaywall = true; return }
                        Task { await vm.deleteSelectedIncompleteContacts() }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.red)
                    .disabled(vm.selectedIncompleteContactIDs.isEmpty || vm.isWorking)
                    .accessibilityLabel("Delete \(vm.selectedIncompleteContactIDs.count) incomplete contacts")
                } else {
                    Button("Delete Old Events (\(vm.selectedCalendarEventIDs.count))") {
                        guard vm.hasPremium else { vm.showingPaywall = true; return }
                        Task { await vm.deleteSelectedCalendarEvents() }
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
