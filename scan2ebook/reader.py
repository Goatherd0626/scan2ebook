"""本地网页阅读器服务。

用法：
    python -m scan2ebook serve [--port 8765] [--host 127.0.0.1]
    python -m scan2ebook.reader [--port 8765]        # 等价

服务 reader/dist/（已构建）。源码依赖 Vite 打包和模块解析，
因此未构建时不能直接作为普通静态文件服务。
前端是独立 Vite 项目（reader/），开发用 `cd reader && npm run dev`。

启动后自动打开浏览器；若端口已被占用（阅读器可能已在运行），
直接打开已有实例而不报错。--no-browser 可关闭自动开浏览器。
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

ROOT = Path(__file__).resolve().parent.parent
READER = ROOT / "reader"
DEFAULT_PORT = 8765


def _web_dir() -> Path:
    dist = READER / "dist"
    if dist.exists() and (dist / "index.html").exists():
        return dist
    # 源码中包含 Vite 的 bare imports，SimpleHTTPRequestHandler 无法直接提供可用阅读器。
    raise FileNotFoundError(f"未找到已构建的阅读器 {dist}，请先运行：cd reader && npm ci && npm run build")


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

    try:
        web_dir = _web_dir()
    except FileNotFoundError as e:
        print(e, file=sys.stderr)
        return 1

    url = f"http://{args.host}:{args.port}"
    if _probe(args.host, args.port):
        print(f"检测到 {url} 已有服务（阅读器可能已在运行），直接打开浏览器…")
        if not args.no_browser:
            webbrowser.open(url)
        return 0

    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(web_dir))
    try:
        server = http.server.ThreadingHTTPServer((args.host, args.port), handler)
    except OSError as e:
        print(f"端口 {args.port} 启动失败：{e}", file=sys.stderr)
        return 1

    print(f"📖 scan2ebook 阅读器：{url}  （Ctrl+C 退出）")
    if not args.no_browser:
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
