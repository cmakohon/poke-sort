// Apple Vision OCR, in-process — the iOS equivalent of the macOS sidecar in
// packages/server/src/lib/identify/vision.ts + native/vision-ocr.swift.
//
// Same recogniser, same settings: .accurate (the neural path), language
// correction OFF because it would "fix" 58/102 into a word. What the sidecar
// pays in process plumbing this pays in nothing — Vision is a first-party
// framework here.
//
// Read plan mirrors readCard() in ocr.ts under the Vision engine:
//   - collector number: ONE read of the whole card (WHOLE_CARD_PLAN)
//   - name: two banded crops, first well-formed parse wins
//   - HP: one banded crop
//
// Divergence to verify during parity testing: the sorter greyscales +
// histogram-normalises the name/HP crops at 3x (a Tesseract-era preprocessing
// that readCard applies regardless of engine). Vision is a scene-text model
// and its own eval showed preprocessing destroys information for it, so this
// port hands Vision the raw crops. Confirm on the parity harness before
// trusting the name signal at the sorter's measured rate.

import CoreGraphics
import Vision

struct OcrBand: Sendable {
    let x0, y0, x1, y1: Double
}

/// Band geometry from POKEMON_OCR in profiles.ts (fractions of the card crop).
enum OcrBands {
    static let name: [OcrBand] = [
        OcrBand(x0: 0.06, y0: 0.045, x1: 0.72, y1: 0.13),
        OcrBand(x0: 0.14, y0: 0.05, x1: 0.70, y1: 0.12),
    ]
    static let hp: [OcrBand] = [
        OcrBand(x0: 0.60, y0: 0.03, x1: 0.98, y1: 0.12)
    ]
}

enum VisionOcr {
    /// All recognised lines, top-to-bottom, joined with newlines.
    static func recognizeText(in image: CGImage) throws -> String {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        let handler = VNImageRequestHandler(cgImage: image, options: [:])
        try handler.perform([request])
        let lines = (request.results ?? [])
            .compactMap { $0.topCandidates(1).first?.string }
        return lines.joined(separator: "\n")
    }

    static func crop(_ image: CGImage, to band: OcrBand) -> CGImage? {
        let w = Double(image.width)
        let h = Double(image.height)
        return image.cropping(
            to: CGRect(
                x: (band.x0 * w).rounded(), y: (band.y0 * h).rounded(),
                width: ((band.x1 - band.x0) * w).rounded(),
                height: ((band.y1 - band.y0) * h).rounded()))
    }

    /// The full reading for one upright card crop: three banded reads plus one
    /// whole-card read, mirroring readCard() in ocr.ts. Each read is cheap
    /// (tens of ms) and they are independent; run them off the caller's actor.
    static func readCard(_ card: CGImage) -> OcrReading {
        var reading = collectorReadingFromWholeCard(
            (try? recognizeText(in: card)) ?? "")

        for band in OcrBands.name {
            guard let crop = crop(card, to: band),
                  let text = try? recognizeText(in: crop),
                  let name = cleanName(text) else { continue }
            reading.name = name
            break
        }
        for band in OcrBands.hp {
            guard let crop = crop(card, to: band),
                  let text = try? recognizeText(in: crop),
                  let hp = parseHp(text) else { continue }
            reading.hp = hp
            break
        }
        return reading
    }
}
