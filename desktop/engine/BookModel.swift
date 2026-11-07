import Foundation

struct BookItem: Codable, Sendable {
    var type: String
    var text: String?
    var level: Int?
    var number: String?
    var index: Int?
    var _continued: Bool?
}

struct PageTOC: Codable, Sendable {
    var number: String
    var text: String
    var level: Int
    var printed_page: Int
}

struct BookPage: Codable, Sendable {
    var pdf_page: Int
    var page_kind: String
    var items: [BookItem]
    var toc: [PageTOC]
}

struct BookTOC: Codable, Sendable {
    var number: String
    var text: String
    var level: Int
    var printed_page: Int
    var toc_page: Int
    var pdf_page: Int?
    var matched_text: String?

    enum CodingKeys: String, CodingKey { case number, text, level, printed_page, toc_page, pdf_page, matched_text }
    func encode(to encoder: Encoder) throws {
        var box = encoder.container(keyedBy: CodingKeys.self)
        try box.encode(number, forKey: .number); try box.encode(text, forKey: .text)
        try box.encode(level, forKey: .level); try box.encode(printed_page, forKey: .printed_page)
        try box.encode(toc_page, forKey: .toc_page)
        if let pdf_page { try box.encode(pdf_page, forKey: .pdf_page) } else { try box.encodeNil(forKey: .pdf_page) }
        if let matched_text { try box.encode(matched_text, forKey: .matched_text) } else { try box.encodeNil(forKey: .matched_text) }
    }
}

struct Ebook: Encodable {
    var pdf_source: String
    var book: [String: String]
    var toc: [BookTOC]
    var pages: [BookPage]
}

func jsonData<T: Encodable>(_ value: T) throws -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    return try encoder.encode(value)
}

func cleanString(_ value: Any?) -> String {
    let result = (value as? String) ?? (value as? NSNumber)?.stringValue ?? ""
    return result.trimmingCharacters(in: .whitespacesAndNewlines)
}

func number(_ value: Any?, fallback: Int) -> Int {
    if let value = value as? NSNumber { return value.intValue }
    if let value = value as? String, let result = Double(value), result.isFinite,
       result >= Double(Int.min) && result < Double(Int.max) { return Int(result) }
    return fallback
}

func replaceMatches(_ pattern: String, in text: String, with replacement: (String, NSTextCheckingResult) -> String) -> String {
    guard let regex = try? NSRegularExpression(pattern: pattern) else { return text }
    var output = text as NSString
    let original = text as NSString
    for match in regex.matches(in: text, range: NSRange(location: 0, length: original.length)).reversed() {
        output = output.replacingCharacters(in: match.range, with: replacement(text, match)) as NSString
    }
    return output as String
}

