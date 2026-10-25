// Text in a picture with macOS Vision, for tools/scanrooms.py (which compiles it): prints JSON [{t, conf, box:[x0,y0,x1,y1] in pixels, y down}]
import Foundation
import Vision
import AppKit

let path = CommandLine.arguments[1]
guard let img = NSImage(contentsOfFile: path), let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { exit(1) }
let W = Double(cg.width), H = Double(cg.height)
let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
req.usesLanguageCorrection = false
req.recognitionLanguages = ["de-DE", "en-US"]
req.minimumTextHeight = 0.004
try VNImageRequestHandler(cgImage: cg, options: [:]).perform([req])
var out: [[String: Any]] = []
for o in req.results ?? [] {
  guard let c = o.topCandidates(1).first else { continue }
  let b = o.boundingBox
  out.append(["t": c.string, "conf": c.confidence, "box": [b.minX * W, (1 - b.maxY) * H, b.maxX * W, (1 - b.minY) * H]])
}
let d = try JSONSerialization.data(withJSONObject: out)
FileHandle.standardOutput.write(d)
