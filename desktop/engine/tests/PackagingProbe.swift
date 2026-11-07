import Foundation
import Darwin

@main
enum PackagingProbe {
    static func main() throws {
        let directory = URL(fileURLWithPath: CommandLine.arguments[1])
        let bundle = directory.appendingPathComponent("bundle")
        try FileManager.default.createDirectory(at: bundle, withIntermediateDirectories: true)
        var data = Data(count: 96 * 1024 * 1024)
        data.withUnsafeMutableBytes { pointer in arc4random_buf(pointer.baseAddress!, pointer.count) }
        try data.write(to: bundle.appendingPathComponent("book.pdf"))
        try Data("{}".utf8).write(to: bundle.appendingPathComponent("book.json"))
        FileHandle.standardOutput.write(Data("ready\n".utf8))
        try packageArchive(directory: bundle, archive: directory.appendingPathComponent("book.s2e"))
    }
}
