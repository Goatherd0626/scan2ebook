"""用自制 PDF 与仅回环模型检查已打包的 app，可保留窗口供原生 UI 验收。"""
from __future__ import annotations

import argparse
import io
import json
import os
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class MockModel(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        vision = isinstance(body["messages"][0]["content"], list)
        self.server.request_count += 1
        if body.get("model") == "desktop-test-slow":
            time.sleep(12)
        result = {"page_kind": "body", "items": [
            {"type": "heading", "level": 1, "text": "原生桌面样书"},
            {"type": "body", "text": "这是本机自动化验收的自制文字，可以搜索，也可以回到原 PDF 核对。[1]"},
            {"type": "footnote", "index": 1, "text": "本次结构化响应来自本机模拟模型。"},
        ], "toc": []} if vision else {"title": "原生桌面样书", "author": "自制测试", "publisher": "本机"}
        payload = json.dumps({"choices": [{"message": {"content": json.dumps(result, ensure_ascii=False)}}],
                              "usage": {"prompt_tokens": 10, "completion_tokens": 10}}).encode()
        try:
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        except (BrokenPipeError, ConnectionResetError):
            pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app", type=Path, required=True)
    parser.add_argument("--directory", type=Path, required=True, help="全新的隔离验收目录")
    parser.add_argument("--pdf", type=Path, required=True, help="自制扫描测试 PDF")
    parser.add_argument("--keep-open", action="store_true")
    args = parser.parse_args()
    # Tauri 在 macOS 拒绝含软链接的可执行路径；/tmp 实际指向 /private/tmp。
    args.app = args.app.resolve(strict=True)
    args.directory.mkdir(parents=True, exist_ok=False)
    model = ThreadingHTTPServer(("127.0.0.1", 0), MockModel)
    model.daemon_threads = True
    model.request_count = 0
    threading.Thread(target=model.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{model.server_port}"
    env = {name: os.environ[name] for name in ("HOME", "USER", "LOGNAME", "TMPDIR", "LANG") if name in os.environ}
    env.update({"PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "SCAN2EBOOK_TEST_API_BASE": base,
                "SCAN2EBOOK_DESKTOP_DATA_DIR": str(args.directory / "data"),
                "SCAN2EBOOK_DESKTOP_READY_FILE": str(args.directory / "ready.json"),
                "SCAN2EBOOK_DESKTOP_DOWNLOAD_DIR": str(args.directory / "downloads")})
    with (args.directory / "app.log").open("w") as log:
        app = subprocess.Popen([str(args.app / "Contents/MacOS/scan2ebook-desktop"), "--test-api-base", base],
                               env=env, stdout=log, stderr=log)
        try:
            deadline = time.monotonic() + 20
            ready = args.directory / "ready.json"
            while not ready.exists():
                if app.poll() is not None or time.monotonic() > deadline:
                    raise RuntimeError(f"应用未完成启动（退出码：{app.poll()}），请检查 {args.directory / 'app.log'}")
                time.sleep(0.05)
            url = json.loads(ready.read_text())["url"]

            def request(path, data=None, method=None, headers=None):
                value = urllib.request.Request(url + path, data=data, method=method, headers=headers or {})
                with urllib.request.urlopen(value, timeout=20) as response:
                    return response.read()

            def post(path, payload):
                return json.loads(request(path, json.dumps(payload).encode(), headers={"content-type": "application/json"}))

            assert b"<html" in request("/")
            storage = json.loads(request("/__scan2ebook__/storage"))
            assert storage["books"] == []
            api = "/__scan2ebook__/conversion"
            uploaded = json.loads(request(api + "/uploads", args.pdf.read_bytes(), headers={
                "content-type": "application/pdf", "x-s2e-filename": urllib.parse.quote(args.pdf.name)}))
            job = post(api + "/jobs", {"uploadId": uploaded["id"], "apiKey": "native-app-local-test-placeholder",
                                       "pageStart": 1, "pageEnd": uploaded["pages"], "model": "deepseek-flash", "workers": 2})
            deadline = time.monotonic() + 90
            while job["status"] == "running":
                assert time.monotonic() < deadline, "原生转换未按时完成"
                time.sleep(0.1)
                job = json.loads(request(api + "/jobs/" + job["id"]))
            assert job["status"] == "completed", job
            output = next(file for file in job["files"] if file["kind"] == "s2e")
            archive = request(output["url"])
            with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
                assert {"book.pdf", "book.json"} <= set(bundle.namelist())
                book = json.loads(bundle.read("book.json"))
                assert len(book["pages"]) == uploaded["pages"]
                assert bundle.read("book.pdf") == args.pdf.read_bytes()
            sample = args.directory / "原生桌面样书.s2e"
            sample.write_bytes(archive)
            history = (args.directory / "data/conversions/state.json").read_text()
            assert "native-app-local-test-placeholder" not in history
            report = {"url": url, "pid": app.pid, "directory": str(args.directory), "sample": str(sample),
                      "pages": uploaded["pages"], "modelRequests": model.request_count,
                      "jobId": job["id"], "checks": ["isolated-library", "system-only-PATH", "native-PDF-inspect",
                      "Rust-to-Swift-to-loopback-model", "compatible-s2e-and-source-PDF", "no-key-in-history"]}
            (args.directory / "smoke.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
            print(json.dumps(report, ensure_ascii=False), flush=True)
            if args.keep_open:
                app.wait()
        finally:
            if app.poll() is None:
                app.terminate()
                app.wait(timeout=10)
            model.shutdown()
            model.server_close()


if __name__ == "__main__":
    main()
