// DexFlip's contract, verbatim, plus the poke-sort engine's conformance.
//
// The recommended amendment (see the port README, gate answer G1): pass the
// card quad DexFlip's rectangle detector already has, so the engine receives a
// deskewed upright card instead of hunting for one in a 12 MP scene. The
// unamended entry point below still works — it runs the same rectangle
// detection internally as a fallback — but the quad-aware overload is the one
// the sorter's accuracy numbers were earned under.

import CoreGraphics
import CoreImage
import Foundation
import ImageIO
import Vision

/// One ranked recognition result.
struct Candidate: Codable, Sendable, Equatable, Hashable {
    /// Locale-neutral TCGdex card identifier.
    var tcgdexCardId: String
    /// Display name from the bundled index — no network required at capture.
    var displayName: String
    /// Normalized to 0…1.
    var confidence: Double
}

protocol RecognitionService: Sendable {
    /// Identifies the card in `image` (HEIC data from the front shutter).
    /// Ranked descending by confidence; empty is a valid whiff.
    func identify(_ image: Data) async -> [Candidate]
}

/// How many alternates the review strip gets. The engine ranks up to 50
/// internally; below ~6 the fused scores are noise-ordering near-ties.
private let maxCandidates = 6

final class PokeSortRecognitionService: RecognitionService {
    private let identifier: CardIdentifier

    init(identifier: CardIdentifier) {
        self.identifier = identifier
    }

    /// Convenience: load the bundled index + model once. Expensive (~1-2s of
    /// disk + model compile) — create one instance at app start, off the main
    /// actor, and share it.
    convenience init(bundle: Bundle = .main, modelURL: URL) throws {
        let index = try CardIndex(bundle: bundle)
        let embedder = try SigLIPEmbedder(modelURL: modelURL)
        self.init(identifier: CardIdentifier(index: index, embedder: embedder))
    }

    // MARK: - The contract entry point (full frame, engine finds the card)

    func identify(_ image: Data) async -> [Candidate] {
        // EXIF orientation is honoured HERE, once, at the decode boundary:
        // CGImageSourceCreateImageAtIndex returns raw pixel order, so the
        // orientation tag is read and applied explicitly. This is the classic
        // silent failure the contract asks about in G2b.
        guard let upright = decodeHonoringOrientation(image) else { return [] }
        guard let card = detectAndDeskewCard(in: upright) else { return [] }
        return await identifyCard(card)
    }

    // MARK: - The amended entry point (DexFlip supplies the quad)

    /// `quad` in Vision's normalized coordinates (origin bottom-left), the
    /// four card corners from DexFlip's existing DetectRectanglesRequest,
    /// relative to the full frame after orientation is applied.
    func identify(_ image: Data, cardQuad quad: [CGPoint]) async -> [Candidate] {
        guard let upright = decodeHonoringOrientation(image),
              let card = deskew(upright, quad: quad) else { return [] }
        return await identifyCard(card)
    }

    private func identifyCard(_ card: CGImage) async -> [Candidate] {
        // Failure surfaces as a whiff, per the contract. Cancellation also
        // returns [] — the caller discards stale results anyway.
        guard let outcome = try? await identifier.identify(card: card) else { return [] }
        return outcome.ranked.prefix(maxCandidates).compactMap { ranked in
            outcome.cardsById[ranked.id].map {
                Candidate(
                    tcgdexCardId: $0.id,
                    displayName: displayName($0),
                    confidence: ranked.score)
            }
        }
    }

    private func displayName(_ card: IndexedCard) -> String {
        // "Charizard — Base Set 4/102" when the parts exist; the bare name
        // otherwise. The set qualifier is what makes reprints tellable apart
        // in the review strip.
        var name = card.name
        if let setName = card.setName {
            name += " — \(setName)"
            if let number = card.collectorNumber {
                name += " \(number)"
                if let total = card.setTotal { name += "/\(total)" }
            }
        }
        return name
    }

    // MARK: - Image plumbing

    private func decodeHonoringOrientation(_ data: Data) -> CGImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, [
                  kCGImageSourceShouldCache: true,
              ] as CFDictionary)
        else { return nil }
        let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
        let raw = props?[kCGImagePropertyOrientation] as? UInt32 ?? 1
        guard let orientation = CGImagePropertyOrientation(rawValue: raw),
              orientation != .up else { return image }
        return bake(orientation: orientation, into: image)
    }

    private func bake(orientation: CGImagePropertyOrientation, into image: CGImage) -> CGImage? {
        // CIImage.oriented() is the least error-prone way to apply all eight
        // EXIF cases; a hand-rolled transform gets the mirrored ones wrong.
        let ci = CIImage(cgImage: image).oriented(orientation)
        return CIContext().createCGImage(ci, from: ci.extent)
    }

    /// Fallback card location for the unamended contract: the same Vision
    /// rectangle detection DexFlip already runs for its "Card detected" pill,
    /// tuned to the 2.5x3.5 card aspect.
    private func detectAndDeskewCard(in image: CGImage) -> CGImage? {
        let request = VNDetectRectanglesRequest()
        request.minimumAspectRatio = 0.6   // 2.5/3.5 ≈ 0.714, with tilt slack
        request.maximumAspectRatio = 0.85
        request.minimumSize = 0.2
        request.minimumConfidence = 0.5
        request.maximumObservations = 1
        try? VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
        guard let rect = request.results?.first else { return nil }
        return deskew(
            image,
            quad: [rect.topLeft, rect.topRight, rect.bottomRight, rect.bottomLeft])
    }

    /// Perspective-correct the quad to an upright 745x1043 card — the exact
    /// output geometry of the sorter's extractCardImage (card-detection.ts),
    /// which is the input every accuracy number was measured at.
    private func deskew(_ image: CGImage, quad: [CGPoint]) -> CGImage? {
        guard quad.count == 4 else { return nil }
        let w = CGFloat(image.width), h = CGFloat(image.height)
        let px = quad.map { CGPoint(x: $0.x * w, y: $0.y * h) }
        let ci = CIImage(cgImage: image)
        let corrected = ci.applyingFilter("CIPerspectiveCorrection", parameters: [
            "inputTopLeft": CIVector(cgPoint: px[0]),
            "inputTopRight": CIVector(cgPoint: px[1]),
            "inputBottomRight": CIVector(cgPoint: px[2]),
            "inputBottomLeft": CIVector(cgPoint: px[3]),
        ])
        let scaled = corrected.transformed(by: CGAffineTransform(
            scaleX: 745 / corrected.extent.width,
            y: 1043 / corrected.extent.height))
        return CIContext().createCGImage(scaled, from: scaled.extent)
    }
}
