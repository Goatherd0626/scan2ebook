import Foundation
import AppKit
import PDFKit

let destination = URL(fileURLWithPath: CommandLine.arguments[1])
let data = NSMutableData()
var box = CGRect(x: 0, y: 0, width: 420, height: 300)
guard let consumer = CGDataConsumer(data: data), let pdf = CGContext(consumer: consumer, mediaBox: &box, nil) else { fatalError("无法创建测试 PDF") }
for number in 1...4 {
    pdf.beginPDFPage(nil)
    pdf.setFillColor(CGColor.white)
    pdf.fill(box)
    if number != 3 {
        let bitmap = CGContext(data: nil, width: 1260, height: 900, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        bitmap.setFillColor(CGColor.white)
        bitmap.fill(CGRect(x: 0, y: 0, width: 1260, height: 900))
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(cgContext: bitmap, flipped: false)
        let attributes: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 52), .foregroundColor: NSColor.black]
        ("SCAN2EBOOK TEST PAGE \(number)" as NSString).draw(at: CGPoint(x: 70, y: 640), withAttributes: attributes)
        ("Native offline OCR 12345" as NSString).draw(at: CGPoint(x: 70, y: 510), withAttributes: attributes)
        NSGraphicsContext.restoreGraphicsState()
        pdf.draw(bitmap.makeImage()!, in: box)
    }
    pdf.endPDFPage()
}
pdf.closePDF()
try (data as Data).write(to: destination)
if CommandLine.arguments.count > 2 {
    let document = PDFDocument(data: data as Data)!
    document.write(to: URL(fileURLWithPath: CommandLine.arguments[2]), withOptions: [.userPasswordOption: "offline-test-password", .ownerPasswordOption: "offline-owner-password"])
}
