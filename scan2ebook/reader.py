"""独立网页阅读器的 Python 兼容启动器。

网页阅读器从 0.1.0 起由 npm 包 ``scan2ebook-reader`` 独立发布。这里保留
``scan2ebook serve`` 和 ``python -m scan2ebook.reader`` 两个入口，负责查找并
调用 reader CLI，避免 Python wheel 再携带一份前端静态资源。
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from collections.abc import Sequence

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
DEFAULT_READER_COMMAND = "scan2ebook-reader"
READER_COMMAND_ENV = "SCAN2EBOOK_READER_COMMAND"


class ReaderNotInstalledError(RuntimeError):
    """没有找到独立 reader CLI。"""


def reader_install_hint() -> str:
    """返回不包含本机路径的可执行安装提示。"""
    return (
        "未找到 scan2ebook-reader。网页阅读器需要单独安装：\n"
        "  npm install --global scan2ebook-reader\n"
        "安装后重新运行；也可以设置 SCAN2EBOOK_READER_COMMAND 指向其可执行文件。"
    )


def resolve_reader_command(command: str | None = None) -> str:
    """按显式参数、环境变量、PATH 的顺序寻找 reader 可执行文件。"""
    candidate = (command or os.getenv(READER_COMMAND_ENV) or DEFAULT_READER_COMMAND).strip()
    if not candidate:
        raise ReaderNotInstalledError(reader_install_hint())
    resolved = shutil.which(candidate)
    if resolved is None:
        raise ReaderNotInstalledError(reader_install_hint())
    return resolved


def reader_argv(
    *,
    host: str = DEFAULT_HOST,
    port: int = DEFAULT_PORT,
    open_browser: bool = True,
    command: str | None = None,
) -> list[str]:
    """生成不经过 shell 的 reader 命令参数。"""
    executable = resolve_reader_command(command)
    args = [executable, "--host", host, "--port", str(port)]
    if not open_browser:
        args.append("--no-open")
    return args


def start_reader_detached(
    *,
    host: str = DEFAULT_HOST,
    port: int = DEFAULT_PORT,
    open_browser: bool = True,
    command: str | None = None,
) -> subprocess.Popen[bytes]:
    """后台启动独立 reader，供转换完成后的 ``--serve`` 使用。"""
    return subprocess.Popen(
        reader_argv(host=host, port=port, open_browser=open_browser, command=command),
        start_new_session=True,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="scan2ebook serve",
        description="启动独立安装的 scan2ebook 网页阅读器",
    )
    ap.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"监听端口（默认 {DEFAULT_PORT}）")
    ap.add_argument("--host", default=DEFAULT_HOST, help=f"监听地址（默认 {DEFAULT_HOST}）")
    ap.add_argument("--no-browser", action="store_true", help="启动后不自动打开浏览器")
    ap.add_argument(
        "--reader-command",
        help=f"reader 可执行文件；默认读取 {READER_COMMAND_ENV} 或在 PATH 中查找 {DEFAULT_READER_COMMAND}",
    )
    args = ap.parse_args(argv)

    try:
        command = reader_argv(
            host=args.host,
            port=args.port,
            open_browser=not args.no_browser,
            command=args.reader_command,
        )
    except ReaderNotInstalledError as error:
        print(error, file=sys.stderr)
        return 1

    try:
        return subprocess.run(command, check=False).returncode
    except KeyboardInterrupt:
        return 130
    except OSError as error:
        print(f"无法启动 scan2ebook-reader：{error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
