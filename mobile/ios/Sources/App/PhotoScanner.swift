import AVFoundation
import CryptoKit
import Foundation
import ImageIO
import MobileCoreServices
import Photos
import UIKit
import UniformTypeIdentifiers

struct MediaItem: Identifiable, Hashable {
    let id: String // PHAsset.localIdentifier
    let creationDate: Date
    let isVideo: Bool
    let isScreenshot: Bool
    let duration: TimeInterval
    let pixelWidth: Int
    let pixelHeight: Int
    let estimatedBytes: Int64
    let sha256Hash: String
    let dHash: UInt64
    let sharpness: Double
    let isBlurry: Bool
    var hasLocation: Bool = false

    var resolutionPixels: Int {
        pixelWidth * pixelHeight
    }

    var resolutionLabel: String {
        "\(pixelWidth)×\(pixelHeight)"
    }

    /// Combined score used for "Best Shot" recommendation in similar/burst groups.
    var bestShotScore: Double {
        let megapixelScore = Double(resolutionPixels) / 1_000_000.0
        return (sharpness * 2.0) + (megapixelScore * 4.0)
    }
}

struct MediaGroup: Identifiable {
    let id: String
    let items: [MediaItem]

    /// The highest-scoring item recommended to keep ("Best Shot").
    var bestShot: MediaItem { items[0] }
    var keep: MediaItem { items[0] }
    var extras: [MediaItem] { Array(items.dropFirst()) }
    var reclaimableBytes: Int64 { extras.reduce(0) { $0 + $1.estimatedBytes } }
}

struct VideoCompressionResult {
    let originalAssetId: String
    let newAssetId: String?
    let originalBytes: Int64
    let compressedBytes: Int64

    var savedBytes: Int64 {
        max(0, originalBytes - compressedBytes)
    }
}

struct PhotoOptimizationResult {
    let originalAssetId: String
    let newAssetId: String?
    let originalBytes: Int64
    let optimizedBytes: Int64
    let gpsStripped: Bool

    var savedBytes: Int64 {
        max(0, originalBytes - optimizedBytes)
    }
}

struct MediaScanResult {
    var duplicateGroups: [MediaGroup] = []
    var similarGroups: [MediaGroup] = []
    var blurryPhotos: [MediaItem] = []
    var screenshots: [MediaItem] = []
    var largeVideos: [MediaItem] = []
    var allItems: [MediaItem] = []

    var optimizablePhotos: [MediaItem] {
        allItems.filter { !$0.isVideo && ($0.estimatedBytes >= PhotoScanner.optimizablePhotoThreshold || $0.hasLocation) }
    }

    var totalReclaimableBytes: Int64 {
        let dupBytes = duplicateGroups.reduce(0) { $0 + $1.reclaimableBytes }
        let simBytes = similarGroups.reduce(0) { $0 + $1.reclaimableBytes }
        let shotBytes = screenshots.reduce(0) { $0 + $1.estimatedBytes }
        let vidBytes = largeVideos.reduce(0) { $0 + $1.estimatedBytes }
        let blurBytes = blurryPhotos.reduce(0) { $0 + $1.estimatedBytes }
        return dupBytes + simBytes + shotBytes + vidBytes + blurBytes
    }

    func removing(ids: Set<String>) -> MediaScanResult {
        func filterGroups(_ groups: [MediaGroup]) -> [MediaGroup] {
            groups.compactMap { group in
                let remaining = group.items.filter { !ids.contains($0.id) }
                return remaining.count >= 2 ? MediaGroup(id: group.id, items: remaining) : nil
            }
        }
        return MediaScanResult(
            duplicateGroups: filterGroups(duplicateGroups),
            similarGroups: filterGroups(similarGroups),
            blurryPhotos: blurryPhotos.filter { !ids.contains($0.id) },
            screenshots: screenshots.filter { !ids.contains($0.id) },
            largeVideos: largeVideos.filter { !ids.contains($0.id) },
            allItems: allItems.filter { !ids.contains($0.id) }
        )
    }
}

typealias MediaScanner = PhotoScanner

