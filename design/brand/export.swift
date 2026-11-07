import AppKit
import CoreText

let output = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let ink = "#20251E", olive = "#738D28", lime = "#D9F458", paper = "#F7F8F5"

func color(_ hex: String) -> CGColor {
    let value = UInt32(hex.dropFirst(), radix: 16)!
    return CGColor(srgbRed: Double((value >> 16) & 255) / 255,
        green: Double((value >> 8) & 255) / 255, blue: Double(value & 255) / 255, alpha: 1)
}

func pathData(_ path: CGPath) -> String {
    var commands: [String] = []
    func point(_ p: CGPoint) -> String { String(format: "%.3f %.3f", p.x, p.y) }
    path.applyWithBlock { pointer in
        let element = pointer.pointee, p = pointer.pointee.points
        switch element.type {
        case .moveToPoint: commands.append("M" + point(p[0]))
        case .addLineToPoint: commands.append("L" + point(p[0]))
        case .addQuadCurveToPoint: commands.append("Q" + point(p[0]) + " " + point(p[1]))
        case .addCurveToPoint: commands.append("C" + point(p[0]) + " " + point(p[1]) + " " + point(p[2]))
        case .closeSubpath: commands.append("Z")
        @unknown default: break
        }
    }
    return commands.joined()
}

struct Mark {
    let id: String
    let paths: [CGPath]
    let dot: CGPath
    let width: CGFloat
    let height: CGFloat
}

func normalize(_ id: String, _ paths: [CGPath], _ dot: CGPath, topDown: Bool = false) -> Mark {
    let bounds = (paths + [dot]).reduce(CGRect.null) { $0.union($1.boundingBoxOfPath) }
    var transform = topDown
        ? CGAffineTransform(translationX: 2 - bounds.minX, y: 2 - bounds.minY)
        : CGAffineTransform(a: 1, b: 0, c: 0, d: -1, tx: 2 - bounds.minX, ty: bounds.maxY + 2)
    return Mark(id: id, paths: paths.map { $0.copy(using: &transform)! },
        dot: dot.copy(using: &transform)!, width: bounds.width + 4, height: bounds.height + 4)
}

func typography(_ id: String, fontName: String, tracking: CGFloat) -> Mark {
    let font = CTFontCreateWithName(fontName as CFString, 100, nil)
    let attributes: [NSAttributedString.Key: Any] = [
        NSAttributedString.Key(kCTFontAttributeName as String): font,
        NSAttributedString.Key(kCTKernAttributeName as String): tracking,
    ]
    let line = CTLineCreateWithAttributedString(NSAttributedString(string: "s2e", attributes: attributes))
    var paths: [CGPath] = []
    for run in CTLineGetGlyphRuns(line) as! [CTRun] {
        let count = CTRunGetGlyphCount(run)
        var glyphs = [CGGlyph](repeating: 0, count: count)
        var positions = [CGPoint](repeating: .zero, count: count)
        CTRunGetGlyphs(run, CFRange(location: 0, length: count), &glyphs)
        CTRunGetPositions(run, CFRange(location: 0, length: count), &positions)
        for index in 0..<count {
            var transform = CGAffineTransform(translationX: positions[index].x, y: positions[index].y)
            paths.append(CTFontCreatePathForGlyph(font, glyphs[index], nil)!.copy(using: &transform)!)
        }
    }
    let right = paths.map { $0.boundingBoxOfPath.maxX }.max()!
    let dot = CGPath(ellipseIn: CGRect(x: right + 6, y: 0, width: 13, height: 13), transform: nil)
    print("\(id): \(CTFontCopyPostScriptName(font))")
    return normalize(id, paths, dot)
}

