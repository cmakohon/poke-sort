// The SigLIP embedding seam — the one piece of the port that is NOT done.
//
// The sorter embeds with Xenova/siglip-base-patch16-512, q8 ONNX, via
// transformers.js. The bundled index's vectors came from that exact pipeline,
// and vectors are only comparable to vectors made the same way (see
// packages/server/src/lib/embedding-identity.ts — change the model, the
// quantisation, or the preprocessing and every distance silently degrades).
//
// So shipping this on iOS is a two-sided job:
//   1. Convert google/siglip-base-patch16-512's vision tower to Core ML
//      (coremltools; fp16 is the natural target, ~185 MB, or palettized less).
//   2. EITHER verify the Core ML embeddings are distance-close to the ONNX q8
//      ones on the parity harness (max |d_coreml - d_onnx| well under the
//      0.02 distanceGap notch), OR re-embed the whole catalog with the Core ML
//      model and rebuild the index. Re-embedding is the safe default: the
//      sorter repo already has the loop (scripts + eval/capture-signals.ts),
//      it is ~40k forward passes, and it removes the comparability question
//      instead of measuring it.
//
// Preprocessing contract, from the model's preprocessor_config.json — the
// Core ML conversion should bake these in so this file stays dumb:
//   - resize to exactly 512x512, bicubic, NO aspect-ratio preservation
//     (the card is squashed; the catalog renders were squashed the same way)
//   - scale to [0,1] (1/255), then normalise (x - 0.5) / 0.5 -> [-1,1]
//   - RGB channel order
//   - output: pooler_output, 768 floats; unit-normalise before use so cosine
//     distance is 1 - dot product.

import CoreGraphics
import CoreML
// Vision only for VNImageCropAndScaleOption.scaleFill — the squash resize the
// preprocessing contract requires.
import Vision

protocol CardEmbedder: Sendable {
    /// 768-dim unit-normalised embedding of the (already upright, already
    /// cropped) card image.
    func embed(_ image: CGImage) throws -> [Float]
}

/// Core ML implementation. Expects a model whose input is a 512x512 image
/// (preprocessing baked in at conversion time via coremltools' scale/bias) and
/// whose output is the 768-dim pooler vector.
final class SigLIPEmbedder: CardEmbedder {
    private let model: MLModel
    private let inputName: String
    private let outputName: String

    init(modelURL: URL) throws {
        let config = MLModelConfiguration()
        // NEVER .all: SigLIP's attention activations overflow the ANE's fp16
        // arithmetic and the embedding comes back silently wrong (measured
        // 2026-08-31: cosine vs fp32 truth 0.53-0.76 on the ANE, 0.99999 on
        // GPU, ~80ms/pass on an M-series GPU). fp16 weights are fine; the
        // ANE's math is not.
        config.computeUnits = .cpuAndGPU
        model = try MLModel(contentsOf: modelURL, configuration: config)
        guard let input = model.modelDescription.inputDescriptionsByName.first?.key,
              let output = model.modelDescription.outputDescriptionsByName.first?.key
        else { throw CocoaError(.coderInvalidValue) }
        inputName = input
        outputName = output
    }

    func embed(_ image: CGImage) throws -> [Float] {
        let value = try MLFeatureValue(
            cgImage: image, pixelsWide: 512, pixelsHigh: 512,
            pixelFormatType: kCVPixelFormatType_32BGRA,
            options: [.cropAndScale: VNImageCropAndScaleOption.scaleFill.rawValue])
        let input = try MLDictionaryFeatureProvider(dictionary: [inputName: value])
        let output = try model.prediction(from: input)
        guard let array = output.featureValue(for: outputName)?.multiArrayValue else {
            throw CocoaError(.coderReadCorrupt)
        }
        var vector = (0..<array.count).map { Float(truncating: array[$0]) }
        var norm: Float = 0
        for x in vector { norm += x * x }
        norm = max(norm.squareRoot(), .leastNormalMagnitude)
        for i in vector.indices { vector[i] /= norm }
        return vector
    }
}
