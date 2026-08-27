#!/usr/bin/env python3
"""审计 scan2ebook 的 wheel 和 sdist，防止发布包夹带本机或其他组件文件。"""
from __future__ import annotations

import argparse
import email
import sys
import tarfile
import zipfile
from pathlib import Path, PurePosixPath

PACKAGE_NAME = "scan2ebook"
PACKAGE_VERSION = "0.1.0"
FORBIDDEN_PARTS = {
    ".env",
    "dsh-plugin",
    "dsh-skill",
    "node_modules",
    "reader",
}
FORBIDDEN_SUFFIXES = {".pdf", ".s2e"}


def _fail(message: str) -> None:
    raise ValueError(message)


def _check_paths(paths: list[str], *, artifact: Path) -> None:
    for raw_path in paths:
        path = PurePosixPath(raw_path)
        if FORBIDDEN_PARTS.intersection(path.parts):
            _fail(f"{artifact.name} 包含禁止目录或文件：{raw_path}")
        if path.suffix.lower() in FORBIDDEN_SUFFIXES:
            _fail(f"{artifact.name} 包含不应发布的用户产物：{raw_path}")
        if "/Users/" in raw_path or raw_path.startswith("Users/"):
            _fail(f"{artifact.name} 包含本机绝对路径：{raw_path}")


def _check_metadata(metadata_bytes: bytes, *, artifact: Path) -> None:
    metadata = email.message_from_bytes(metadata_bytes)
    expected = {
        "Name": PACKAGE_NAME,
        "Version": PACKAGE_VERSION,
        "Requires-Python": ">=3.10",
        "License-Expression": "MIT",
    }
    for key, value in expected.items():
        if metadata.get(key) != value:
            _fail(
                f"{artifact.name} 元数据 {key} 为 {metadata.get(key)!r}，期望 {value!r}"
            )

    requirements = metadata.get_all("Requires-Dist", [])
    if not requirements or any(">=" not in requirement for requirement in requirements):
        _fail(f"{artifact.name} 运行时依赖缺少最低版本：{requirements!r}")
    if any("scan2ebook-reader" in requirement for requirement in requirements):
        _fail(f"{artifact.name} 错误地将 npm reader 声明为 Python 依赖")


def verify_wheel(path: Path) -> None:
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        _check_paths(names, artifact=path)

        required_suffixes = {
            "scan2ebook/__init__.py",
            ".dist-info/METADATA",
            ".dist-info/entry_points.txt",
        }
        for suffix in required_suffixes:
            if not any(name == suffix or name.endswith(suffix) for name in names):
                _fail(f"{path.name} 缺少必要文件：{suffix}")
        if not any(".dist-info/licenses/LICENSE" in name for name in names):
            _fail(f"{path.name} 缺少 MIT LICENSE")

        metadata_name = next(name for name in names if name.endswith(".dist-info/METADATA"))
        _check_metadata(archive.read(metadata_name), artifact=path)

        entry_name = next(name for name in names if name.endswith(".dist-info/entry_points.txt"))
        entry_points = archive.read(entry_name).decode("utf-8")
        if "scan2ebook = scan2ebook.cli:main" not in entry_points:
            _fail(f"{path.name} 缺少稳定的 scan2ebook CLI 入口")


def verify_sdist(path: Path) -> None:
    with tarfile.open(path, mode="r:gz") as archive:
        names = archive.getnames()
        _check_paths(names, artifact=path)
        if not any(name.endswith("/pyproject.toml") for name in names):
            _fail(f"{path.name} 缺少 pyproject.toml")
        if not any(name.endswith("/LICENSE") for name in names):
            _fail(f"{path.name} 缺少 MIT LICENSE")
        pkg_info = next((name for name in names if name.endswith("/PKG-INFO")), None)
        if pkg_info is None:
            _fail(f"{path.name} 缺少 PKG-INFO")
        member = archive.extractfile(pkg_info)
        if member is None:
            _fail(f"{path.name} 无法读取 PKG-INFO")
        _check_metadata(member.read(), artifact=path)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("artifact_dir", type=Path, help="python -m build 的输出目录")
    args = parser.parse_args(argv)

    wheels = sorted(args.artifact_dir.glob(f"{PACKAGE_NAME}-{PACKAGE_VERSION}-*.whl"))
    sdists = sorted(args.artifact_dir.glob(f"{PACKAGE_NAME}-{PACKAGE_VERSION}.tar.gz"))
    if len(wheels) != 1 or len(sdists) != 1:
        print(
            f"期望各有一个 wheel 和 sdist，实际 wheel={len(wheels)} sdist={len(sdists)}",
            file=sys.stderr,
        )
        return 1

    try:
        verify_wheel(wheels[0])
        verify_sdist(sdists[0])
    except (OSError, tarfile.TarError, ValueError, zipfile.BadZipFile) as error:
        print(f"发布包审计失败：{error}", file=sys.stderr)
        return 1

    print(f"发布包审计通过：{wheels[0].name}, {sdists[0].name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