func rounded() -> Mark {
    let s = CGMutablePath()
    s.move(to: CGPoint(x: 59, y: 20))
    s.addCurve(to: CGPoint(x: 12, y: 33), control1: CGPoint(x: 44, y: 3), control2: CGPoint(x: 12, y: 9))
    s.addCurve(to: CGPoint(x: 62, y: 71), control1: CGPoint(x: 12, y: 54), control2: CGPoint(x: 62, y: 47))
    s.addCurve(to: CGPoint(x: 10, y: 83), control1: CGPoint(x: 62, y: 96), control2: CGPoint(x: 28, y: 98))
    let two = CGMutablePath()
    two.move(to: CGPoint(x: 94, y: 29))
    two.addCurve(to: CGPoint(x: 146, y: 29), control1: CGPoint(x: 94, y: 1), control2: CGPoint(x: 146, y: 1))
    two.addCurve(to: CGPoint(x: 94, y: 88), control1: CGPoint(x: 146, y: 48), control2: CGPoint(x: 119, y: 61))
    two.addLine(to: CGPoint(x: 149, y: 88))
    let e = CGMutablePath()
    e.move(to: CGPoint(x: 177, y: 53)); e.addLine(to: CGPoint(x: 234, y: 53))
    e.addCurve(to: CGPoint(x: 175, y: 52), control1: CGPoint(x: 234, y: 1), control2: CGPoint(x: 175, y: 1))
    e.addCurve(to: CGPoint(x: 236, y: 78), control1: CGPoint(x: 175, y: 99), control2: CGPoint(x: 218, y: 100))
    let paths = [s, two, e].map { $0.copy(strokingWithWidth: 15, lineCap: .round, lineJoin: .round, miterLimit: 10) }
    return normalize("b-rounded", paths, CGPath(ellipseIn: CGRect(x: 253, y: 81, width: 16, height: 16), transform: nil), topDown: true)
}

func wordmarkGroup(_ mark: Mark, foreground: String, accent: String) -> String {
    let paths = mark.paths.map { "<path d=\"\(pathData($0))\"/>" }.joined()
    return "<g fill=\"\(foreground)\">\(paths)</g><path fill=\"\(accent)\" d=\"\(pathData(mark.dot))\"/>"
}

func svg(viewBox: String, title: String, content: String) -> String {
    "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"\(viewBox)\" role=\"img\"><title>\(title)</title>\(content)</svg>\n"
}

func bookPages() -> [CGPath] {
    let left = CGMutablePath()
    left.move(to: CGPoint(x: 40, y: 55))
    left.addCurve(to: CGPoint(x: 116, y: 75), control1: CGPoint(x: 68, y: 49), control2: CGPoint(x: 92, y: 57))
    left.addLine(to: CGPoint(x: 116, y: 213))
    left.addCurve(to: CGPoint(x: 40, y: 192), control1: CGPoint(x: 91, y: 195), control2: CGPoint(x: 67, y: 187))
    left.addCurve(to: CGPoint(x: 32, y: 184), control1: CGPoint(x: 35, y: 193), control2: CGPoint(x: 32, y: 190))
    left.addLine(to: CGPoint(x: 32, y: 64))
    left.addCurve(to: CGPoint(x: 40, y: 55), control1: CGPoint(x: 32, y: 59), control2: CGPoint(x: 35, y: 56))
    left.closeSubpath()
    let right = CGMutablePath()
    right.move(to: CGPoint(x: 132, y: 75))
    right.addCurve(to: CGPoint(x: 211, y: 55), control1: CGPoint(x: 157, y: 57), control2: CGPoint(x: 181, y: 51))
    right.addCurve(to: CGPoint(x: 219, y: 64), control1: CGPoint(x: 216, y: 56), control2: CGPoint(x: 219, y: 59))
    right.addLine(to: CGPoint(x: 219, y: 184))
    right.addCurve(to: CGPoint(x: 210, y: 192), control1: CGPoint(x: 219, y: 190), control2: CGPoint(x: 216, y: 193))
    right.addCurve(to: CGPoint(x: 132, y: 213), control1: CGPoint(x: 182, y: 188), control2: CGPoint(x: 156, y: 197))
    right.closeSubpath()
    let turning = CGMutablePath()
    turning.move(to: CGPoint(x: 132, y: 70))
    turning.addCurve(to: CGPoint(x: 186, y: 21), control1: CGPoint(x: 147, y: 47), control2: CGPoint(x: 165, y: 28))
    turning.addCurve(to: CGPoint(x: 193, y: 25), control1: CGPoint(x: 190, y: 20), control2: CGPoint(x: 192, y: 22))
    turning.addLine(to: CGPoint(x: 204, y: 45))
    turning.addCurve(to: CGPoint(x: 132, y: 70), control1: CGPoint(x: 174, y: 47), control2: CGPoint(x: 151, y: 57))
    turning.closeSubpath()
    return [left, right, turning]
}

let pages = bookPages()
func symbolGroup(foreground: String, accent: String) -> String {
    pages.enumerated().map { index, path in
        "<path fill=\"\(index == 2 ? accent : foreground)\" d=\"\(pathData(path))\"/>"
    }.joined()
}

func drawSymbol(in context: CGContext, foreground: String = ink, accent: String = olive) {
    for (index, path) in pages.enumerated() {
        context.setFillColor(color(index == 2 ? accent : foreground))
        context.addPath(path); context.fillPath()
    }
}

