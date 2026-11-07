"""构建系统 WebKit + Rust + Swift 的 macOS 应用，不安装系统依赖。"""
from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import subprocess
from pathlib import Path

DESKTOP = Path(__file__).resolve().parents[1]
ROOT = DESKTOP.parent
TAURI = DESKTOP / "src-tauri"
BUILD = ROOT / "build"
RESOURCES = TAURI / "resources"


def run(*command: str | Path, cwd: Path = ROOT, env: dict | None = None) -> None:
    subprocess.run([str(item) for item in command], cwd=cwd, env=env, check=True)


def toolchain_environment() -> dict[str, str]:
    env = os.environ.copy()
    local_cargo = BUILD / "toolchain" / "cargo"
    local_rustup = BUILD / "toolchain" / "rustup"
    if (local_cargo / "bin" / "cargo").exists():
        env["CARGO_HOME"] = str(local_cargo)
        env["RUSTUP_HOME"] = str(local_rustup)
        env["PATH"] = str(local_cargo / "bin") + os.pathsep + env.get("PATH", "")
    if not shutil.which("cargo", path=env.get("PATH")):
        raise SystemExit("缺少 Rust。请先安装 Rust 工具链，再重新构建。")
    env.setdefault("CARGO_TARGET_DIR", str(BUILD / "desktop-target"))
    env.setdefault("MACOSX_DEPLOYMENT_TARGET", "14.4")
    env.setdefault("CI", "true")
    return env


def prepare() -> None:
    if platform.system() != "Darwin":
        raise SystemExit("此构建需要 macOS 与 Xcode。")
    architecture = {"arm64": "arm64", "x86_64": "x86_64"}.get(platform.machine())
    if not architecture:
        raise SystemExit("尚不支持当前处理器架构。")
    run("npm", "run", "build", cwd=ROOT / "reader")
    RESOURCES.mkdir(parents=True, exist_ok=True)
    if (RESOURCES / "frontend").exists():
        shutil.rmtree(RESOURCES / "frontend")
    shutil.copytree(ROOT / "reader" / "dist", RESOURCES / "frontend")
    for source in [ROOT / "LICENSE", ROOT / "reader" / "THIRD_PARTY_NOTICES.md"]:
        shutil.copy2(source, RESOURCES / source.name)
    sources = sorted((DESKTOP / "engine").glob("*.swift"))
    if not sources:
        raise SystemExit("尚未找到 Swift 转换引擎源码。")
    run("xcrun", "swiftc", "-parse-as-library", "-O", "-whole-module-optimization", "-target", f"{architecture}-apple-macosx14.4",
        "-module-cache-path", BUILD / "swift-module-cache", *sources, "-o", RESOURCES / "scan2ebook-engine")
    run(RESOURCES / "scan2ebook-engine", "--self-check")
    run("/usr/bin/codesign", "--force", "--sign", "-", RESOURCES / "scan2ebook-engine")
    icons = BUILD / "desktop-icons"
    run("xcrun", "swift", "-module-cache-path", BUILD / "swift-module-cache", DESKTOP / "scripts" / "make-icon.swift",
        icons, ROOT / "reader" / "src" / "assets" / "brand" / "app-icon-1024.png")
    iconset = icons / "Scan2Ebook.iconset"
    iconset.mkdir(parents=True, exist_ok=True)
    for size in [16, 32, 128, 256, 512]:
        shutil.copy2(icons / f"{size}.png", iconset / f"icon_{size}x{size}.png")
        shutil.copy2(icons / f"{size * 2}.png", iconset / f"icon_{size}x{size}@2x.png")
    destination = TAURI / "icons"
    destination.mkdir(exist_ok=True)
    run("/usr/bin/iconutil", "-c", "icns", iconset, "-o", destination / "icon.icns")
    for name, size in [("32x32.png", 32), ("128x128.png", 128), ("128x128@2x.png", 256)]:
        shutil.copy2(icons / f"{size}.png", destination / name)


def publish(env: dict[str, str], *, app_only: bool = False) -> Path:
    bundle = Path(env["CARGO_TARGET_DIR"]) / "release" / "bundle"
    destination = ROOT / "dist" / "macos"
    destination.mkdir(parents=True, exist_ok=True)
    application = destination / "Scan2Ebook.app"
    if application.exists():
        shutil.rmtree(application)
    shutil.copytree(bundle / "macos" / "Scan2Ebook.app", application, symlinks=True)
    run("/usr/bin/codesign", "--verify", "--deep", "--strict", application)
    if not app_only:
        version = json.loads((TAURI / "tauri.conf.json").read_text())["version"]
        packages = list((bundle / "dmg").glob(f"Scan2Ebook_{version}_*.dmg"))
        if not packages:
            raise SystemExit("尚未生成安装包。")
        for package in packages:
            shutil.copy2(package, destination / package.name)
    return destination


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("--app-only", action="store_true", help="只构建 .app，跳过磁盘映像")
    arguments = parser.parse_args()
    env = toolchain_environment()
    prepare()
    if arguments.prepare_only:
        return
    command = ["npm", "run", "tauri", "--", "build"]
    if arguments.app_only:
        command += ["--bundles", "app"]
    run(*command, cwd=DESKTOP, env=env)
    print(f"交付位置：{publish(env, app_only=arguments.app_only)}")


if __name__ == "__main__":
    main()
