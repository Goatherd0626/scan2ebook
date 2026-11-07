import Foundation
import Darwin

struct EngineFailure: Error {
    let message: String
    init(_ message: String) { self.message = message }
}

struct Options {
    var file = ""
    var output = "output"
    var first: Int?
    var last: Int?
    var model = "deepseek-v4-flash-vision-exp"
    var workers = 6
    var progress = false
}

func emit(_ event: [String: Any], enabled: Bool = true) {
    guard enabled, let data = try? JSONSerialization.data(withJSONObject: event, options: [.sortedKeys, .withoutEscapingSlashes]) else { return }
    FileHandle.standardOutput.write(Data("S2E_EVENT ".utf8) + data + Data("\n".utf8))
}

func printJSON(_ value: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .withoutEscapingSlashes]) {
        FileHandle.standardOutput.write(data + Data("\n".utf8))
    }
}

func parseOptions(_ args: [String]) throws -> Options {
    guard let source = args.first, !source.hasPrefix("--") else { throw EngineFailure("请选择要转换的 PDF") }
    var result = Options(); result.file = source
    var i = 1
    while i < args.count {
        let flag = args[i]
        if flag == "--progress-json" { result.progress = true; i += 1; continue }
        guard i + 1 < args.count else { throw EngineFailure("转换参数缺少值") }
        let value = args[i + 1]
        switch flag {
        case "-o", "--out": result.output = value
        case "--page-start":
            guard let number = Int(value) else { throw EngineFailure("起始页必须是整数") }
            result.first = number
        case "--page-end":
            guard let number = Int(value) else { throw EngineFailure("结束页必须是整数") }
            result.last = number
        case "--vision-model": result.model = value.trimmingCharacters(in: .whitespacesAndNewlines)
        case "--workers":
            guard let number = Int(value), (1...16).contains(number) else { throw EngineFailure("并发数应为 1–16 的整数") }
            result.workers = number
        default: throw EngineFailure("不支持的转换参数")
        }
        i += 2
    }
    guard !result.model.isEmpty, result.model.count <= 150 else { throw EngineFailure("请填写有效的多模态模型名称") }
    return result
}

func apiConfiguration(_ arguments: inout [String]) throws -> (URL, Bool) {
    let configured = ProcessInfo.processInfo.environment["SCAN2EBOOK_TEST_API_BASE"]
    let flag = arguments.firstIndex(of: "--test-api-base")
    if configured == nil && flag == nil { return (URL(string: "https://api.deepseek.com")!, false) }
    guard let flag, flag + 1 < arguments.count, let configured,
          arguments[flag + 1] == configured, let url = URL(string: configured),
          url.scheme == "http", ["127.0.0.1", "[::1]", "::1"].contains(url.host ?? ""),
          url.user == nil, url.password == nil, url.query == nil, url.fragment == nil else {
        throw EngineFailure("测试端点需显式参数与环境同时指定同一个回环 HTTP 地址")
    }
    arguments.removeSubrange(flag...(flag + 1))
    guard !arguments.contains("--test-api-base") else { throw EngineFailure("测试端点不能重复指定") }
    return (url, true)
}

func parentMonitor() -> DispatchSourceTimer {
    let parent = getppid()
    let timer = DispatchSource.makeTimerSource(queue: .global(qos: .utility))
    timer.schedule(deadline: .now() + 1, repeating: 1)
    timer.setEventHandler {
        if getppid() != parent {
            // Rust 给引擎独立进程组；直接从终端运行时不触碰终端所属的组。
            if getpgrp() == getpid() { kill(-getpid(), SIGTERM) }
            exit(1)
        }
    }
    timer.resume()
    return timer
}

#if !ENGINE_TESTS
@main
enum Scan2EbookEngine {
    static func main() async {
        var args = Array(CommandLine.arguments.dropFirst())
        let progress = args.contains("--progress-json")
        let inspecting = args.contains("inspect"), checking = args.contains("--self-check")
        do {
            if args == ["--help"] || args == ["-h"] {
                print("用法：scan2ebook-engine inspect PDF\n      scan2ebook-engine PDF -o 目录 --page-start N --page-end N --vision-model 模型 --workers N --progress-json\n      scan2ebook-engine --self-check [PDF]")
                return
            }
            if checking {
                guard args.first == "--self-check", args.count <= 2 else { throw EngineFailure("自检用法：--self-check [PDF]") }
                printJSON(try selfCheck(args.count == 2 ? args[1] : nil)); return
            }
            let (base, testing) = try apiConfiguration(&args)
            if args.first == "inspect" {
                guard args.count == 2 else { throw EngineFailure("检查用法：inspect PDF") }
                let url = URL(fileURLWithPath: args[1]), document = try openPDF(url)
                printJSON(["ok": true, "pages": document.pageCount, "name": url.lastPathComponent]); return
            }
            let options = try parseOptions(args)
            let monitor = parentMonitor()
            defer { monitor.cancel() }
            try await convert(options, base: base, testing: testing)
        } catch {
            let message = (error as? EngineFailure)?.message ?? (error is CancellationError ? "转换已取消" : "本机转换失败，请检查 PDF、磁盘空间和网络后重试")
            if inspecting || checking { printJSON(["ok": false, "error": message]) }
            else {
                emit(["stage": "failed", "message": message], enabled: progress)
                FileHandle.standardError.write(Data(("ERROR " + message + "\n").utf8))
            }
            exit(1)
        }
    }
}
#endif
