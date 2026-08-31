// Faithful port of the parsers in packages/server/src/lib/identify/ocr.ts.
//
// These regexes were narrowed against measured failure modes (wide patterns
// fired 26 times across 93 labelled captures and were correct 0 times); keep
// them in lockstep with the TypeScript.

import Foundation

/// Largest plausible printed denominator. The catalog's biggest set is 307.
private let maxSetTotal = 400

/// "58/102" -> (58, 102); also accepts "058/102" and spaced variants.
func parseCollectorNumber(_ text: String) -> (collectorNumber: String, setTotal: Int?)? {
    if let match = text.firstMatch(of: /(\d{1,3})\s*\/\s*(\d{1,3})/) {
        let numerator = dropLeadingZeros(String(match.1))
        let total = Int(match.2) ?? 0
        // An impossible denominator means the "fraction" is noise straddling a
        // slash; keep the numerator as a weak reading, drop the total.
        if total >= 1 && total <= maxSetTotal {
            return (numerator, total)
        }
        return (numerator, nil)
    }
    // No denominator to corroborate below here, so both patterns are narrow.
    if let match = text.uppercased().firstMatch(
        of: /\b([A-Z]{2,4})\s*[- ]?\s*(\d{2,3})\b/
    ) {
        return (dropLeadingZeros(String(match.2)), nil)
    }
    if let match = text.firstMatch(of: /\b(0\d{1,2})\b/) {
        return (dropLeadingZeros(String(match.1)), nil)
    }
    return nil
}

private func dropLeadingZeros(_ v: String) -> String {
    var s = Substring(v)
    while s.count > 1, s.first == "0", let second = s.dropFirst().first, second.isNumber {
        s = s.dropFirst()
    }
    return String(s)
}

func parseHp(_ text: String) -> Int? {
    let cleaned = text.replacingOccurrences(
        of: "HP", with: " ", options: [.caseInsensitive])
    guard let match = cleaned.firstMatch(of: /(\d{2,3})/),
          let hp = Int(match.1) else { return nil }
    // Printed HP is a multiple of 10, from 30 to 340.
    return (hp >= 30 && hp <= 400 && hp % 10 == 0) ? hp : nil
}

func cleanName(_ text: String) -> String? {
    let line = text
        .split(separator: "\n")
        .map { $0.trimmingCharacters(in: .whitespaces) }
        .filter { !$0.isEmpty }
        .max { $0.count < $1.count }
    guard var line else { return nil }
    // Strip the HP that often bleeds in from the right of the name band.
    line = line.replacing(/\b\d{2,3}\s*HP\b/.ignoresCase(), with: "")
        .trimmingCharacters(in: .whitespaces)
    return line.count >= 3 ? line : nil
}

/// Whole-card Vision text -> the collector-number half of an OcrReading.
///
/// The sorter's Vision engine reads the collector number from ONE read of the
/// entire card (WHOLE_CARD_PLAN in ocr.ts): no bands, no escalation ladder —
/// those exist for Tesseract's binarisation, which Vision does not have.
/// Measured on 1068 real captures: whole-card beats production's bands 936 to
/// 883 collector numbers. Name and HP still come from banded crops (see
/// VisionOcr.swift), matching readCard in ocr.ts exactly.
func collectorReadingFromWholeCard(_ text: String) -> OcrReading {
    var reading = OcrReading()
    guard !text.isEmpty else { return reading }
    reading.collectorNumberRaw = text
    for line in text.split(separator: "\n") {
        guard let parsed = parseCollectorNumber(String(line)) else { continue }
        if parsed.setTotal != nil, reading.setTotal == nil {
            reading.collectorNumber = parsed.collectorNumber
            reading.setTotal = parsed.setTotal
        } else if reading.collectorNumber == nil {
            reading.collectorNumber = parsed.collectorNumber
        }
    }
    return reading
}
