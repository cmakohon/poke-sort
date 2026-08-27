// A long-lived Apple Vision text recogniser, driven over stdin.
//
// Exists to answer one question the Tesseract-shaped pipeline cannot answer
// about itself: how much of the collector-number failure rate is the band
// geometry, and how much is the engine. Vision is a scene-text recogniser —
// detection plus recognition trained on photographs, with no binarisation
// step — which is the opposite of what tesseract.js assumes about its input.
//
// One request per line so the process is started once and reused. Vision's
// first request pays model load (~200ms); at ~5000 reads per sweep arm a
// process per read would be most of the runtime.
//
// Protocol, JSON lines both ways:
//   in   {"id":1,"path":"/tmp/crop.png"}
//   out  {"id":1,"text":"58/102","confidence":0.83}
//   out  {"id":1,"text":"","confidence":0,"error":"..."}
//
// Responses are emitted in request order — each process handles one read at a
// time and the Node side pools several, mirroring how the Tesseract worker
// pool is sized against the cores the embedding pass is not using.

import Foundation
import ImageIO
import Vision

struct Request: Decodable {
  let id: Int
  let path: String
}

struct Response: Encodable {
  let id: Int
  let text: String
  let confidence: Double
  var error: String? = nil
}

let encoder = JSONEncoder()
let decoder = JSONDecoder()
let stdout = FileHandle.standardOutput

func emit(_ response: Response) {
  guard let data = try? encoder.encode(response) else { return }
  stdout.write(data)
  stdout.write(Data([0x0a]))
}

func loadImage(_ path: String) -> CGImage? {
  // ImageIO rather than NSImage: no AppKit, so this runs headless without
  // touching the window server.
  let url = URL(fileURLWithPath: path) as CFURL
  guard let source = CGImageSourceCreateWithURL(url, nil) else { return nil }
  return CGImageSourceCreateImageAtIndex(source, 0, nil)
}

func recognize(_ image: CGImage) throws -> (String, Double) {
  let request = VNRecognizeTextRequest()
  // .accurate is the neural path; .fast is a different, weaker model. The
  // whole point of the comparison is Vision at its best.
  request.recognitionLevel = .accurate
  // OFF, and this is load-bearing: language correction would "fix" a
  // collector number into a word. "58/102" is not English and must not be
  // treated as though it were.
  request.usesLanguageCorrection = false
  request.recognitionLanguages = ["en-US"]
  // The crops are already tight bands, so the text fills a large fraction of
  // the frame — but a band that caught only the digits' tops would fall under
  // the 1/32 default and return nothing at all, which would read as "Vision
  // cannot see this" when it means "Vision was not asked to look".
  request.minimumTextHeight = 0.0

  let handler = VNImageRequestHandler(cgImage: image, options: [:])
  try handler.perform([request])

  let observations = request.results ?? []
  var lines: [String] = []
  var confidenceSum = 0.0
  var confidenceCount = 0.0
  for observation in observations {
    guard let candidate = observation.topCandidates(1).first else { continue }
    lines.append(candidate.string)
    confidenceSum += Double(candidate.confidence)
    confidenceCount += 1
  }
  // Newline-joined to match what Tesseract returns, because the parsers
  // downstream split on it — and because `\s*` in the fraction regex spans a
  // newline, so a number Vision happens to split across two observations
  // ("58" / "/102") still parses.
  let text = lines.joined(separator: "\n")
  let confidence = confidenceCount > 0 ? confidenceSum / confidenceCount : 0
  return (text, confidence)
}

while let line = readLine(strippingNewline: true) {
  if line.isEmpty { continue }
  guard let data = line.data(using: .utf8),
        let request = try? decoder.decode(Request.self, from: data) else {
    continue
  }
  guard let image = loadImage(request.path) else {
    emit(Response(id: request.id, text: "", confidence: 0, error: "load failed"))
    continue
  }
  do {
    let (text, confidence) = try recognize(image)
    emit(Response(id: request.id, text: text, confidence: confidence))
  } catch {
    emit(Response(
      id: request.id, text: "", confidence: 0,
      error: String(describing: error)))
  }
}
