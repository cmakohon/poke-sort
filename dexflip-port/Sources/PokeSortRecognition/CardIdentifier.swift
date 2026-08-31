// The pipeline: embed -> retrieve -> OCR -> fuse -> gate, with 180°
// orientation recovery. Port of identifyCard/identifyOnce in
// packages/server/src/lib/identify/index.ts, minus the sorter-only concerns
// (pricing, 1st Edition stamp detection, database, telemetry).
//
// Swift 6 strict concurrency: the identifier is an actor. The expensive state
// (Core ML model, 60 MB index) loads once and is reused; concurrent identify
// calls interleave at the await points, and Vision/Core ML are internally
// thread-safe. `preferFlipped` — process-wide in the sorter because cards come
// off one stack — is actor state here for the same reason: a user shooting a
// binder page of upside-down cards pays the retry once, not per card.

import CoreGraphics
import Foundation
import ImageIO

/// The art window every framed series shares (FRAMED in art-window.ts,
/// ART_WINDOW_VERSION 1). Fractions of the upright card crop.
private let artWindow = (x0: 0.06, y0: 0.12, x1: 0.94, y1: 0.55)

struct IdentifyOutcome: Sendable {
    var tier: Tier
    var margin: Double?
    var ranked: [RankedCandidate]
    var cardsById: [String: IndexedCard]
}

actor CardIdentifier {
    private let index: CardIndex
    private let embedder: any CardEmbedder
    private let profile = IdentityProfile.pokemon
    private var preferFlipped = false

    init(index: CardIndex, embedder: any CardEmbedder) {
        self.index = index
        self.embedder = embedder
    }

    /// `card` must be the upright, deskewed card crop — the card filling the
    /// image edge to edge, name at the top. See the G1 answer in the port
    /// README: every band and window below is a fraction of this image.
    func identify(card: CGImage) async throws -> IdentifyOutcome {
        let firstFlipped = preferFlipped
        let firstImage = firstFlipped ? rotate180(card) : card
        let first = try await identifyOnce(firstImage)
        if nearestDistance(first) <= profile.retryDistance {
            return first
        }
        try Task.checkCancellation()
        // A card fed upside down embeds to garbage — SigLIP is not rotation
        // invariant — so flip and try again; strictly better or bust.
        let second = try await identifyOnce(firstFlipped ? card : rotate180(card))
        if nearestDistance(second) < nearestDistance(first) {
            preferFlipped = !firstFlipped
            return second
        }
        return first
    }

    private func identifyOnce(_ card: CGImage) async throws -> IdentifyOutcome {
        // OCR does not depend on the embedding; run them concurrently — the
        // two big fixed costs overlap instead of stacking (same reasoning as
        // identifyOnce in the sorter, where the overlap was worth ~500ms).
        async let ocrTask = Task.detached(priority: .userInitiated) {
            VisionOcr.readCard(card)
        }.value

        let embedding = try embedder.embed(card)
        // A failed art crop degrades ranking, not correctness: candidates are
        // then scored on whole-card distance alone, the pre-art behaviour.
        let artEmbedding = cropToArtWindow(card).flatMap { try? embedder.embed($0) }

        try Task.checkCancellation()
        let hits = index.candidates(
            query: embedding, artQuery: artEmbedding,
            limit: profile.candidateLimit, cutoff: profile.distanceCutoff)

        guard !hits.isEmpty else {
            return IdentifyOutcome(tier: .noMatch, margin: nil, ranked: [], cardsById: [:])
        }

        let ocr = await ocrTask
        let inputs = hits.map { hit in
            RerankInput(
                id: hit.card.id, distance: hit.distance, artDistance: hit.artDistance,
                name: hit.card.name, collectorNumber: hit.card.collectorNumber,
                setTotal: hit.card.setTotal, hp: hit.card.hp,
                setAbbreviation: hit.card.setAbbreviation)
        }
        let ranked = rerank(inputs, ocr, profile, trustworthyTotals: index.trustworthyTotals)
        let (tier, margin) = decideTier(ranked, profile)
        let byId = Dictionary(uniqueKeysWithValues: hits.map { ($0.card.id, $0.card) })
        return IdentifyOutcome(tier: tier, margin: margin, ranked: ranked, cardsById: byId)
    }

    private func nearestDistance(_ outcome: IdentifyOutcome) -> Double {
        outcome.ranked.map(\.distance).min() ?? .infinity
    }

    private func cropToArtWindow(_ image: CGImage) -> CGImage? {
        let w = Double(image.width), h = Double(image.height)
        return image.cropping(to: CGRect(
            x: (artWindow.x0 * w).rounded(), y: (artWindow.y0 * h).rounded(),
            width: ((artWindow.x1 - artWindow.x0) * w).rounded(),
            height: ((artWindow.y1 - artWindow.y0) * h).rounded()))
    }

    private func rotate180(_ image: CGImage) -> CGImage {
        let ctx = CGContext(
            data: nil, width: image.width, height: image.height,
            bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpace(name: CGColorSpace.sRGB)!,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        ctx.translateBy(x: CGFloat(image.width), y: CGFloat(image.height))
        ctx.rotate(by: .pi)
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
        return ctx.makeImage() ?? image
    }
}
