// 从 macOS 系统导出 SF Symbols 图标为高清 PNG（素材生成器）
// 用法: swift scripts/export_sf_symbol.swift <symbolName> <输出路径.png>
import AppKit

guard CommandLine.arguments.count >= 3 else {
    print("用法: swift export_sf_symbol.swift <symbolName> <输出.png> [regular|bold]")
    exit(1)
}
let name = CommandLine.arguments[1]
let out = CommandLine.arguments[2]
let weightName = CommandLine.arguments.count >= 4 ? CommandLine.arguments[3] : "regular"
let weight: NSFont.Weight = weightName == "bold" ? .bold
    : weightName == "semibold" ? .semibold : .regular

guard let base = NSImage(systemSymbolName: name, accessibilityDescription: nil) else {
    FileHandle.standardError.write("找不到 SF Symbol: \(name)\n".data(using: .utf8)!)
    exit(2)
}
let config = NSImage.SymbolConfiguration(pointSize: 512, weight: weight)
guard let img = base.withSymbolConfiguration(config),
      let tiff = img.tiffRepresentation,
      let rep = NSBitmapImageRep(data: tiff),
      let png = rep.representation(using: .png, properties: [:]) else {
    FileHandle.standardError.write("渲染失败: \(name)\n".data(using: .utf8)!)
    exit(3)
}
try png.write(to: URL(fileURLWithPath: out))
print("OK \(name) -> \(out) (\(rep.pixelsWide)x\(rep.pixelsHigh))")
