// The bundled identification index: 19,448 English physical-print cards with
// unit-normalised SigLIP embeddings (whole card + art window), produced by
// dexflip-port/scripts/export-dexflip-index.ts.
//
// Retrieval is brute force on purpose. 19,448 x 768 dot products is ~15M
// multiply-adds — well under 10ms with Accelerate — and the sorter's HNSW
// evaluation (eval/hnsw-recall.ts) exists because Postgres needed an index;
// a phone doing one query per shutter press does not.

import Accelerate
import Foundation

struct IndexedCard: Codable, Sendable {
    let id: String
    let name: String
    let collectorNumber: String?
    let setTotal: Int?
    let hp: Int?
    let setAbbreviation: String?
    let setId: String
    let setName: String?
    let hasArt: Bool
}

struct CandidateHit: Sendable {
    let card: IndexedCard
    let distance: Double
    let artDistance: Double?
}

final class CardIndex: Sendable {
    let cards: [IndexedCard]
    let trustworthyTotals: Set<Int>
    private let dim: Int
    /// Row-major Float16, one row per card, unit-normalised.
    private let whole: [Float16]
    private let art: [Float16]

    init(cardsURL: URL, embeddingsURL: URL, artEmbeddingsURL: URL) throws {
        struct RawMeta: Codable {
            let dim: Int
            let count: Int
            let setTotals: [Int]
            let cards: [IndexedCard]
        }
        let meta = try JSONDecoder().decode(RawMeta.self, from: Data(contentsOf: cardsURL))
        cards = meta.cards
        dim = meta.dim
        trustworthyTotals = Set(meta.setTotals)

        func loadF16(_ url: URL, expecting rows: Int) throws -> [Float16] {
            let data = try Data(contentsOf: url, options: .mappedIfSafe)
            let expected = rows * meta.dim * MemoryLayout<Float16>.size
            guard data.count == expected else {
                throw CocoaError(.fileReadCorruptFile, userInfo: [
                    NSLocalizedDescriptionKey:
                        "\(url.lastPathComponent): \(data.count) bytes, expected \(expected)",
                ])
            }
            return data.withUnsafeBytes { Array($0.bindMemory(to: Float16.self)) }
        }
        whole = try loadF16(embeddingsURL, expecting: meta.count)
        art = try loadF16(artEmbeddingsURL, expecting: meta.count)
    }

    convenience init(bundle: Bundle = .main) throws {
        func url(_ name: String, _ ext: String) throws -> URL {
            guard let url = bundle.url(forResource: name, withExtension: ext) else {
                throw CocoaError(.fileNoSuchFile, userInfo: [
                    NSLocalizedDescriptionKey: "missing index resource \(name).\(ext)",
                ])
            }
            return url
        }
        try self.init(
            cardsURL: url("cards", "json"),
            embeddingsURL: url("embeddings", "f16"),
            artEmbeddingsURL: url("art-embeddings", "f16"))
    }

    /// Nearest candidates by whole-card cosine distance, with each hit's
    /// art-window distance alongside — the same view fetchCandidates() gives
    /// the reranker (retrieval stays whole-card; art distances are computed
    /// only for the survivors).
    ///
    /// `query` and `artQuery` must be unit-normalised (the embedder does this).
    func candidates(
        query: [Float], artQuery: [Float]?, limit: Int, cutoff: Double
    ) -> [CandidateHit] {
        let scores = similarities(matrix: whole, query: query)
        // Top-limit under the cutoff. distance = 1 - cosine similarity.
        var hits: [(Int, Float)] = []
        for (i, s) in scores.enumerated() where Double(1 - s) < cutoff {
            hits.append((i, s))
        }
        hits.sort { $0.1 > $1.1 }
        hits = Array(hits.prefix(limit))

        let artScores = artQuery.map { q in
            hits.map { hit in
                cards[hit.0].hasArt ? similarity(row: hit.0, in: art, query: q) : nil
            }
        }
        return hits.enumerated().map { (n, hit) in
            CandidateHit(
                card: cards[hit.0],
                distance: Double(1 - hit.1),
                artDistance: artScores?[n].map { Double(1 - $0) })
        }
    }

    /// One query against every row: chunked Float16 -> Float32 conversion into
    /// a reusable scratch buffer, then a single-precision matrix-vector
    /// multiply per chunk. Keeps resident weight at the Float16 60 MB instead
    /// of doubling it.
    private func similarities(matrix: [Float16], query: [Float]) -> [Float] {
        let rows = cards.count
        let chunkRows = 1024
        var out = [Float](repeating: 0, count: rows)
        var scratch = [Float](repeating: 0, count: chunkRows * dim)
        matrix.withUnsafeBufferPointer { m in
            query.withUnsafeBufferPointer { q in
                out.withUnsafeMutableBufferPointer { o in
                    scratch.withUnsafeMutableBufferPointer { s in
                        var row = 0
                        while row < rows {
                            let n = min(chunkRows, rows - row)
                            var src = vImage_Buffer(
                                data: UnsafeMutableRawPointer(
                                    mutating: m.baseAddress! + row * dim),
                                height: 1, width: vImagePixelCount(n * dim),
                                rowBytes: n * dim * 2)
                            var dst = vImage_Buffer(
                                data: s.baseAddress!, height: 1,
                                width: vImagePixelCount(n * dim), rowBytes: n * dim * 4)
                            vImageConvert_Planar16FtoPlanarF(&src, &dst, 0)
                            cblas_sgemv(
                                CblasRowMajor, CblasNoTrans, Int32(n), Int32(dim),
                                1, s.baseAddress!, Int32(dim), q.baseAddress!, 1,
                                0, o.baseAddress! + row, 1)
                            row += n
                        }
                    }
                }
            }
        }
        return out
    }

    private func similarity(row: Int, in matrix: [Float16], query: [Float]) -> Float {
        var sum: Float = 0
        matrix.withUnsafeBufferPointer { m in
            let base = m.baseAddress! + row * dim
            for i in 0..<dim { sum += Float(base[i]) * query[i] }
        }
        return sum
    }
}
