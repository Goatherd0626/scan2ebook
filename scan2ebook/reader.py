"""本地网页阅读器服务。

用法：
    python -m scan2ebook.reader [--port 8765] [--host 127.0.0.1]

启动后在浏览器打开 http://127.0.0.1:<port> 使用阅读器：
- 拖入 .s2e 电子书包（或点右上角 ⬆ 选择文件）
- 书库保存在浏览器 IndexedDB 中，导入后原文件可删除
"""
from __future__ import annotations

import argparse
import functools
import http.server
import sys
from pathlib import Path

WEB_DIR = Path(__file__).resolve().parent / "reader_web"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="scan2ebook.reader", description="scan2ebook 本地网页阅读器")
    ap.add_argument("--port", type=int, default=8765, help="监听端口（默认 8765）")
    ap.add_argument("--host", default="127.0.0.1", help="监听地址（默认 127.0.0.1）")
    args = ap.parse_args(argv)

    if not WEB_DIR.exists():
        print(f"找不到阅读器前端目录：{WEB_DIR}", file=sys.stderr)
        return 1

    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(WEB_DIR))
    try:
        server = http.server.ThreadingHTTPServer((args.host, args.port), handler)
    except OSError as e:
        print(f"端口 {args.port} 启动失败：{e}", file=sys.stderr)
        return 1
    print(f"📖 scan2ebook 阅读器：http://{args.host}:{args.port}  （Ctrl+C 退出）")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
