import Foundation

private final class NoRedirectDelegate: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

actor ModelClient {
    private let apiKey: String
    private let endpoint: URL
    private let session: URLSession
    private var requests = 0, inputTokens = 0, outputTokens = 0

    init(apiKey: String, base: URL, testing: Bool) {
        self.apiKey = apiKey
        endpoint = base.appendingPathComponent("chat/completions")
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 90
        configuration.timeoutIntervalForResource = 240
        if testing { configuration.connectionProxyDictionary = [:] }
        session = URLSession(configuration: configuration, delegate: NoRedirectDelegate(), delegateQueue: nil)
    }

    func usage() -> [String: Int] {
        ["requests": requests, "input_tokens": inputTokens, "output_tokens": outputTokens]
    }

    func finish() { session.invalidateAndCancel() }

    private func completion(messages: [[String: Any]], model: String, forMetadata: Bool = false) async throws -> String {
        var payload: [String: Any] = ["model": model, "temperature": 0, "messages": messages]
        if forMetadata {
            payload["response_format"] = ["type": "json_object"]
            payload["thinking"] = ["type": "disabled"]
        }
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer " + apiKey, forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)
        for attempt in 0..<3 {
            try Task.checkCancellation()
            if !forMetadata { requests += 1 }
            do {
                let (data, response) = try await session.data(for: request)
                guard let response = response as? HTTPURLResponse else { throw EngineFailure("模型服务响应无法读取") }
                let status = response.statusCode
                if status == 401 || status == 403 { throw EngineFailure("模型服务拒绝访问，请检查 API Key 和模型权限") }
                if status == 429 || status >= 500 {
                    if attempt < 2 { try await Task.sleep(nanoseconds: UInt64(attempt + 1) * 300_000_000); continue }
                    throw EngineFailure(status == 429 ? "模型请求受限，请检查账户额度或降低同时处理页数" : "模型服务暂时不可用，请稍后重试")
                }
                guard (200..<300).contains(status) else { throw EngineFailure("模型请求未成功，请检查模型名称和服务可用性") }
                guard let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                      let choices = object["choices"] as? [[String: Any]], let choice = choices.first,
                      let message = choice["message"] as? [String: Any], let content = message["content"] as? String else {
                    throw EngineFailure("模型服务响应格式无法读取，请重试")
                }
                if !forMetadata, let usage = object["usage"] as? [String: Any] {
                    inputTokens += number(usage["prompt_tokens"], fallback: 0)
                    outputTokens += number(usage["completion_tokens"], fallback: 0)
                }
                return content
            } catch is CancellationError { throw CancellationError() }
            catch let error as EngineFailure { throw error }
            catch {
                try Task.checkCancellation()
                if attempt < 2 { try await Task.sleep(nanoseconds: UInt64(attempt + 1) * 300_000_000) }
                else { throw EngineFailure("无法连接模型服务，请检查网络后重试") }
            }
        }
        throw EngineFailure("无法连接模型服务，请检查网络后重试")
    }

    func structure(image: URL, ocrText: String, pdfPage: Int, model: String) async throws -> BookPage {
        let encoded = try Data(contentsOf: image).base64EncodedString()
        let prompt = userPrompt.replacingOccurrences(of: "__OCR__", with: String(ocrText.prefix(4000)))
        for attempt in 0..<2 {
            let text = prompt + (attempt == 0 ? "" : "\n\n" + retryPrompt)
            let content: [[String: Any]] = [
                ["type": "text", "text": text],
                ["type": "image_url", "image_url": ["url": "data:image/png;base64," + encoded]],
            ]
            let raw = try await completion(messages: [["role": "user", "content": content]], model: model)
            if let object = extractJSONObject(raw), let page = try? normalizePage(object, pdfPage: pdfPage) { return page }
        }
        throw EngineFailure("模型未返回有效的页面结构，请检查多模态模型后重试")
    }

    func metadata(text: String) async -> [String: String] {
        guard text.trimmingCharacters(in: .whitespacesAndNewlines).count >= 3 else { return [:] }
        let system = "你是文献著录助手。根据给定的书页 OCR 文本（可能有识别错误），提取书籍元数据，只输出 JSON：{\"title\": 书名, \"author\": 作者, \"publisher\": 出版社, \"edition\": 版次, \"isbn\": ISBN}。不确定的字段填空字符串。"
        do {
            let raw = try await completion(messages: [["role": "system", "content": system],
                                                       ["role": "user", "content": "书页 OCR 文本：\n" + String(text.prefix(4000))]],
                                           model: "deepseek-flash", forMetadata: true)
            guard let object = extractJSONObject(raw) else { return [:] }
            return Dictionary(uniqueKeysWithValues: ["title", "author", "publisher", "edition", "isbn"].compactMap { key in
                let value = cleanString(object[key])
                return value.isEmpty ? nil : (key, value)
            })
        } catch { return [:] }
    }
}
