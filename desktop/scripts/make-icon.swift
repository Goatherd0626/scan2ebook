import AppKit

let output = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)

func icon(size: Int) -> Data {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    NSGraphicsContext.current!.cgContext.scaleBy(x: Double(size) / 1024, y: Double(size) / 1024)
    let canvas = NSBezierPath(roundedRect: NSRect(x: 72, y: 72, width: 880, height: 880), xRadius: 198, yRadius: 198)
    NSColor(srgbRed: 0.85, green: 0.96, blue: 0.35, alpha: 1).setFill()
    canvas.fill()
    NSColor(srgbRed: 0.20, green: 0.24, blue: 0.16, alpha: 1).setFill()
    for side in [-1.0, 1.0] {
        let page = NSBezierPath()
        page.move(to: NSPoint(x: 512 + side * 16, y: 288))
        page.line(to: NSPoint(x: 512 + side * 232, y: 332))
        page.curve(to: NSPoint(x: 512 + side * 268, y: 378), controlPoint1: NSPoint(x: 512 + side * 260, y: 338), controlPoint2: NSPoint(x: 512 + side * 268, y: 352))
        page.line(to: NSPoint(x: 512 + side * 268, y: 724))
        page.curve(to: NSPoint(x: 512 + side * 230, y: 752), controlPoint1: NSPoint(x: 512 + side * 268, y: 746), controlPoint2: NSPoint(x: 512 + side * 252, y: 758))
        page.line(to: NSPoint(x: 512 + side * 16, y: 708))
        page.close()
        page.fill()
        NSColor(srgbRed: 0.97, green: 0.98, blue: 0.91, alpha: 1).setStroke()
        for row in 0..<3 {
            let line = NSBezierPath()
            line.move(to: NSPoint(x: 512 + side * 72, y: 438 + Double(row) * 76))
            line.line(to: NSPoint(x: 512 + side * 212, y: 466 + Double(row) * 76))
            line.lineWidth = 17
            line.lineCapStyle = .round
            line.stroke()
        }
    }
    NSGraphicsContext.restoreGraphicsState()
    return bitmap.representation(using: .png, properties: [:])!
}

for size in [16, 32, 64, 128, 256, 512, 1024] {
    try icon(size: size).write(to: output.appendingPathComponent("\(size).png"))
}