enum PhotoScanner {
    /// Videos larger than 50 MB are surfaced for hardware compression or deletion (#35).
    static let largeVideoThreshold: Int64 = 50 * 1024 * 1024
    /// Photos larger than 1.5 MB or with GPS location tags are surfaced for Photo Optimizer & Privacy (#1, #9).
    static let optimizablePhotoThreshold: Int64 = 1_536 * 1024
    private static let similarWindowSeconds: TimeInterval = 5.0
    private static let similarMaxHammingDistance = 10
    private static let blurThreshold: Double = 28.0
    private static let maxChunkHashBytes = 256 * 1024 // 256 KB chunk for fast on-device SHA-256

    static func requestAuthorization() async -> PHAuthorizationStatus {
        await PHPhotoLibrary.requestAuthorization(for: .readWrite)
    }

    static func scan(onProgress: (@Sendable (String) -> Void)? = nil) async -> MediaScanResult {
        await Task.detached(priority: .userInitiated) {
            await performScan(onProgress: onProgress)
        }.value
    }

    /// Batch deletes assets via `PHAssetChangeRequest.deleteAssets`, moving them to the iOS
    /// "Recently Deleted" album where they remain recoverable for 30 days.
    static func deleteAssets(identifiers: [String]) async throws {
        guard !identifiers.isEmpty else { return }
        let fetchResult = PHAsset.fetchAssets(withLocalIdentifiers: identifiers, options: nil)
        try await PHPhotoLibrary.shared().performChanges {
            PHAssetChangeRequest.deleteAssets(fetchResult)
        }
    }

    /// #1 Batch Photo Optimizer + #9 EXIF GPS Privacy Stripper.
    /// Uses `CGImageSource` and `CGImageDestination` with `kCGImagePropertyGPSDictionary: kCFNull`
    /// and `0.82` JPEG compression quality to strip GPS metadata and shrink oversized photos.
    static func optimizePhoto(
        assetId: String,
        compressQuality: Bool = true,
        stripGps: Bool = true,
        deleteOriginal: Bool = false
    ) async throws -> PhotoOptimizationResult {
        let fetchResult = PHAsset.fetchAssets(withLocalIdentifiers: [assetId], options: nil)
        guard let asset = fetchResult.firstObject, asset.mediaType == .image else {
            throw NSError(
                domain: "SweeprPhotoScanner",
                code: 404,
                userInfo: [NSLocalizedDescriptionKey: "Photo asset not found in Photo Library."]
            )
        }

        let imageData = try await requestImageData(for: asset)
        let originalBytes = Int64(imageData.count)
        guard let source = CGImageSourceCreateWithData(imageData as CFData, nil) else {
            throw NSError(
                domain: "SweeprPhotoScanner",
                code: 500,
                userInfo: [NSLocalizedDescriptionKey: "Could not read photo metadata stream."]
            )
        }

        let rawProps = (CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]) ?? [:]
        let hadGps = rawProps[kCGImagePropertyGPSDictionary] != nil || asset.location != nil

        let mutableData = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(
            mutableData,
            UTType.jpeg.identifier as CFString,
            1,
            nil
        ) else {
            throw NSError(
                domain: "SweeprPhotoScanner",
                code: 501,
                userInfo: [NSLocalizedDescriptionKey: "Could not initialize JPEG destination encoder."]
            )
        }

        var destOptions: [CFString: Any] = rawProps
        if stripGps {
            destOptions[kCGImagePropertyGPSDictionary] = kCFNull
        }
        if compressQuality {
            destOptions[kCGImageDestinationLossyCompressionQuality] = 0.82
            destOptions[kCGImageDestinationImageMaxPixelSize] = 2560
        } else {
            destOptions[kCGImageDestinationLossyCompressionQuality] = 0.95
        }

