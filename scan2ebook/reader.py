"""本地网页阅读器服务。

用法：
    python -m scan2ebook serve [--port 8765] [--host 127.0.0.1]
    python -m scan2ebook.reader [--port 8765]        # 等价

启动后自动打开浏览器；若端口已被占用（阅读器可能已在运行），
直接打开已有实例而不报错。--no-browser 可关闭自动开浏览器。

阅读器功能：拖入 .s2e 电子书包导入书库；书库保存在浏览器 IndexedDB，
导入后原文件可删除。
"""
from __future__ import annotations

import argparse
import functools
import http.server
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path

WEB_DIR = Path(__file__).resolve().parent / "reader_web"
DEFAULT_PORT = 8765


def _probe(host: str, port: int, timeout: float = 0.5) -> bool:
    try:
        urllib.request.urlopen(f"http://{host}:{port}/", timeout=timeout)
        return True
    except Exception:  # noqa: BLE001
        return False


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="scan2ebook serve", description="scan2ebook 本地网页阅读器")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"监听端口（默认 {DEFAULT_PORT}）")
    ap.add_argument("--host", default="127.0.0.1", help="监听地址（默认 127.0.0.1）")
    ap.add_argument("--no-browser", action="store_true", help="不自动打开浏览器")
    args = ap.parse_args(argv)

    if not WEB_DIR.exists():
        print(f"找不到阅读器前端目录：{WEB_DIR}", file=sys.stderr)
        return 1

    url = f"http://{args.host}:{args.port}"
    if _probe(args.host, args.port):
        # 端口已被占用：大概率阅读器已在运行，直接打开浏览器
        print(f"检测到 {url} 已有服务（阅读器可能已在运行），直接打开浏览器…")
        if not args.no_browser:
            webbrowser.open(url)
        return 0

    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(WEB_DIR))
    try:
        server = http.server.ThreadingHTTPServer((args.host, args.port), handler)
    except OSError as e:
        print(f"端口 {args.port} 启动失败：{e}", file=sys.stderr)
        return 1

    print(f"📖 scan2ebook 阅读器：{url}  （Ctrl+C 退出）")
    if not args.no_browser:
        # 等服务就绪后再开浏览器，避免空白页
        for _ in range(20):
            if _probe(args.host, args.port, 0.3):
                break
            time.sleep(0.15)
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
