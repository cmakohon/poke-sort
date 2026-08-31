// DexFlip's pinned contract (interface pin, 2026-08-31) and the poke-sort
// engine's conformance.
//
// Division of responsibility, per the pin:
//   DexFlip: rectangle detection, EXIF baked in, sRGB, upright pixels, long
//            axis vertical (never 90° off), normalized top-left-origin quad,
//            whiffing when no rectangle is found, persisting versionTag.
//   Engine:  perspective warp to 745x1043, 180° recovery, embedding, OCR,
//            fusion, gating, the verdict, ranking, setLabel.

import CoreGraphics
import CoreImage
import Foundation

/// The card's four corners within the image passed alongside it.
/// Normalized 0…1. Origin is TOP-LEFT, y increases DOWNWARD.
struct CardQuad: Sendable, Equatable {
    var topLeft: CGPoint
    var topRight: CGPoint
    var bottomRight: CGPoint
    var bottomLeft: CGPoint
}

enum RecognitionVerdict: String, Codable, Sendable {
    /// The gate cleared it — score ≥ 0.4 and margin ≥ 0.06,
    /// or the unambiguous-image release valve.
    case accept
    /// Matched, but below the accept gate. Wants a human look.
    case review
    /// Below the no-match floor. `candidates` is empty.
    case noMatch
}

struct Identification: Sendable, Equatable {
    /// Ranked strictly descending. Up to 6. Empty iff verdict == .noMatch.
    var candidates: [Candidate]
    var verdict: RecognitionVerdict
}

struct Candidate: Codable, Sendable, Equatable, Hashable {
    var tcgdexCardId: String   // native id space, e.g. "base1-4"
    var displayName: String    // bare, e.g. "Charizard" — capture-time banner
    var setLabel: String       // e.g. "Base Set 4/102" — review strip
    var confidence: Double     // 0…1, higher better
}

protocol RecognitionService: Sendable {
    /// Stable for the life of the service. DexFlip treats it as opaque and
    /// only ever compares it for equality — it is stamped onto every Card so
    /// a future re-identify against a newer index stays possible.
    nonisolated var versionTag: String { get }

    /// Identifies the card bounded by `quad` within `image`.
    /// Non-throwing: any failure is `.noMatch` with no candidates.
    func identify(_ image: CGImage, quad: CardQuad) async -> Identification
}

/// How many alternates the review strip gets. The engine ranks up to 50
/// internally; below ~6 the fused scores are noise-ordering near-ties.
private let maxCandidates = 6

/// Bump when the fusion/gating logic in this port changes behaviour without
/// the index changing. Folded into versionTag.
private let engineRevision = 1

final class PokeSortRecognitionService: RecognitionService {
    private let identifier: CardIdentifier
    let versionTag: String

    init(index: CardIndex, embedder: any CardEmbedder) {
        identifier = CardIdentifier(index: index, embedder: embedder)
        // Everything that can silently change a result, in one comparable
        // string: the embedding pipeline identity the index was built under,
        // the index size, and this port's logic revision. The catalog
        // re-embed (Core ML) bumps `identity.model/dtype` at export time, so
        // a re-embedded index changes the tag without anyone remembering to.
        let id = index.identity
        versionTag = [
            "pokesort-e\(engineRevision)",
            id.model, id.dtype,
            "pre\(id.preprocessing)", "art\(id.artWindows)",
            "n\(index.cards.count)",
        ].joined(separator: "|")
    }

    /// Create the one shared instance at app start, OFF the main actor.
    /// Throwing here is deliberate (interface pin §5): a missing model or
    /// corrupt index must fail loudly at startup, not degrade to 100% silent
    /// whiffs.
    convenience init(bundle: Bundle = .main, modelURL: URL) throws {
        self.init(
            index: try CardIndex(bundle: bundle),
            embedder: try SigLIPEmbedder(modelURL: modelURL))
    }

    func identify(_ image: CGImage, quad: CardQuad) async -> Identification {
        // Self-check from the pin: on a correctly interpreted top-left-origin
        // quad the top edge is above the bottom and left is left of right.
        // A violation means an axis got flipped somewhere on the way here.
        assert(
            quad.topLeft.y < quad.bottomLeft.y && quad.topLeft.x < quad.topRight.x,
            "CardQuad axis flipped: expected top-left origin, y down")

        guard let card = deskew(image, quad: quad) else {
            return Identification(candidates: [], verdict: .noMatch)
        }
        // Non-throwing by contract: cancellation and internal errors are
        // whiffs — a cancelled call's result is discarded by the caller anyway.
        guard let outcome = try? await identifier.identify(card: card),
              outcome.tier != .noMatch else {
            return Identification(candidates: [], verdict: .noMatch)
        }
        let candidates = outcome.ranked.prefix(maxCandidates).compactMap { ranked in
            outcome.cardsById[ranked.id].map {
                Candidate(
                    tcgdexCardId: $0.id,
                    displayName: $0.name,
                    setLabel: setLabel($0),
                    confidence: ranked.score)
            }
        }
        // Invariant from the pin: candidates.isEmpty == (verdict == .noMatch).
        guard !candidates.isEmpty else {
            return Identification(candidates: [], verdict: .noMatch)
        }
        return Identification(
            candidates: candidates,
            verdict: outcome.tier == .accept ? .accept : .review)
    }

    /// "Base Set 4/102". Every indexed card has a set name; 29 lack a printed
    /// collector number and get the bare set name (real data, no placeholder).
    private func setLabel(_ card: IndexedCard) -> String {
        guard var label = card.setName else { return "" }
        if let number = card.collectorNumber {
            label += " \(number)"
            if let total = card.setTotal { label += "/\(total)" }
        }
        return label
    }

    /// Perspective-correct the quad to the upright 745x1043 card — the exact
    /// output geometry of the sorter's extractCardImage, which is the input
    /// every accuracy number was measured at.
    ///
    /// The quad arrives top-left-origin y-DOWN (the pin's convention);
    /// CIPerspectiveCorrection speaks Core Image's bottom-left-origin y-UP
    /// space, so y flips exactly once, here.
    private func deskew(_ image: CGImage, quad: CardQuad) -> CGImage? {
        let w = CGFloat(image.width), h = CGFloat(image.height)
        func ci(_ p: CGPoint) -> CIVector {
            CIVector(x: p.x * w, y: (1 - p.y) * h)
        }
        let corrected = CIImage(cgImage: image).applyingFilter(
            "CIPerspectiveCorrection",
            parameters: [
                "inputTopLeft": ci(quad.topLeft),
                "inputTopRight": ci(quad.topRight),
                "inputBottomRight": ci(quad.bottomRight),
                "inputBottomLeft": ci(quad.bottomLeft),
            ])
        guard corrected.extent.width > 0, corrected.extent.height > 0 else { return nil }
        let scaled = corrected.transformed(by: CGAffineTransform(
            scaleX: 745 / corrected.extent.width,
            y: 1043 / corrected.extent.height))
        return CIContext().createCGImage(scaled, from: scaled.extent)
    }
}
