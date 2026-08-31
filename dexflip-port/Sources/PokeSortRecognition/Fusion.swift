// Faithful port of packages/server/src/lib/identify/rerank.ts.
//
// Every constant and branch here is measured, not designed — see the source
// file's comments and docs/vision-ocr-evaluation.md for the evidence. Keep the
// two implementations in lockstep: a divergence does not fail, it just scores
// differently, which looks like a mediocre model rather than a bug.

import Foundation

struct OcrReading: Sendable {
    var name: String?
    var collectorNumber: String?
    var setTotal: Int?
    var collectorNumberRaw: String?
    var hp: Int?
}

struct RerankInput: Sendable {
    var id: String
    var distance: Double
    var artDistance: Double?
    var name: String
    var collectorNumber: String?
    var setTotal: Int?
    var hp: Int?
    /// Printed set code ("OBF"). nil for sets that never printed one —
    /// already gated to Sword & Shield onward at index-export time.
    var setAbbreviation: String?
}

struct Signals: Sendable {
    var embedding = 0.0
    var name = 0.0
    var collectorNumber = 0.0
    var setAbbreviation = 0.0
    var setTotal = 0.0
    var hp = 0.0
}

enum Tier: Sendable { case accept, review, noMatch }

struct RankedCandidate: Sendable {
    var id: String
    var distance: Double
    var score: Double
    var signals: Signals
}

/// Mirror of POKEMON_PROFILE in profiles.ts. Do not tune these here: they are
/// calibrated against the sorter's eval sets, and the false-accept cliffs sit
/// one to two notches away (see the profile's comments).
struct IdentityProfile: Sendable {
    var candidateLimit = 50
    var distanceCutoff = 0.3
    var artWeight = 0.25
    var wEmbedding = 0.5
    var wName = 0.15
    var wCollectorNumber = 0.2
    var wSetAbbreviation = 0.05
    var wSetTotal = 0.02
    var wHp = 0.05
    var acceptMinScore = 0.4
    var acceptMinMargin = 0.06
    var distanceGapD1Max = 0.15
    var distanceGapGapMin = 0.02
    var reviewFloor = 0.3
    /// When a pass's nearest distance exceeds this, the 180° retry runs.
    var retryDistance = 0.2

    static let pokemon = IdentityProfile()
}

// MARK: - Name similarity

private func editDistance(_ a: [UInt8], _ b: [UInt8]) -> Int {
    if a == b { return 0 }
    if a.isEmpty { return b.count }
    if b.isEmpty { return a.count }
    var prev = Array(0...b.count)
    var curr = [Int](repeating: 0, count: b.count + 1)
    for i in 1...a.count {
        curr[0] = i
        for j in 1...b.count {
            let cost = a[i - 1] == b[j - 1] ? 0 : 1
            curr[j] = min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
        }
        swap(&prev, &curr)
    }
    return prev[b.count]
}

private func normalizeName(_ value: String) -> [UInt8] {
    // Lowercase, collapse every non-alphanumeric run to one space, trim —
    // identical to normalizeName in rerank.ts (ASCII-level on purpose: card
    // names are ASCII once "Pokémon" style marks are folded by OCR anyway).
    var out: [UInt8] = []
    var pendingSpace = false
    for scalar in value.lowercased().unicodeScalars {
        let v = scalar.value
        if (v >= 97 && v <= 122) || (v >= 48 && v <= 57) {
            if pendingSpace, !out.isEmpty { out.append(32) }
            pendingSpace = false
            out.append(UInt8(v))
        } else {
            pendingSpace = true
        }
    }
    return out
}

func nameSimilarity(_ ocrName: String?, _ candidateName: String) -> Double {
    guard let ocrName else { return 0 }
    let left = normalizeName(ocrName)
    let right = normalizeName(candidateName)
    if left.isEmpty || right.isEmpty { return 0 }
    let longest = max(left.count, right.count)
    return max(0, 1 - Double(editDistance(left, right)) / Double(longest))
}

// MARK: - Collector number

