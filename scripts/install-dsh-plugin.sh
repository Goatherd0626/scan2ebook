#!/usr/bin/env bash
# Scan2Ebook 一键安装:Python 转换器 + DSH Desktop 右侧栏插件 + (可选)Skill
#
# 设计给 AI 助手执行,也可以由懂终端的用户自己跑。特点:
#   - 幂等:重复执行安全
#   - 不接触 API Key、不运行真实转换、不动阅读器书库数据
#   - 插件优先用 npm 包;若 npm 上是旧版或安装失败,自动回退到仓库路径安装
#
# 用法:
#   bash scripts/install-dsh-plugin.sh                 # 完整安装(含 Skill)
#   bash scripts/install-dsh-plugin.sh --no-skill      # 不装 Skill
#   bash scripts/install-dsh-plugin.sh --dry-run       # 只打印将执行的操作
set -euo pipefail

REPO_URL="https://github.com/Goatherd0626/scan2ebook.git"
REPO_RAW="https://raw.githubusercontent.com/Goatherd0626/scan2ebook/main"
PLUGIN_PKG="dsh-client-ui-scan2ebook"
MIN_DSH_PLUGIN="0.2.0"
MIN_NODE="20.19"
PROFILE="desktop"
DSH_BIN_DEFAULT="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"
SKILL_DIR="${HOME}/.dsh/skills/scan2ebook"
PROFILE_DIR="${HOME}/.dsh/profiles"

WITH_SKILL=1
DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --no-skill) WITH_SKILL=0 ;;
    --dry-run) DRY_RUN=1 ;;
    --profile) shift; [ $# -gt 0 ] && PROFILE="$1" ;;
    --profile=*) PROFILE="${1#*=}" ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "未知参数: $1"; exit 2 ;;
  esac
  shift
done

step() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
ok()   { printf '  ✅ %s\n' "$*"; }
warn() { printf '  ⚠️  %s\n' "$*"; }
die()  { printf '\n❌ %s\n' "$*" >&2; exit 1; }
run()  { if [ "$DRY_RUN" = "1" ]; then printf '  [dry-run] %s\n' "$*"; else "$@"; fi; }

ver_ge() { # ver_ge <have> <need>
  node -e 'const p=s=>String(s).split("-")[0].split(".").map(Number);const [a,b]=process.argv.slice(1).map(p);for(let i=0;i<3;i++){const x=a[i]||0,y=b[i]||0;if(x!==y)process.exit(x>y?0:1)}process.exit(0)' "$1" "$2"
}

[ "$(uname -s)" = "Darwin" ] || die "Scan2Ebook 的 OCR 依赖 macOS(Apple Vision),当前系统不是 macOS。"

step "检查环境"
NODE_VERSION="$(node -v 2>/dev/null | sed 's/^v//' || true)"
[ -n "$NODE_VERSION" ] || die "未找到 Node.js。请先安装 Node.js ${MIN_NODE} 或更高版本(推荐 brew install node)。"
ver_ge "$NODE_VERSION" "$MIN_NODE" || die "Node.js 版本过低:$NODE_VERSION,需要 ≥ ${MIN_NODE}。"
ok "Node.js v${NODE_VERSION}"

DSH_BIN=""
if [ -x "$DSH_BIN_DEFAULT" ]; then DSH_BIN="$DSH_BIN_DEFAULT"
elif command -v dsh >/dev/null 2>&1; then DSH_BIN="$(command -v dsh)"
else die "找不到 DSH CLI。确认已安装 DeepSeek Harness Desktop(预期路径:$DSH_BIN_DEFAULT)。"; fi
ok "DSH CLI: $DSH_BIN"

step "安装 / 升级 Python 转换器"
if command -v scan2ebook >/dev/null 2>&1; then
  if scan2ebook --help >/dev/null 2>&1; then ok "已安装 scan2ebook(可正常执行)"; else warn "scan2ebook 存在但无法执行,建议重新安装"; fi
  if command -v pipx >/dev/null 2>&1; then run pipx upgrade scan2ebook >/dev/null 2>&1 || warn "pipx upgrade 失败,继续使用现有版本"; fi
