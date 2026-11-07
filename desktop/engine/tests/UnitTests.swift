import Foundation

@main
enum EngineUnitTests {
    static func main() throws {
        let toc = try normalizePage([
            "page_kind": "toc", "items": [],
            "toc": [
                ["number": "1", "text": "【导论】", "level": 1, "printed_page": "8"],
                ["number": "2", "text": "缺失标题", "level": 2],
            ],
        ], pdfPage: 2)
        let body = try normalizePage([
            "page_kind": "body", "items": [
                ["type": "footnote", "index": 1, "text": "①参考资料"],
                ["type": "header", "text": "页眉"],
                ["type": "heading", "number": "1", "text": "（导论）", "level": 9],
                ["type": "body", "text": "正文[ 01 ]和⟦1⟧。"],
                ["type": "figure", "caption": "忽略"],
                ["type": "table", "rows": [["忽略"]]],
            ],
        ], pdfPage: 9)
        precondition(body.items.map(\.type) == ["heading", "body", "figure", "table", "footnote"])
        precondition(body.items[0].text == "导论" && body.items[0].level == 3)
        precondition(body.items[1].text == "正文[1]和⟦1⟧。")
        precondition(body.items.last?.text == "参考资料")
        let bookTOC = buildBookTOC([toc, body])
        precondition(bookTOC.count == 2)
        precondition(bookTOC[0].pdf_page == 9 && bookTOC[0].toc_page == 2)
        precondition(bookTOC[1].pdf_page == nil)
        let book = Ebook(pdf_source: "sample.pdf", book: ["title": "离线测试"], toc: bookTOC, pages: [toc, body])
        let html = try readerHTML(book, title: "<安全标题>")
        precondition(html.contains("&lt;安全标题&gt;") && html.contains("⟦1⟧"))
        precondition(extractJSONObject("prefix {\"text\":\"带有 } 花括号\"} trailing")?["text"] as? String == "带有 } 花括号")
        do {
            _ = try normalizePage(["unrelated": true], pdfPage: 1)
            preconditionFailure("无效结构不能成为空白页")
        } catch is EngineFailure {}
        print("离线页结构、脚注、目录、HTML 与解析测试通过")
    }
}