private func stripZeros(_ v: String) -> String {
    var s = Substring(v.lowercased())
    while s.count > 1, s.first == "0", let second = s.dropFirst().first, second.isNumber {
        s = s.dropFirst()
    }
    return String(s)
}

/// Glyphs OCR reliably mistakes for digits or the slash. Applied only to runs
/// that are already mostly digits — see digitNormalizedRuns.
private let digitConfusables: [Character: Character] = [
    "o": "0", "i": "1", "l": "1", "|": "1", "z": "2", "a": "4",
    "s": "5", "b": "8", "g": "9", "r": "/", "\\": "/",
]

private let confusableRun = /[0-9\/oil|zasbgr\\]{4,}/

private func digitNormalizedRuns(_ compactRaw: String) -> [String] {
    compactRaw.matches(of: confusableRun).compactMap { match in
        let run = String(match.output)
        let digits = run.filter(\.isNumber).count
        guard digits * 2 >= run.count else { return nil }
        return String(run.map { digitConfusables[$0] ?? $0 })
    }
}

func collectorNumberMatch(
    _ ocr: OcrReading, _ candidate: RerankInput, trustworthyTotals: Set<Int>
) -> Double {
    guard let candidateNumber = candidate.collectorNumber else { return 0 }

    if let raw = ocr.collectorNumberRaw, let setTotal = candidate.setTotal {
        let compact = raw.lowercased().filter { !$0.isWhitespace }
        let total = String(setTotal)
        let padded = String(repeating: "0", count: max(0, candidateNumber.count - total.count)) + total
        let printedForms = [
            "\(stripZeros(candidateNumber))/\(total)",
            "\(candidateNumber.lowercased())/\(padded)",
        ]
        let runs = digitNormalizedRuns(compact)
        for printed in printedForms {
            if compact.contains(printed) { return 1 }
            if runs.contains(where: { $0.contains(printed) }) { return 1 }
        }
    }

    guard let ocrNumber = ocr.collectorNumber else { return 0 }
    guard stripZeros(ocrNumber) == stripZeros(candidateNumber) else { return 0 }

    if let ocrTotal = ocr.setTotal, let candTotal = candidate.setTotal, ocrTotal == candTotal {
        return 1
    }
    // A read denominator naming a DIFFERENT real set is evidence against.
    if let ocrTotal = ocr.setTotal, candidate.setTotal != nil,
       trustworthyTotals.contains(ocrTotal) {
        return 0
    }
    return 0.5
}

func setAbbreviationMatch(_ ocr: OcrReading, _ candidate: RerankInput) -> Double {
    guard let abbrev = candidate.setAbbreviation, abbrev.count >= 2,
          let raw = ocr.collectorNumberRaw else { return 0 }
    let escaped = NSRegularExpression.escapedPattern(for: abbrev)
    guard let regex = try? NSRegularExpression(
        pattern: "(^|[^A-Za-z])\(escaped)([^A-Za-z]|$)",
        options: [.caseInsensitive]
    ) else { return 0 }
    let range = NSRange(raw.startIndex..., in: raw)
    return regex.firstMatch(in: raw, range: range) != nil ? 1 : 0
}

func setTotalMatch(
    _ ocr: OcrReading, _ candidate: RerankInput, trustworthyTotals: Set<Int>
) -> Double {
    guard let ocrTotal = ocr.setTotal, let candTotal = candidate.setTotal,
          trustworthyTotals.contains(ocrTotal) else { return 0 }
    return ocrTotal == candTotal ? 1 : 0
}

// MARK: - Fusion

private func weight(_ profile: IdentityProfile, _ key: WritableKeyPath<Signals, Double>) -> Double {
    switch key {
    case \.embedding: profile.wEmbedding
    case \.name: profile.wName
    case \.collectorNumber: profile.wCollectorNumber
    case \.setAbbreviation: profile.wSetAbbreviation
    case \.setTotal: profile.wSetTotal
    case \.hp: profile.wHp
    default: 0
    }
}

