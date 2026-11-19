// 用 macOS 自带的 Vision 识别图片里的文字，供 scripts/ocr.mjs 调用。
// 每张图输出一行 JSON：{"file": 路径, "lines": [每一行文字]}，读不了的图 lines 为 null。
// 用法：ocr <图片> …
import AppKit
import Foundation
import Vision

func recognize(_ path: String) -> [String]? {
  guard let img = NSImage(contentsOfFile: path),
        let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return nil }
  let req = VNRecognizeTextRequest()
  req.recognitionLevel = .accurate
  req.recognitionLanguages = ["zh-Hans", "ja-JP", "en-US"]
  req.usesLanguageCorrection = true
  do { try VNImageRequestHandler(cgImage: cg, options: [:]).perform([req]) } catch { return nil }
  // 置信度太低的多半是花纹、手写体或者背景里的招牌，留着只会干扰阅读
  return (req.results ?? []).compactMap { $0.topCandidates(1).first }.filter { $0.confidence >= 0.3 }.map { $0.string }
}

for path in CommandLine.arguments.dropFirst() {
  let row: [String: Any] = ["file": path, "lines": recognize(path) as Any? ?? NSNull()]
  let data = try! JSONSerialization.data(withJSONObject: row, options: [.withoutEscapingSlashes])
  print(String(data: data, encoding: .utf8)!)
}
