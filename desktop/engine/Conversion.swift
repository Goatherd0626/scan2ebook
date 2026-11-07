import Foundation
import PDFKit
import Darwin

struct PreparedPage: Sendable {
    var number: Int
    var text: String
    var image: URL?
}

func packageArchive(directory: URL, archive: URL) throws {
    // Foundation Process 会在 macOS 新建子进程组；显式继承引擎组才能由 Rust 一并取消。
    var attributes: posix_spawnattr_t?
    var actions: posix_spawn_file_actions_t?
    guard posix_spawnattr_init(&attributes) == 0 else { throw EngineFailure("电子书打包进程无法启动") }
    defer { posix_spawnattr_destroy(&attributes) }
    guard posix_spawn_file_actions_init(&actions) == 0 else { throw EngineFailure("电子书打包进程无法启动") }
    defer { posix_spawn_file_actions_destroy(&actions) }
    guard posix_spawnattr_setflags(&attributes, Int16(POSIX_SPAWN_SETPGROUP)) == 0,
          posix_spawnattr_setpgroup(&attributes, getpgrp()) == 0,
          posix_spawn_file_actions_addopen(&actions, STDIN_FILENO, "/dev/null", O_RDONLY, 0) == 0,
          posix_spawn_file_actions_addopen(&actions, STDOUT_FILENO, "/dev/null", O_WRONLY, 0) == 0,
          posix_spawn_file_actions_addopen(&actions, STDERR_FILENO, "/dev/null", O_WRONLY, 0) == 0 else {
        throw EngineFailure("电子书打包进程无法启动")
    }
    let executable = "/usr/bin/ditto"
    var arguments: [UnsafeMutablePointer<CChar>?] = [executable, "-c", "-k", "--norsrc", "--noextattr", directory.path, archive.path].map { value in
        value.withCString { strdup($0) }
    }
    arguments.append(nil)
    let environment: [UnsafeMutablePointer<CChar>?] = [strdup("PATH=/usr/bin:/bin"), nil]
    defer {
        arguments.forEach { free($0) }
        environment.forEach { free($0) }
    }
    var pid: pid_t = 0
    let code = arguments.withUnsafeBufferPointer { argv in
        environment.withUnsafeBufferPointer { envp in
            posix_spawn(&pid, executable, &actions, &attributes, argv.baseAddress!, envp.baseAddress!)
        }
    }
    guard code == 0 else { throw EngineFailure("电子书打包进程无法启动") }
    var status: Int32 = 0
    while waitpid(pid, &status, 0) == -1 {
        if errno != EINTR { throw EngineFailure("电子书打包进程无法等待") }
    }
    guard status == 0 else { throw EngineFailure("电子书打包失败，请检查可用磁盘空间") }
}