private let allSignals: [WritableKeyPath<Signals, Double>] = [
    \.embedding, \.name, \.collectorNumber, \.setAbbreviation, \.setTotal, \.hp,
]

func scoreSignals(
    _ candidate: RerankInput, _ ocr: OcrReading, _ profile: IdentityProfile,
    trustworthyTotals: Set<Int>
) -> Signals {
    // Whole-card and art-window views blended BEFORE becoming one signal, so
    // a candidate the index has no art vector for degrades to whole-card
    // scoring instead of being punished.
    let distance = candidate.artDistance.map {
        (1 - profile.artWeight) * candidate.distance + profile.artWeight * $0
    } ?? candidate.distance

    var s = Signals()
    s.embedding = max(0, min(1, 1 - distance / profile.distanceCutoff))
    s.name = nameSimilarity(ocr.name, candidate.name)
    s.collectorNumber = collectorNumberMatch(ocr, candidate, trustworthyTotals: trustworthyTotals)
    s.setAbbreviation = setAbbreviationMatch(ocr, candidate)
    s.setTotal = setTotalMatch(ocr, candidate, trustworthyTotals: trustworthyTotals)
    s.hp = (ocr.hp != nil && candidate.hp != nil && ocr.hp == candidate.hp) ? 1 : 0
    return s
}

/// Weighted mean over the informative signals, renormalised so absent ones
/// neither help nor hurt. See fuse() in rerank.ts for why a plain weighted sum
/// is wrong (it punishes a card for what OCR failed to do).
private func fuse(
    _ signals: Signals, _ profile: IdentityProfile,
    informative: [WritableKeyPath<Signals, Double>]
) -> Double {
    var mass = 0.0, total = 0.0
    for key in informative {
        let w = weight(profile, key)
        mass += w
        total += w * signals[keyPath: key]
    }
    return mass > 0 ? total / mass : 0
}

func rerank(
    _ candidates: [RerankInput], _ ocr: OcrReading, _ profile: IdentityProfile,
    trustworthyTotals: Set<Int>
) -> [RankedCandidate] {
    let scored = candidates.map {
        (input: $0, signals: scoreSignals($0, ocr, profile, trustworthyTotals: trustworthyTotals))
    }
    // A signal is informative only if it separates the candidates: an OCR
    // reading that matches nothing in the whole set is noise, not evidence.
    let informative = allSignals.filter { key in
        key == \.embedding || scored.contains { $0.signals[keyPath: key] > 0 }
    }
    return scored
        .map {
            RankedCandidate(
                id: $0.input.id, distance: $0.input.distance,
                score: fuse($0.signals, profile, informative: informative),
                signals: $0.signals)
        }
        .sorted { $0.score != $1.score ? $0.score > $1.score : $0.distance < $1.distance }
}

func decideTier(
    _ ranked: [RankedCandidate], _ profile: IdentityProfile
) -> (tier: Tier, margin: Double?) {
    guard let top = ranked.first else { return (.noMatch, nil) }
    let margin = ranked.count > 1 ? top.score - ranked[1].score : nil

    if top.score < profile.reviewFloor { return (.noMatch, margin) }

    let clearOfRunnerUp = margin.map { $0 >= profile.acceptMinMargin } ?? true
    if top.score >= profile.acceptMinScore && clearOfRunnerUp {
        return (.accept, margin)
    }

    // Image-unambiguous release: relaxes a thin fused MARGIN when the nearest
    // embedding match is both very close and far ahead of the next — never the
    // evidence floor. See decideTier in rerank.ts.
    let byDistance = ranked.sorted { $0.distance < $1.distance }
    if top.score >= profile.acceptMinScore,
       let nearest = byDistance.first, nearest.id == top.id,
       nearest.distance <= profile.distanceGapD1Max {
        let gap = byDistance.count > 1
            ? byDistance[1].distance - nearest.distance : .infinity
        if gap >= profile.distanceGapGapMin { return (.accept, margin) }
    }
    return (.review, margin)
}
