import Foundation
import AppKit
import PDFKit
import Vision
import CoreGraphics

func openPDF(_ url: URL) throws -> PDFDocument {
    guard url.pathExtension.lowercased() == "pdf", let document = PDFDocument(url: url), document.pageCount > 0 else {
        throw EngineFailure("无法读取 PDF，请确认文件未损坏且至少有一页")
    }
    guard !document.isLocked else { throw EngineFailure("PDF 受密码保护，请先解密后再转换") }
    return document
}

func renderPDFPage(_ page: PDFPage, dpi: Double = 300) throws -> CGImage {
    guard let source = page.pageRef else { throw EngineFailure("PDF 页面无法渲染") }
    let bounds = source.getBoxRect(.cropBox)
    let quarterTurn = abs(source.rotationAngle) % 180 == 90
    let size = quarterTurn ? CGSize(width: bounds.height, height: bounds.width) : bounds.size
    let width = Int(ceil(size.width * dpi / 72)), height = Int(ceil(size.height * dpi / 72))
    guard width > 0, height > 0,
          let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
        throw EngineFailure("页面图像无法创建，请检查 PDF 页面尺寸或可用内存")
    }
    let rect = CGRect(x: 0, y: 0, width: width, height: height)
    context.setFillColor(CGColor.white); context.fill(rect)
    context.concatenate(source.getDrawingTransform(.cropBox, rect: rect, rotate: 0, preserveAspectRatio: true))
    context.drawPDFPage(source)
    guard let image = context.makeImage() else { throw EngineFailure("PDF 页面图像无法生成") }
    return image
}

func recognizeText(_ image: CGImage) throws -> String {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]
    try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
    return (request.results ?? []).sorted {
        let leftY = 1 - $0.boundingBox.midY, rightY = 1 - $1.boundingBox.midY
        return leftY == rightY ? $0.boundingBox.minX < $1.boundingBox.minX : leftY < rightY
    }.compactMap { $0.topCandidates(1).first?.string.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }.joined(separator: "\n")
}

func modelPNG(_ image: CGImage) throws -> Data {
    var result = image
    if image.width > 1024 {
        let height = max(1, image.height * 1024 / image.width)
        guard let resized = CGContext(data: nil, width: 1024, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
            throw EngineFailure("页面图像缩放失败")
        }
        resized.interpolationQuality = .high
        resized.draw(image, in: CGRect(x: 0, y: 0, width: 1024, height: height))
        guard let image = resized.makeImage() else { throw EngineFailure("页面图像缩放失败") }
        result = image
    }
    guard let data = NSBitmapImageRep(cgImage: result).representation(using: .png, properties: [:]) else {
        throw EngineFailure("页面图像编码失败")
    }
    return data
}

func makeSelfCheckPDF(_ url: URL) throws {
    let imageContext = CGContext(data: nil, width: 1260, height: 900, bitsPerComponent: 8, bytesPerRow: 0,
                                 space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    imageContext.setFillColor(CGColor.white); imageContext.fill(CGRect(x: 0, y: 0, width: 1260, height: 900))
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(cgContext: imageContext, flipped: false)
    let attributes: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 56), .foregroundColor: NSColor.black]
    ("SCAN2EBOOK OCR TEST 12345" as NSString).draw(at: CGPoint(x: 60, y: 580), withAttributes: attributes)
    NSGraphicsContext.restoreGraphicsState()
    let data = NSMutableData()
    var box = CGRect(x: 0, y: 0, width: 420, height: 300)
    guard let consumer = CGDataConsumer(data: data), let pdf = CGContext(consumer: consumer, mediaBox: &box, nil),
          let image = imageContext.makeImage() else { throw EngineFailure("自检 PDF 无法生成") }
    pdf.beginPDFPage(nil); pdf.draw(image, in: box); pdf.endPDFPage(); pdf.closePDF()
    try (data as Data).write(to: url)
}

func selfCheck(_ file: String?) throws -> [String: Any] {
    let temporary = FileManager.default.temporaryDirectory.appendingPathComponent("s2e-self-check-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: temporary) }
    let url = file.map { URL(fileURLWithPath: $0) } ?? temporary.appendingPathComponent("fixture.pdf")
    if file == nil { try makeSelfCheckPDF(url) }
    let pdf = try openPDF(url)
    guard let page = pdf.page(at: 0) else { throw EngineFailure("PDF 没有可读取的页面") }
    let image = try renderPDFPage(page)
    let text = try recognizeText(image)
    if file == nil && text.count < 8 { throw EngineFailure("本机 OCR 自检未识别到测试文字") }
    return ["ok": true, "pages": pdf.pageCount, "dpi": 300, "width": image.width, "height": image.height,
            "ocrCharacters": text.count, "ocrText": String(text.prefix(500)), "networkUsed": false,
            "engine": "native-swift", "frameworks": ["PDFKit", "Vision", "CoreGraphics", "AppKit", "Foundation"]]
}