        if compressQuality {
            let thumbOpts: [CFString: Any] = [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: 2560
            ]
            if let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, thumbOpts as CFDictionary) {
                destOptions[kCGImagePropertyOrientation] = 1
                CGImageDestinationAddImage(destination, cgImage, destOptions as CFDictionary)
            } else {
                CGImageDestinationAddImageFromSource(destination, source, 0, destOptions as CFDictionary)
            }
        } else {
            CGImageDestinationAddImageFromSource(destination, source, 0, destOptions as CFDictionary)
        }

        guard CGImageDestinationFinalize(destination), mutableData.length > 0 else {
            throw NSError(
                domain: "SweeprPhotoScanner",
                code: 502,
                userInfo: [NSLocalizedDescriptionKey: "Could not finalize optimized photo."]
            )
        }

        let outputData = mutableData as Data
        let optimizedBytes = Int64(outputData.count)

        var createdPlaceholderId: String?
        try await PHPhotoLibrary.shared().performChanges {
            let creationRequest = PHAssetCreationRequest.forAsset()
            creationRequest.addResource(with: .photo, data: outputData, options: nil)
            creationRequest.creationDate = asset.creationDate
            if !stripGps {
                creationRequest.location = asset.location
            }
            createdPlaceholderId = creationRequest.placeholderForCreatedAsset?.localIdentifier
            if deleteOriginal {
                PHAssetChangeRequest.deleteAssets(fetchResult)
            }
        }

        return PhotoOptimizationResult(
            originalAssetId: assetId,
            newAssetId: createdPlaceholderId,
            originalBytes: originalBytes,
            optimizedBytes: compressQuality ? min(optimizedBytes, originalBytes) : optimizedBytes,
            gpsStripped: stripGps && hadGps
        )
    }

    private static func requestImageData(for asset: PHAsset) async throws -> Data {
        try await withCheckedThrowingContinuation { continuation in
            let options = PHImageRequestOptions()
            options.isNetworkAccessAllowed = true
            options.deliveryMode = .highQualityFormat
            options.version = .current
            var resumed = false
            PHImageManager.default().requestImageDataAndOrientation(for: asset, options: options) { data, _, _, info in
                guard !resumed else { return }
                resumed = true
                if let data = data {
                    continuation.resume(returning: data)
                } else {
                    let err = (info?[PHImageErrorKey] as? Error) ?? NSError(
                        domain: "SweeprPhotoScanner",
                        code: 503,
                        userInfo: [NSLocalizedDescriptionKey: "Unable to load photo data from Photo Library."]
                    )
                    continuation.resume(throwing: err)
                }
            }
        }
    }

    /// Compresses a large video (>50 MB) using hardware-accelerated `AVAssetExportSession`
    /// (`AVAssetExportPresetMediumQuality`), saves the smaller video back to `PHPhotoLibrary`,
    /// and optionally moves the original large video to Recently Deleted.
    static func compressVideo(assetId: String, deleteOriginal: Bool = true) async throws -> VideoCompressionResult {
        let fetchResult = PHAsset.fetchAssets(withLocalIdentifiers: [assetId], options: nil)
        guard let asset = fetchResult.firstObject, asset.mediaType == .video else {
            throw NSError(
                domain: "SweeprPhotoScanner",
                code: 404,
                userInfo: [NSLocalizedDescriptionKey: "Video asset not found in Photo Library."]
            )
        }

        let resources = PHAssetResource.assetResources(for: asset)
        let originalBytes = resources.first.flatMap { res in
            (res.value(forKey: "fileSize") as? CLong).map { Int64($0) }
        } ?? 0

        let avAsset = try await requestAVAsset(for: asset)
        guard let exportSession = AVAssetExportSession(
            asset: avAsset,
            presetName: AVAssetExportPresetMediumQuality
        ) else {
            throw NSError(
                domain: "SweeprPhotoScanner",
                code: 500,
                userInfo: [NSLocalizedDescriptionKey: "Could not initialize hardware video compressor."]
            )
        }

        let tempURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("sweepr_compressed_\(UUID().uuidString).mp4")
        try? FileManager.default.removeItem(at: tempURL)

        exportSession.outputURL = tempURL
        exportSession.outputFileType = .mp4
        exportSession.shouldOptimizeForNetworkUse = true

        await exportSession.export()

        if let error = exportSession.error {
            try? FileManager.default.removeItem(at: tempURL)
            throw error
        }
        guard exportSession.status == .completed else {
            try? FileManager.default.removeItem(at: tempURL)
            throw NSError(
                domain: "SweeprPhotoScanner",
                code: 501,
                userInfo: [NSLocalizedDescriptionKey: "Video compression did not complete (\(exportSession.status.rawValue))."]
            )
        }

        let attr = try? FileManager.default.attributesOfItem(atPath: tempURL.path)
        let compressedBytes = (attr?[.size] as? NSNumber)?.int64Value ?? 0

        // Only replace if compression actually reduced file size
        guard compressedBytes > 0 && (originalBytes == 0 || compressedBytes < originalBytes) else {
            try? FileManager.default.removeItem(at: tempURL)
            throw NSError(
                domain: "SweeprPhotoScanner",
                code: 422,
                userInfo: [NSLocalizedDescriptionKey: "Video is already optimally compressed."]
            )
        }

        var createdPlaceholderId: String?
        try await PHPhotoLibrary.shared().performChanges {
            if let creationRequest = PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: tempURL) {
                creationRequest.creationDate = asset.creationDate
                creationRequest.location = asset.location
                createdPlaceholderId = creationRequest.placeholderForCreatedAsset?.localIdentifier
            }
            if deleteOriginal {
                PHAssetChangeRequest.deleteAssets(fetchResult)
            }
        }

        try? FileManager.default.removeItem(at: tempURL)

        return VideoCompressionResult(
            originalAssetId: assetId,
            newAssetId: createdPlaceholderId,
            originalBytes: originalBytes,
            compressedBytes: compressedBytes
        )
    }

    private static func requestAVAsset(for asset: PHAsset) async throws -> AVAsset {
        try await withCheckedThrowingContinuation { continuation in
            let options = PHVideoRequestOptions()
            options.isNetworkAccessAllowed = true
            options.deliveryMode = .highQualityFormat
            var resumed = false
            PHImageManager.default().requestAVAsset(forVideo: asset, options: options) { avAsset, _, info in
                guard !resumed else { return }
                resumed = true
                if let avAsset = avAsset {
                    continuation.resume(returning: avAsset)
                } else {
                    let err = (info?[PHImageErrorKey] as? Error) ?? NSError(
                        domain: "SweeprPhotoScanner",
                        code: 502,
                        userInfo: [NSLocalizedDescriptionKey: "Unable to load video stream from Photo Library."]
                    )
                    continuation.resume(throwing: err)
                }
            }
        }
    }

    private static func performScan(onProgress: (@Sendable (String) -> Void)?) async -> MediaScanResult {
        onProgress?("Indexing photo & video library…")
        let options = PHFetchOptions()
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        let fetched = PHAsset.fetchAssets(with: options)
        let imageManager = PHImageManager.default()
        let requestOptions = PHImageRequestOptions()
        requestOptions.isSynchronous = true
        requestOptions.deliveryMode = .fastFormat
        requestOptions.resizeMode = .fast
        requestOptions.isNetworkAccessAllowed = false

        var rawItems: [(asset: PHAsset, item: MediaItem)] = []
        rawItems.reserveCapacity(min(fetched.count, 5000))

        fetched.enumerateObjects { asset, _, stop in
            if rawItems.count >= 5000 {
                stop.pointee = true
                return
            }
            let resources = PHAssetResource.assetResources(for: asset)
            let byteSize = resources.first.flatMap { res in
                (res.value(forKey: "fileSize") as? CLong).map { Int64($0) }
            } ?? Int64(asset.pixelWidth * asset.pixelHeight / 2)

            let isVideo = asset.mediaType == .video
            let isScreenshot = asset.mediaSubtypes.contains(.photoScreenshot)

            var dHash: UInt64 = 0
            var sharpness: Double = 100.0
            if !isVideo {
                imageManager.requestImage(
                    for: asset,
                    targetSize: CGSize(width: 64, height: 64),
                    contentMode: .aspectFill,
                    options: requestOptions
                ) { image, _ in
                    if let cgImage = image?.cgImage {
                        let features = analyzeThumbnail(cgImage)
                        dHash = features.dHash
                        sharpness = features.sharpness
                    }
                }
            }

            let isBlurry = !isVideo && !isScreenshot
                && asset.pixelWidth >= 400 && asset.pixelHeight >= 400
                && sharpness < blurThreshold

            let item = MediaItem(
                id: asset.localIdentifier,
                creationDate: asset.creationDate ?? Date.distantPast,
                isVideo: isVideo,
                isScreenshot: isScreenshot,
                duration: asset.duration,
                pixelWidth: asset.pixelWidth,
                pixelHeight: asset.pixelHeight,
                estimatedBytes: max(byteSize, 1024),
                sha256Hash: "",
                dHash: dHash,
                sharpness: sharpness,
                isBlurry: isBlurry,
                hasLocation: !isVideo && asset.location != nil
            )
            rawItems.append((asset, item))
        }

        // Pre-group by size + dimensions/duration so we only compute SHA-256 on candidate collisions
        var sizeBuckets: [String: [(asset: PHAsset, item: MediaItem)]] = [:]
        for entry in rawItems where entry.item.estimatedBytes > 0 {
            let bucketKey = entry.item.isVideo
                ? "v:\(entry.item.estimatedBytes):\(Int(entry.item.duration.rounded()))"
                : "p:\(entry.item.estimatedBytes):\(entry.item.pixelWidth)x\(entry.item.pixelHeight)"
            sizeBuckets[bucketKey, default: []].append(entry)
        }

        onProgress?("Computing SHA-256 hashes for duplicate candidates…")
        var enrichedById: [String: MediaItem] = [:]
        for entry in rawItems {
            enrichedById[entry.item.id] = entry.item
        }

        var duplicateGroups: [MediaGroup] = []
        for (bucketKey, candidates) in sizeBuckets where candidates.count >= 2 {
            var hashSubgroups: [String: [MediaItem]] = [:]
            for candidate in candidates {
                let digest = await computeChunkedSHA256(
                    for: candidate.asset,
                    estimatedBytes: candidate.item.estimatedBytes,
                    fallbackDHash: candidate.item.dHash
                )
                let updated = MediaItem(
                    id: candidate.item.id,
                    creationDate: candidate.item.creationDate,
                    isVideo: candidate.item.isVideo,
                    isScreenshot: candidate.item.isScreenshot,
                    duration: candidate.item.duration,
                    pixelWidth: candidate.item.pixelWidth,
                    pixelHeight: candidate.item.pixelHeight,
                    estimatedBytes: candidate.item.estimatedBytes,
                    sha256Hash: digest,
                    dHash: candidate.item.dHash,
                    sharpness: candidate.item.sharpness,
                    isBlurry: candidate.item.isBlurry,
                    hasLocation: candidate.item.hasLocation
                )
                enrichedById[updated.id] = updated
                hashSubgroups[digest, default: []].append(updated)
            }

            for (digest, matches) in hashSubgroups where matches.count >= 2 {
                // Keep earliest original first
                let sorted = matches.sorted { $0.creationDate < $1.creationDate }
                duplicateGroups.append(MediaGroup(id: "dup:\(bucketKey):\(digest.prefix(16))", items: sorted))
            }
        }

        let items = rawItems.compactMap { enrichedById[$0.item.id] }
        let duplicateIDs = Set(duplicateGroups.flatMap { $0.items.map(\.id) })

        // 2. Similar Photos: perceptual 8x8 dHash (Hamming distance <= 10) within time window,
        // ranked by sharpness + resolution so index 0 is the "Best Shot".
        onProgress?("Grouping similar photos & ranking Best Shots…")
        let candidatePhotos = items
            .filter { !$0.isVideo && !$0.isScreenshot && !duplicateIDs.contains($0.id) }
            .sorted { $0.creationDate < $1.creationDate }

        var similarGroups: [MediaGroup] = []
        var currentCluster: [MediaItem] = []

        func flushCluster(_ cluster: [MediaItem]) {
            guard cluster.count >= 2 else { return }
            let ranked = cluster.sorted { a, b in
                if abs(a.bestShotScore - b.bestShotScore) > 1.0 {
                    return a.bestShotScore > b.bestShotScore
                }
                return a.estimatedBytes > b.estimatedBytes
            }
            similarGroups.append(MediaGroup(id: "sim:\(ranked[0].id)", items: ranked))
        }

        for photo in candidatePhotos {
            if let last = currentCluster.last {
                let deltaSeconds = abs(photo.creationDate.timeIntervalSince(last.creationDate))
                let hamming = (photo.dHash ^ last.dHash).nonzeroBitCount
                if deltaSeconds <= similarWindowSeconds && hamming <= similarMaxHammingDistance {
                    currentCluster.append(photo)
                } else {
                    flushCluster(currentCluster)
                    currentCluster = [photo]
                }
            } else {
                currentCluster = [photo]
            }
        }
        flushCluster(currentCluster)

        let blurryPhotos = items.filter { $0.isBlurry && !duplicateIDs.contains($0.id) }
        let screenshots = items.filter(\.isScreenshot)
        let largeVideos = items
            .filter { $0.isVideo && $0.estimatedBytes >= largeVideoThreshold }
            .sorted { $0.estimatedBytes > $1.estimatedBytes }

        return MediaScanResult(
            duplicateGroups: duplicateGroups,
            similarGroups: similarGroups,
            blurryPhotos: blurryPhotos,
            screenshots: screenshots,
            largeVideos: largeVideos,
            allItems: items
        )
    }

    /// Reads up to `maxChunkHashBytes` of raw asset resource chunks and computes a SHA-256 digest.
    private static func computeChunkedSHA256(
        for asset: PHAsset,
        estimatedBytes: Int64,
        fallbackDHash: UInt64
    ) async -> String {
        let resources = PHAssetResource.assetResources(for: asset)
        guard let primaryResource = resources.first else {
            var hasher = SHA256()
            hasher.update(data: Data("\(estimatedBytes):\(fallbackDHash)".utf8))
            return hasher.finalize().map { String(format: "%02x", $0) }.joined()
        }

        return await withCheckedContinuation { continuation in
            let options = PHAssetResourceRequestOptions()
            options.isNetworkAccessAllowed = false

            var hasher = SHA256()
            hasher.update(data: Data("size:\(estimatedBytes):".utf8))
            var bytesRead = 0
            var completed = false

            PHAssetResourceManager.default().requestData(
                for: primaryResource,
                options: options,
                dataReceivedHandler: { chunk in
                    guard bytesRead < maxChunkHashBytes else { return }
                    let sliceCount = min(chunk.count, maxChunkHashBytes - bytesRead)
                    hasher.update(data: chunk.prefix(sliceCount))
                    bytesRead += sliceCount
                },
                completionHandler: { error in
                    guard !completed else { return }
                    completed = true
                    if error != nil && bytesRead == 0 {
                        hasher.update(data: Data("dhash:\(fallbackDHash)".utf8))
                    }
                    let digest = hasher.finalize().map { String(format: "%02x", $0) }.joined()
                    continuation.resume(returning: digest)
                }
            )
        }
    }

    /// Computes a perceptual 8x8 dHash (64-bit horizontal gradient hash) and discrete Laplacian sharpness.
    private static func analyzeThumbnail(_ cgImage: CGImage) -> (dHash: UInt64, sharpness: Double) {
        let width = 32
        let height = 32
        var gray = [Double](repeating: 0, count: width * height)
        var raw = [UInt8](repeating: 0, count: width * height * 4)

        let colorSpace = CGColorSpaceCreateDeviceRGB()
        if let context = CGContext(
            data: &raw,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: width * 4,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) {
            context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
        }

        for i in 0..<(width * height) {
            let r = Double(raw[i * 4])
            let g = Double(raw[i * 4 + 1])
            let b = Double(raw[i * 4 + 2])
            gray[i] = 0.299 * r + 0.587 * g + 0.114 * b
        }

        // Perceptual 8x8 dHash sampled across 9 columns x 8 rows of the luma buffer
        var hash: UInt64 = 0
        var bit = 0
        for row in 0..<8 {
            let sy = (row * (height - 1)) / 7
            for col in 0..<8 {
                let sx1 = (col * (width - 1)) / 8
                let sx2 = ((col + 1) * (width - 1)) / 8
                if gray[sy * width + sx1] > gray[sy * width + sx2] {
                    hash |= (1 << UInt64(bit))
                }
                bit += 1
            }
        }

        // Discrete Laplacian variance for sharpness / blur detection
        var sum = 0.0
        var sumSq = 0.0
        var count = 0.0
        for y in 1..<(height - 1) {
            for x in 1..<(width - 1) {
                let center = gray[y * width + x]
                let lap = -4.0 * center
                    + gray[(y - 1) * width + x]
                    + gray[(y + 1) * width + x]
                    + gray[y * width + (x - 1)]
                    + gray[y * width + (x + 1)]
                sum += lap
                sumSq += lap * lap
                count += 1.0
            }
        }
        guard count > 0 else { return (hash, 100.0) }
        let mean = sum / count
        let variance = max(0.0, (sumSq / count) - (mean * mean))
        return (hash, sqrt(variance))
    }
}