func trimTitle(_ text: String) -> String {
    text.replacingOccurrences(of: #"^[〔【（(]+|[〕】）)]+$"#, with: "", options: .regularExpression)
        .trimmingCharacters(in: .whitespacesAndNewlines)
}

func extractJSONObject(_ raw: String) -> [String: Any]? {
    guard let start = raw.firstIndex(of: "{") else { return nil }
    var depth = 0, inString = false, escaped = false
    for index in raw[start...].indices {
        let char = raw[index]
        if inString {
            if escaped { escaped = false }
            else if char == "\\" { escaped = true }
            else if char == "\"" { inString = false }
        } else if char == "\"" { inString = true }
        else if char == "{" { depth += 1 }
        else if char == "}" {
            depth -= 1
            if depth == 0 {
                return (try? JSONSerialization.jsonObject(with: Data(raw[start...index].utf8))) as? [String: Any]
            }
        }
    }
    return nil
}

func normalizePage(_ object: [String: Any], pdfPage: Int) throws -> BookPage {
    let validKinds = ["cover", "title", "copyright", "toc", "body", "blank", "other"]
    let rawKind = cleanString(object["page_kind"]).lowercased()
    guard !rawKind.isEmpty, let rawItems = object["items"] as? [Any] else {
        throw EngineFailure("模型未返回有效的页面结构，请检查多模态模型后重试")
    }
    let kind = validKinds.contains(rawKind) ? rawKind : "body"
    var items: [BookItem] = [], footnotes: [BookItem] = []
    for raw in rawItems {
        guard let raw = raw as? [String: Any] else { continue }
        let type = cleanString(raw["type"]).lowercased()
        if ["figure", "table"].contains(type) { items.append(BookItem(type: type)); continue }
        guard ["heading", "body", "footnote"].contains(type) else { continue }
        var text = cleanString(raw["text"])
        guard !text.isEmpty else { continue }
        var item = BookItem(type: type)
        if type == "heading" {
            text = trimTitle(text)
            item.level = max(1, min(3, number(raw["level"], fallback: 2)))
            item.number = cleanString(raw["number"])
        } else if type == "footnote" {
            item.index = number(raw["index"], fallback: 1)
            text = text.replacingOccurrences(of: #"^\s*(?:[①②③④⑤⑥⑦⑧⑨⑩]|\d{1,2}[\.、．]?|\*{1,3}|[†‡§])\s*"#, with: "", options: .regularExpression)
                .trimmingCharacters(in: .whitespacesAndNewlines)
        }
        text = replaceMatches(#"\[\s*(\d+)\s*\]"#, in: text) { source, match in
            "[" + String(Int((source as NSString).substring(with: match.range(at: 1))) ?? 0) + "]"
        }
        item.text = text
        if type == "footnote" { footnotes.append(item) } else { items.append(item) }
    }
    var toc: [PageTOC] = []
    if kind == "toc" {
        for raw in object["toc"] as? [[String: Any]] ?? [] {
            let text = trimTitle(cleanString(raw["text"]))
            if !text.isEmpty {
                toc.append(PageTOC(number: cleanString(raw["number"]), text: text,
                                   level: max(1, min(3, number(raw["level"], fallback: 2))),
                                   printed_page: number(raw["printed_page"], fallback: 0)))
            }
        }
    }
    return BookPage(pdf_page: pdfPage, page_kind: kind, items: items + footnotes, toc: toc)
}

private func normalizedTitle(_ text: String) -> String {
    text.lowercased().replacingOccurrences(of: #"[\s·．.\-–—:：,，;；、()（）\[\]「」『』《》<>]+"#, with: "", options: .regularExpression)
}

// 标题通常很短；按最长连续匹配递归，保持与既有 difflib 的相似度定义一致。
private func matchingCharacters(_ lhs: ArraySlice<Character>, _ rhs: ArraySlice<Character>) -> Int {
    guard !lhs.isEmpty && !rhs.isEmpty else { return 0 }
    let left = Array(lhs), right = Array(rhs)
    var previous = [Int](repeating: 0, count: right.count + 1)
    var best = 0, leftEnd = 0, rightEnd = 0
    for i in left.indices {
        var current = [Int](repeating: 0, count: right.count + 1)
        for j in right.indices where left[i] == right[j] {
            current[j + 1] = previous[j] + 1
            if current[j + 1] > best { best = current[j + 1]; leftEnd = i + 1; rightEnd = j + 1 }
        }
        previous = current
    }
    guard best > 0 else { return 0 }
    return best + matchingCharacters(left[..<(leftEnd - best)], right[..<(rightEnd - best)])
        + matchingCharacters(left[leftEnd...], right[rightEnd...])
}

func buildBookTOC(_ pages: [BookPage]) -> [BookTOC] {
    let headings = pages.filter { ["body", "title", "other"].contains($0.page_kind) }
        .flatMap { page in page.items.filter { $0.type == "heading" }.map { (page.pdf_page, $0) } }
    var used = Set<Int>(), result: [BookTOC] = []
    for page in pages {
        for entry in page.toc {
            let text = Array(normalizedTitle(entry.text)), printedNumber = normalizedTitle(entry.number)
            var bestIndex: Int?, bestScore = 0.0
            for (index, heading) in headings.enumerated() where !used.contains(index) {
                let candidate = Array(normalizedTitle(heading.1.text ?? ""))
                var score = text.isEmpty && candidate.isEmpty ? 1.0
                    : 2.0 * Double(matchingCharacters(text[...], candidate[...])) / Double(max(1, text.count + candidate.count))
                if !printedNumber.isEmpty && normalizedTitle(heading.1.number ?? "") == printedNumber { score += 0.3 }
                if score > bestScore { bestScore = score; bestIndex = index }
            }
            let match = bestScore >= 0.55 ? bestIndex : nil
            if let match { used.insert(match) }
            result.append(BookTOC(number: entry.number, text: entry.text, level: entry.level,
                                  printed_page: entry.printed_page, toc_page: page.pdf_page,
                                  pdf_page: match.map { headings[$0].0 }, matched_text: match.flatMap { headings[$0].1.text }))
        }
    }
    return result.enumerated().sorted {
        let left = $0.element.pdf_page ?? Int.max, right = $1.element.pdf_page ?? Int.max
        return left == right ? $0.offset < $1.offset : left < right
    }.map(\.element)
}

func readerHTML(_ book: Ebook, title: String) throws -> String {
    var pages = book.pages
    var footnotes: [Any] = [NSNull()]
    var indices: [String: Int] = [:]
    for page in pages {
        for item in page.items where item.type == "footnote" {
            let index = item.index ?? footnotes.count
            indices["\(page.pdf_page):\(index)"] = footnotes.count
            footnotes.append(["index": index, "text": item.text ?? "", "page": page.pdf_page])
        }
    }
    for p in pages.indices {
        for i in pages[p].items.indices where pages[p].items[i].type == "body" {
            let original = pages[p].items[i].text ?? ""
            pages[p].items[i].text = replaceMatches(#"(?:\[(\d+)\]|⟦(\d+)⟧)"#, in: original) { source, match in
                let group = match.range(at: 1).location != NSNotFound ? 1 : 2
                let local = Int((source as NSString).substring(with: match.range(at: group))) ?? 0
                return indices["\(pages[p].pdf_page):\(local)"].map { "⟦\($0)⟧" } ?? (source as NSString).substring(with: match.range)
            }
        }
        if p > 0, let last = pages[p - 1].items.last, let first = pages[p].items.first,
           last.type == "body", first.type == "body", (first.text?.count ?? 0) >= 6,
           (last.text ?? "").range(of: #"[。！？!?….\"”’』」）)]$"#, options: .regularExpression) == nil {
            pages[p].items[0]._continued = true
        }
    }
    let data: [String: Any] = [
        "pages": try JSONSerialization.jsonObject(with: jsonData(pages)), "footnotes": footnotes,
        "metadata": book.book, "toc": try JSONSerialization.jsonObject(with: jsonData(book.toc)),
    ]
    let encoded = try JSONSerialization.data(withJSONObject: data, options: [.sortedKeys, .fragmentsAllowed])
    let content = String(decoding: encoded, as: UTF8.self).replacingOccurrences(of: "</", with: "<\\/")
    let safeTitle = title.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
    return readerTemplate.replacingOccurrences(of: "__TITLE__", with: safeTitle).replacingOccurrences(of: "__BOOK_JSON__", with: content)
}