func png(width: Int, height: Int, viewWidth: CGFloat, viewHeight: CGFloat, draw: (CGContext) -> Void) -> Data {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    let context = NSGraphicsContext(bitmapImageRep: bitmap)!.cgContext
    context.clear(CGRect(x: 0, y: 0, width: width, height: height))
    context.translateBy(x: 0, y: CGFloat(height))
    context.scaleBy(x: CGFloat(width) / viewWidth, y: -CGFloat(height) / viewHeight)
    draw(context)
    return bitmap.representation(using: .png, properties: [:])!
}

func drawMark(_ mark: Mark, in context: CGContext, accent: String) {
    context.setFillColor(color(ink))
    for path in mark.paths { context.addPath(path); context.fillPath() }
    context.setFillColor(color(accent)); context.addPath(mark.dot); context.fillPath()
}

let marks = [typography("a-original", fontName: "HelveticaNeue-Bold", tracking: -5.5),
             rounded(), typography("c-editorial", fontName: "Georgia-Bold", tracking: -6)]
for mark in marks {
    let directory = output.appendingPathComponent(mark.id, isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    for (name, foreground, accent) in [("wordmark.svg", ink, olive), ("inverse.svg", paper, lime), ("mono.svg", ink, ink)] {
        try svg(viewBox: "0 0 \(mark.width) \(mark.height)", title: "Scan2Ebook 字标 s2e.",
                content: wordmarkGroup(mark, foreground: foreground, accent: accent))
            .write(to: directory.appendingPathComponent(name), atomically: true, encoding: .utf8)
    }
    try png(width: 1200, height: Int(ceil(1200 * mark.height / mark.width)), viewWidth: mark.width, viewHeight: mark.height) {
        drawMark(mark, in: $0, accent: olive)
    }.write(to: directory.appendingPathComponent("wordmark.png"))
    // 早期字形比较保留独立资源；正式应用只使用已确认的延续版。
    guard mark.id == "a-original" else { continue }
    for (suffix, foreground, accent) in [("", ink, olive), ("-inverse", paper, lime), ("-mono", ink, ink), ("-white", paper, paper)] {
        try svg(viewBox: "0 0 256 256", title: "Scan2Ebook 翻页图形标", content: symbolGroup(foreground: foreground, accent: accent))
            .write(to: directory.appendingPathComponent("symbol\(suffix).svg"), atomically: true, encoding: .utf8)
        let lockup = "<g transform=\"translate(0 -3) scale(.48)\">\(symbolGroup(foreground: foreground, accent: accent))</g><g transform=\"translate(136 18)\">\(wordmarkGroup(mark, foreground: foreground, accent: accent))</g>"
        try svg(viewBox: "0 0 312 112", title: "Scan2Ebook 图形与 s2e. 组合标", content: lockup)
            .write(to: directory.appendingPathComponent("logo\(suffix).svg"), atomically: true, encoding: .utf8)
    }
    try png(width: 1024, height: 1024, viewWidth: 256, viewHeight: 256) { drawSymbol(in: $0) }
        .write(to: directory.appendingPathComponent("symbol.png"))
    try png(width: 1560, height: 560, viewWidth: 312, viewHeight: 112) { context in
        context.saveGState(); context.translateBy(x: 0, y: -3); context.scaleBy(x: 0.48, y: 0.48)
        drawSymbol(in: context); context.restoreGState()
        context.translateBy(x: 136, y: 18); drawMark(mark, in: context, accent: olive)
    }.write(to: directory.appendingPathComponent("logo.png"))
    let icon = "<rect x=\"72\" y=\"72\" width=\"880\" height=\"880\" rx=\"198\" fill=\"\(lime)\"/><g transform=\"translate(110.4 129.6) scale(3.2)\">\(symbolGroup(foreground: ink, accent: ink))</g>"
    try svg(viewBox: "0 0 1024 1024", title: "Scan2Ebook 应用图标", content: icon)
        .write(to: directory.appendingPathComponent("app-icon.svg"), atomically: true, encoding: .utf8)
    for size in [16, 32, 64, 1024] {
        let data = png(width: size, height: size, viewWidth: 1024, viewHeight: 1024) { context in
            context.setFillColor(color(lime))
            context.addPath(CGPath(roundedRect: CGRect(x: 72, y: 72, width: 880, height: 880), cornerWidth: 198, cornerHeight: 198, transform: nil))
            context.fillPath()
            context.translateBy(x: 110.4, y: 129.6)
            context.scaleBy(x: 3.2, y: 3.2)
            drawSymbol(in: context, accent: ink)
        }
        try data.write(to: directory.appendingPathComponent("app-icon-\(size).png"))
    }
}