elif command -v pipx >/dev/null 2>&1; then
  run pipx install "$REPO_URL"
  command -v scan2ebook >/dev/null 2>&1 && ok "已安装 scan2ebook" || warn "安装完成但 scan2ebook 不在 PATH:请执行 pipx ensurepath 并重开终端"
else
  warn "缺少 pipx。请先运行:brew install pipx && pipx ensurepath,然后重新执行本脚本安装转换器"
fi

step "安装 DSH 插件(${PLUGIN_PKG})到 ${PROFILE} profile"
PLUGIN_DIR="${PROFILE_DIR}/${PROFILE}/node_modules/${PLUGIN_PKG}"
installed_ok() {
  [ -f "${PLUGIN_DIR}/package.json" ] || return 1
  local v
  v="$(node -e "process.stdout.write(require('${PLUGIN_DIR}/package.json').version)" 2>/dev/null || echo 0)"
  ver_ge "$v" "$MIN_DSH_PLUGIN" || { warn "已安装版本 ${v} 过旧(需要 ≥ ${MIN_DSH_PLUGIN}),将改用仓库路径安装"; return 1; }
  grep -q "sidebarRightTabs" "${PLUGIN_DIR}/lib/client.js" 2>/dev/null || { warn "已安装版本不是 DSH Desktop 原生右栏版本,将改用仓库路径安装"; return 1; }
  ok "已安装 ${PLUGIN_PKG}@${v}(原生右栏版本)"
}

if installed_ok; then
  :
else
  # 注意:必须带显式版本范围。只写包名时 pnpm 可能写入 ^0.1.0(旧版存在),
  # 而 0.x 的 caret 锁小版本,后续永远升不到 0.2.0。
  if run "$DSH_BIN" plugin --profile "$PROFILE" add "${PLUGIN_PKG}@^${MIN_DSH_PLUGIN}" >/dev/null 2>&1 && installed_ok; then
    :
  elif run "$DSH_BIN" plugin --profile "$PROFILE" add "$PLUGIN_PKG" >/dev/null 2>&1 && installed_ok; then
    :
  else
    warn "npm 安装不可用或版本过旧,改用仓库路径安装"
    SRC_DIR="${HOME}/.dsh/scan2ebook-plugin-src"
    [ -d "$SRC_DIR/.git" ] && run git -C "$SRC_DIR" pull --ff-only --depth 1 || run git clone --depth 1 "$REPO_URL" "$SRC_DIR"
    run "$DSH_BIN" plugin --profile "$PROFILE" add "file:${SRC_DIR}/dsh-plugin/${PLUGIN_PKG}"
    installed_ok || die "插件安装失败。请把上面的输出发给开发者。"
  fi
fi

if [ "$WITH_SKILL" = "1" ]; then
  step "安装 DSH Skill(可选)"
  run mkdir -p "$SKILL_DIR"
  if [ "$DRY_RUN" = "1" ]; then
    echo "  [dry-run] 下载 SKILL.md → ${SKILL_DIR}/SKILL.md"
  elif curl --fail --silent --location "${REPO_RAW}/dsh-skill/scan2ebook/SKILL.md" --output "${SKILL_DIR}/SKILL.md"; then
    ok "Skill 已安装:${SKILL_DIR}/SKILL.md"
  else
    warn "Skill 下载失败,不影响插件使用"
  fi
fi

step "完成"
cat <<'DONE'
  接下来请用户这样做:
    1. 完全退出 DSH(macOS 用 ⌘Q,不是只关窗口),再重新打开;
    2. 打开会话右侧栏,在添加菜单 / 引导页里选择 Scan2Ebook;
    3. 点「选择 PDF」→ 确认起止页 → 填入自己的 DeepSeek API Key → 点「开始转换」;
    4. 想读书时,在同一面板下方点「启动阅读器」,再点出现的地址在浏览器中打开。

  说明:API Key 只在该面板内存中保留,关闭面板或 DSH 即清除;本脚本不接触任何 API Key。
  插件的自动更新:重复执行本脚本即可(改了插件代码后会重新安装)。
DONE
