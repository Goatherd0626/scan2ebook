#!/bin/bash
# scan2ebook 阅读器启动器 —— macOS Finder 双击即可打开
# 首次运行若提示「无法打开」，请右键 → 打开，或在终端执行：chmod +x 启动阅读器.command
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  echo "未找到 .venv，请先执行：python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"
  read -r -p "按回车退出…"
  exit 1
fi
exec .venv/bin/python -m scan2ebook serve
