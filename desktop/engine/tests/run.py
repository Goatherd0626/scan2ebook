"""仅回环假模型的原生引擎协议测试；不使用真实 Key，不出公网。"""
import json
import os
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KEY = "native-offline-test-placeholder"
BOOK_METADATA = {
    "title": "原生引擎离线样书",
    "author": "自制测试",
    "publisher": "本机",
    "edition": "第1版",
    "isbn": "978-7-000-00000-1",
}


class ModelHandler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        is_vision = isinstance(body["messages"][0]["content"], list)
        with self.server.lock:
            self.server.requests += 1
            self.server.active += 1
            self.server.peak = max(self.server.peak, self.server.active)
            request_number = self.server.requests
        try:
            mode = self.server.mode
            if mode == "transient" and request_number == 1:
                self.send_response(503)
                self.end_headers()
                self.wfile.write(json.dumps({"error": KEY}).encode())
                return
            if mode == "unauthorized":
                self.send_response(401)
                self.end_headers()
                self.wfile.write(json.dumps({"error": KEY}).encode())
                return
            if mode == "redirect":
                self.send_response(307)
                self.send_header("Location", "https://example.invalid/forbidden-test")
                self.end_headers()
                return
            if mode == "slow":
                time.sleep(8)
            else:
                time.sleep(0.08)
            if is_vision:
                prompt = body["messages"][0]["content"][0]["text"]
                image = body["messages"][0]["content"][1]["image_url"]["url"]
                if not image.startswith("data:image/png;base64,") or "__OCR__" in prompt:
                    raise AssertionError("图像或 OCR 请求不符合协议")
                result = {"page_kind": "body", "items": [
                    {"type": "header", "text": "不应保留"},
                    {"type": "heading", "text": "【第一章 导论】", "number": "第一章", "level": 1},
                    {"type": "body", "text": "离线测试正文[ 01 ]。"},
                    {"type": "figure", "text": "不应保留的描述"},
                    {"type": "footnote", "index": 1, "text": "①自制测试脚注"},
                ], "toc": []}
            else:
                if body.get("model") != "deepseek-flash":
                    self.send_error(404, "Metadata model unavailable")
                    return
                if (body.get("response_format") != {"type": "json_object"}
                        or body.get("thinking") != {"type": "disabled"}):
                    self.send_error(400, "Invalid metadata request options")
                    return
                result = BOOK_METADATA
            content = "broken JSON" if mode == "invalid" or (mode == "retry" and request_number == 1) else json.dumps(result, ensure_ascii=False)
            output = json.dumps({"choices": [{"message": {"content": content}}], "usage": {"prompt_tokens": 12, "completion_tokens": 8}}).encode()
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(output)))
            self.end_headers()
            self.wfile.write(output)
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            with self.server.lock:
                self.server.active -= 1


class NativeEngineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="s2e-native-test-")
        cls.directory = Path(cls.temp.name)
        cls.engine = cls.directory / "engine"
        sources = sorted(ROOT.glob("*.swift"))
        cache = Path(tempfile.gettempdir()) / "scan2ebook-swift-module-cache"
        cls.sources, cls.cache = sources, cache
        subprocess.run(["xcrun", "swiftc", "-parse-as-library", "-O", "-module-cache-path", str(cache), "-target", "arm64-apple-macosx13.0", *map(str, sources), "-o", str(cls.engine)], check=True)
        cls.fixture = cls.directory / "sample.PDF"
        cls.locked = cls.directory / "locked.pdf"
        maker = cls.directory / "make-fixture"
        subprocess.run(["xcrun", "swiftc", "-module-cache-path", str(cache), "-target", "arm64-apple-macosx13.0", str(ROOT / "tests/MakeFixture.swift"), "-o", str(maker)], check=True)
        subprocess.run([str(maker), str(cls.fixture), str(cls.locked)], check=True)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def run_engine(self, args, extra_env=None):
        env = {"PATH": "/usr/bin:/bin", "DEEPSEEK_API_KEY": KEY}
        env.update(extra_env or {})
        return subprocess.run([str(self.engine), *map(str, args)], env=env, capture_output=True, text=True, timeout=90)

    def server(self, mode):
        server = ThreadingHTTPServer(("127.0.0.1", 0), ModelHandler)
        server.mode, server.requests, server.active, server.peak = mode, 0, 0, 0
        server.lock = threading.Lock()
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return server, "http://127.0.0.1:" + str(server.server_port)

    def convert(self, mode="success", workers=2):
        server, base = self.server(mode)
        out = self.directory / (mode + "-" + str(time.time_ns()))
        result = self.run_engine([self.fixture, "-o", out, "--page-start", 2, "--page-end", 4,
                                  "--vision-model", "fake-local", "--workers", workers,
                                  "--progress-json", "--test-api-base", base], {"SCAN2EBOOK_TEST_API_BASE": base})
        self.assertNotIn(KEY, result.stdout + result.stderr)
        return server, out, result

    def test_inspect_rejects_encrypted_pdf_and_preserves_page_count(self):
        result = self.run_engine(["inspect", self.fixture])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["pages"], 4)
        locked = self.run_engine(["inspect", self.locked])
        self.assertNotEqual(locked.returncode, 0)
        self.assertFalse(json.loads(locked.stdout)["ok"])
        _server, base = self.server("success")
        prefixed = self.run_engine(["--test-api-base", base, "inspect", self.fixture], {"SCAN2EBOOK_TEST_API_BASE": base})
        self.assertEqual(prefixed.returncode, 0, prefixed.stderr)
        self.assertEqual(json.loads(prefixed.stdout)["pages"], 4)

    def test_self_check_uses_rendering_and_real_offline_ocr(self):
        result = self.run_engine(["--self-check"])
        self.assertEqual(result.returncode, 0, result.stderr)
        value = json.loads(result.stdout)
        self.assertTrue(value["ok"])
        self.assertFalse(value["networkUsed"])
        self.assertEqual(value["dpi"], 300)
        self.assertGreater(value["ocrCharacters"], 8)
        self.assertIn("12345", value["ocrText"])

    def test_native_schema_toc_footnotes_and_html(self):
        binary = self.directory / "unit-tests"
        subprocess.run(["xcrun", "swiftc", "-parse-as-library", "-D", "ENGINE_TESTS",
                        "-module-cache-path", str(self.cache), "-target", "arm64-apple-macosx13.0",
                        *map(str, self.sources), str(ROOT / "tests/UnitTests.swift"), "-o", str(binary)], check=True)
        result = subprocess.run([str(binary)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_full_conversion_preserves_pdf_pages_blank_page_and_archive(self):
        server, out, result = self.convert()
        self.assertEqual(result.returncode, 0, result.stderr)
        book = json.loads((out / "sample.json").read_text())
        self.assertEqual([page["pdf_page"] for page in book["pages"]], [2, 3, 4])
        self.assertEqual(book["pages"][1]["page_kind"], "blank")
        self.assertEqual(book["pages"][1]["items"], [])
        items = book["pages"][0]["items"]
        self.assertEqual([item["type"] for item in items], ["heading", "body", "figure", "footnote"])
        self.assertEqual(items[1]["text"], "离线测试正文[1]。")
        self.assertEqual(items[2], {"type": "figure"})
        self.assertEqual(items[-1]["text"], "自制测试脚注")
        self.assertEqual(book["book"], BOOK_METADATA)
        self.assertLessEqual(server.peak, 2)
        self.assertEqual(server.requests, 3)
        events = [json.loads(line[10:]) for line in result.stdout.splitlines() if line.startswith("S2E_EVENT ")]
        self.assertEqual(events[-1]["stage"], "complete")
        self.assertEqual(events[-1]["progress"], 100)
        self.assertEqual(events[-1]["usage"]["requests"], 2)
        with zipfile.ZipFile(out / "sample.s2e") as archive:
            self.assertEqual(set(archive.namelist()), {"book.json", "book.pdf"})
            self.assertEqual(archive.read("book.pdf"), self.fixture.read_bytes())
            self.assertEqual(json.loads(archive.read("book.json")), book)
        for file in out.iterdir():
            self.assertNotIn(KEY.encode(), file.read_bytes())
        self.assertIn("⟦1⟧", (out / "sample.html").read_text())

    def test_retry_invalid_json_and_failures_never_become_blank_success(self):
        server, _out, result = self.convert("retry", workers=1)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(server.requests, 4)
        server, _out, result = self.convert("transient", workers=1)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(server.requests, 4)
        for mode in ["invalid", "unauthorized", "redirect"]:
            with self.subTest(mode=mode):
                _server, out, result = self.convert(mode)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('"stage":"failed"', result.stdout)
                self.assertFalse((out / "sample.s2e").exists())

    def test_test_endpoint_requires_both_opt_ins_and_loopback_address(self):
        base_args = [self.fixture, "-o", self.directory / "rejected", "--progress-json"]
        for args, env in [(base_args, {"SCAN2EBOOK_TEST_API_BASE": "http://127.0.0.1:9"}),
                          (base_args + ["--test-api-base"], {}),
                          (base_args + ["--test-api-base", "https://example.invalid"], {"SCAN2EBOOK_TEST_API_BASE": "https://example.invalid"})]:
            result = self.run_engine(args, env)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('"stage":"failed"', result.stdout)

    def test_engine_exits_when_its_parent_disappears(self):
        server, base = self.server("slow")
        command = [str(self.engine), "--test-api-base", base, str(self.fixture), "-o", str(self.directory / "parent-death"),
                   "--page-start", "2", "--page-end", "2", "--vision-model", "fake-local", "--progress-json"]
        script = "import subprocess,time; p=subprocess.Popen(" + repr(command) + ",stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True); print(p.pid,flush=True); time.sleep(60)"
        wrapper = subprocess.Popen([sys.executable, "-c", script], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                   env={"PATH": "/usr/bin:/bin", "DEEPSEEK_API_KEY": KEY, "SCAN2EBOOK_TEST_API_BASE": base})
        pid = int(wrapper.stdout.readline().strip())
        def alive():
            try:
                os.kill(pid, 0)
                return True
            except ProcessLookupError:
                return False
        try:
            deadline = time.monotonic() + 20
            while not server.requests and time.monotonic() < deadline:
                time.sleep(0.05)
            self.assertGreater(server.requests, 0)
            wrapper.terminate()
            wrapper.wait(timeout=3)
            deadline = time.monotonic() + 4
            while alive() and time.monotonic() < deadline:
                time.sleep(0.05)
            self.assertFalse(alive(), "父进程退出后仍有原生转换进程")
        finally:
            if wrapper.poll() is None:
                wrapper.kill()
            wrapper.wait()
            if alive():
                os.kill(pid, 9)
            wrapper.stdout.close()
            wrapper.stderr.close()

    def test_real_ditto_is_in_engine_group_and_stops_with_that_group(self):
        binary = self.directory / "packaging-probe"
        subprocess.run(["xcrun", "swiftc", "-parse-as-library", "-D", "ENGINE_TESTS",
                        "-module-cache-path", str(self.cache), "-target", "arm64-apple-macosx13.0",
                        *map(str, self.sources), str(ROOT / "tests/PackagingProbe.swift"), "-o", str(binary)], check=True)
        probe = subprocess.Popen([str(binary), str(self.directory / "packaging-group")], start_new_session=True,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                 env={"PATH": "/usr/bin:/bin", "DEEPSEEK_API_KEY": KEY})
        child_pid = None
        try:
            self.assertEqual(probe.stdout.readline().strip(), "ready")
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline and probe.poll() is None:
                children = subprocess.run(["/usr/bin/pgrep", "-P", str(probe.pid)], capture_output=True, text=True).stdout.split()
                for value in children:
                    name = subprocess.run(["/bin/ps", "-o", "comm=", "-p", value], capture_output=True, text=True).stdout.strip()
                    if name.endswith("ditto"):
                        child_pid = int(value)
                        break
                if child_pid:
                    break
                time.sleep(0.02)
            self.assertIsNotNone(child_pid, "没有观察到真实 ditto 打包进程")
            self.assertEqual(os.getpgid(child_pid), probe.pid)
            os.killpg(probe.pid, signal.SIGTERM)
            probe.wait(timeout=3)
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline:
                try:
                    os.kill(child_pid, 0)
                except ProcessLookupError:
                    break
                time.sleep(0.03)
            else:
                self.fail("引擎组退出后 ditto 仍存活")
        finally:
            if probe.poll() is None:
                os.killpg(probe.pid, signal.SIGKILL)
            probe.wait()
            if child_pid:
                try:
                    os.kill(child_pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            probe.stdout.close()
            probe.stderr.close()


if __name__ == "__main__":
    unittest.main()