func convert(_ options: Options, base: URL, testing: Bool) async throws {
    let source = URL(fileURLWithPath: options.file).standardizedFileURL
    let document = try openPDF(source)
    let first = options.first ?? 1, last = options.last ?? document.pageCount
    guard first >= 1, last >= first, last <= document.pageCount else { throw EngineFailure("页码范围无效，起始页不能大于结束页或超出 PDF 总页数") }
    let apiKey = (ProcessInfo.processInfo.environment["DEEPSEEK_API_KEY"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    guard !apiKey.isEmpty else { throw EngineFailure("请填写本次转换使用的 API Key") }
    let out = URL(fileURLWithPath: options.output).standardizedFileURL
    try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
    let work = out.appendingPathComponent(".work-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: work, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: work) }
    let total = last - first + 1
    emit(["stage": "start", "progress": 1, "current": 0, "total": total, "page_start": first, "page_end": last,
          "model": options.model, "message": "准备转换第 \(first)–\(last) 页"], enabled: options.progress)
    var prepared: [PreparedPage] = []
    // 逐页处理并只保留缩小后的 PNG，避免长书同时持有数百张 300 DPI 位图。
    for (offset, index) in (first...last).enumerated() {
        try Task.checkCancellation()
        let result: PreparedPage = try autoreleasepool {
            guard let page = document.page(at: index - 1) else { throw EngineFailure("PDF 第 \(index) 页无法读取") }
            let image = try renderPDFPage(page)
            // 与旧实现相同：存在可靠文字层时优先使用，否则使用本机 Vision。
            let embedded = page.string?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let text = embedded.count > 50 ? embedded : try recognizeText(image)
            let imageURL = text.trimmingCharacters(in: .whitespacesAndNewlines).count < 3 ? nil : work.appendingPathComponent("page-\(index).png")
            if let imageURL { try modelPNG(image).write(to: imageURL) }
            return PreparedPage(number: index, text: text, image: imageURL)
        }
        prepared.append(result)
        emit(["stage": "ocr", "progress": 5 + 45 * Double(offset + 1) / Double(total),
              "current": offset + 1, "total": total, "pdf_page": index, "message": "正在渲染并识别第 \(index) 页"], enabled: options.progress)
    }
    let client = ModelClient(apiKey: apiKey, base: base, testing: testing)
    var pages: [Int: BookPage] = [:]
    do {
        try await withThrowingTaskGroup(of: BookPage.self) { group in
            var next = 0, completed = 0
            func enqueue(_ page: PreparedPage) {
                group.addTask {
                    try Task.checkCancellation()
                    guard let image = page.image else {
                        return BookPage(pdf_page: page.number, page_kind: "blank", items: [], toc: [])
                    }
                    return try await client.structure(image: image, ocrText: page.text, pdfPage: page.number, model: options.model)
                }
            }
            while next < min(options.workers, total) { enqueue(prepared[next]); next += 1 }
            do {
                while let page = try await group.next() {
                    pages[page.pdf_page] = page; completed += 1
                    emit(["stage": "structure", "progress": 50 + 45 * Double(completed) / Double(total), "current": completed,
                          "total": total, "pdf_page": page.pdf_page, "usage": await client.usage(),
                          "message": "正在结构化第 \(page.pdf_page) 页"], enabled: options.progress)
                    if next < total { enqueue(prepared[next]); next += 1 }
                }
            } catch { group.cancelAll(); throw error }
        }
        emit(["stage": "finalize", "progress": 96, "usage": await client.usage(), "message": "正在生成元数据与电子书文件"], enabled: options.progress)
        var metadata = await client.metadata(text: prepared.prefix(3).map(\.text).joined(separator: "\n"))
        let stem = source.deletingPathExtension().lastPathComponent
        if metadata["title"] == nil { metadata["title"] = stem }
        let ordered = (first...last).compactMap { pages[$0] }
        guard ordered.count == total else { throw EngineFailure("页面结构不完整，请重新转换") }
        let book = Ebook(pdf_source: source.lastPathComponent, book: metadata, toc: buildBookTOC(ordered), pages: ordered)
        let bookJSON = try jsonData(book)
        let json = out.appendingPathComponent(stem + ".json"), html = out.appendingPathComponent(stem + ".html"), archive = out.appendingPathComponent(stem + ".s2e")
        let staging = work.appendingPathComponent("bundle", isDirectory: true)
        try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: true)
        try bookJSON.write(to: staging.appendingPathComponent("book.json"))
        try FileManager.default.copyItem(at: source, to: staging.appendingPathComponent("book.pdf"))
        let temporaryArchive = work.appendingPathComponent("book.s2e")
        try packageArchive(directory: staging, archive: temporaryArchive)
        try bookJSON.write(to: json, options: .atomic)
        try readerHTML(book, title: stem).write(to: html, atomically: true, encoding: .utf8)
        if FileManager.default.fileExists(atPath: archive.path) { try FileManager.default.removeItem(at: archive) }
        try FileManager.default.moveItem(at: temporaryArchive, to: archive)
        emit(["stage": "complete", "progress": 100, "usage": await client.usage(), "output_dir": out.path,
              "book_json": json.path, "html": html.path, "s2e": archive.path, "message": "转换完成"], enabled: options.progress)
        if !options.progress { print("转换完成：\(archive.path)") }
        await client.finish()
    } catch { await client.finish(); throw error }
}
