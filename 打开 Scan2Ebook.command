#!/bin/zsh
set -e
project_dir=${0:A:h}
cd "$project_dir"

if ! command -v node >/dev/null 2>&1; then
  print "这台电脑还没有 Node.js，请先完成项目安装。"
  read -k 1 "?按任意键关闭。"
  exit 1
fi
if [[ ! -f reader/dist/index.html ]]; then
  print "网页尚未构建，请先在 reader 文件夹运行 npm run build。"
  read -k 1 "?按任意键关闭。"
  exit 1
fi
exec node reader/bin/scan2ebook-reader.js
