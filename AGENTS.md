# Scan2Ebook — 给 AI 助手的安装与验证说明

> 这个文件是**给 AI 助手看的**,不是给人看的。用户(通常是文科生,不熟悉终端)会把仓库链接发给你,
> 请你按本文件把 Scan2Ebook 装好,然后用**非技术语言**告诉用户接下来怎么用。
>
> 人类可读的说明在 [`README.md`](./README.md)。

## 你要完成的目标

在这台 macOS 上装好三件事:

1. **转换器**(Python CLI `scan2ebook`)——把扫描版 PDF 转成结构化电子书;
2. **DSH 插件**(`dsh-client-ui-scan2ebook`)——在 DeepSeek Harness 的**右侧栏**提供图形面板;
3. **(可选)Skill**——让 DSH 在用户表达"把这本书转成电子书"时主动唤起面板。

装完后用户只需要:重启 DSH → 打开右侧栏 → 选 Scan2Ebook → 选 PDF → 填自己的 API Key → 开始转换。

## 硬性约束(必须遵守)

- **不要向用户索要、读取、保存或回显任何 API Key**;不要创建 `.env`;
  API Key 只能由用户之后在 DSH 面板里自己输入。
- **不要运行真实转换**,不要调用付费模型 API(安装验证不需要转换任何书)。
- 需要安装软件、修改 `PATH`、写入用户目录之外时,**先征求用户确认**。
- 不要修改或删除用户已有的阅读器书库数据(`~/Library/Application Support/Scan2Ebook Reader/`)。
- 完成后用中文、非技术语言汇报**结果**和**下一步**,不要堆命令输出。

## 步骤

### 0. 环境检查(只读)

```bash
sw_vers -productVersion                      # macOS 版本
node -v                                      # 需要 >= 20.19
python3 -V
command -v pipx || echo "缺少 pipx"
ls -d "/Applications/DeepSeek Harness.app"   # DSH Desktop 是否存在
```

要求:macOS;Node.js ≥ 20.19;DSH **Desktop** `0.2.0-rc.2` 或更高。
若缺少 Node/pipx/DSH,先告诉用户需要装什么并征求同意。

### 1. 安装转换器

```bash
pipx install git+https://github.com/Goatherd0626/scan2ebook.git
# 已装过则升级:
# pipx upgrade scan2ebook
scan2ebook --help
```

若 `scan2ebook` 命令仍找不到,执行 `pipx ensurepath` 并提示用户重开终端。

### 2. 安装 DSH 插件到 desktop profile

DSH 自带 CLI 的绝对路径(桌面版)是:

```bash
DSH="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"
```

优先按名字安装,**必须带上显式版本范围 `@^0.2.0`**:

```bash
"$DSH" plugin --profile desktop add "dsh-client-ui-scan2ebook@^0.2.0"
```

为什么要显式指定:npm 上存在旧的 `0.1.0`(依赖第三方 `dsh-better-sidebar`,在 DSH Desktop 0.2 上不可用)。
只写包名时 pnpm 可能写入 `^0.1.0`,而 `0.x` 的 caret **锁小版本**,之后永远升不到 0.2.0;
pnpm 的元数据缓存过期时甚至可能直接解析到 0.1.0。

**然后必须验证版本**:`~/.dsh/profiles/desktop/node_modules/dsh-client-ui-scan2ebook/package.json` 里
`version` 必须 ≥ `0.2.0`,且 `lib/client.js` 含 `sidebarRightTabs`。任何一条不满足,就按下面的仓库路径安装:

```bash
git clone --depth 1 https://github.com/Goatherd0626/scan2ebook.git /tmp/scan2ebook-install
"$DSH" plugin --profile desktop add "file:/tmp/scan2ebook-install/dsh-plugin/dsh-client-ui-scan2ebook"
```

验证(两条都要成立):

```bash
grep '"version"' ~/.dsh/profiles/desktop/node_modules/dsh-client-ui-scan2ebook/package.json   # 期望 0.2.0 或更高
grep -c "sidebarRightTabs" ~/.dsh/profiles/desktop/node_modules/dsh-client-ui-scan2ebook/lib/client.js   # 期望 >= 1
```

说明:
- 插件会自动带上 `scan2ebook-reader`(网页阅读器),**不需要**单独安装;
- 插件只使用 DSH 自带的右侧栏,**不需要**安装 `dsh-better-sidebar` 之类的第三方侧栏插件;
- 若 DSH CLI 提示 `profile "desktop" is managed exclusively by the Electron application`,这是正常的:
  它只影响 `--dump-config`,不影响 `plugin add`。

### 2.1 升级到新版(重要)

DSH 插件 CLI 的 `add` 在 lockfile 已经满足版本范围时**不会升级**(pnpm 的 `prefer-frozen-lockfile`),
`update` 也可能不动。要升级,必须给一个**旧版本不满足**的范围:

```bash
"$DSH" plugin --profile desktop add "dsh-client-ui-scan2ebook@^0.2.1"
```

或直接在 profile 目录用 pnpm(效果相同):

```bash
cd ~/.dsh/profiles/desktop
ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \
  --expose-internals "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/pnpm/bin/pnpm.mjs" \
  add "dsh-client-ui-scan2ebook@^0.2.1"
```

升级后同样要**完全重启 DSH**。若 pnpm 元数据缓存过期(表现为装到旧版),删除
`~/Library/Caches/pnpm/v11/metadata/registry.npmjs.org/dsh-client-ui-scan2ebook.jsonl` 后重试。

### 3.(可选)安装 Skill

```bash
mkdir -p ~/.dsh/skills/scan2ebook
curl --fail --location \
  https://raw.githubusercontent.com/Goatherd0626/scan2ebook/main/dsh-skill/scan2ebook/SKILL.md \
  --output ~/.dsh/skills/scan2ebook/SKILL.md
```

### 4. 收尾

**完全退出并重新启动 DSH**(macOS 上 `⌘Q` 退出,不是只关窗口)。插件代码只有重启后才会加载。

## 完成后,用这段话告诉用户(照抄,把方括号替换成实际结果)

> Scan2Ebook 已经装好了(转换器 [版本],DSH 插件 [版本])。
>
> 接下来这样用:
> 1. 完全退出 DSH(⌘Q)再重新打开;
> 2. 打开会话**右侧栏**,在添加菜单 / 引导页里选 **Scan2Ebook**;
> 3. 点「选择 PDF」挑一本扫描版 PDF,确认起始页和结束页;
> 4. 在「API Key」里填入你自己的 DeepSeek API Key(只在你当前这次使用中保留,关掉面板就清除);
> 5. 点「开始转换」,看进度条;完成后结果就写在原 PDF 同一个文件夹里;
> 6. 想读书时,在同一面板最下面点「启动阅读器」,再点出现的地址即可在浏览器里打开。
>
> 如果右侧栏里没有 Scan2Ebook,说明 DSH 没有重启成功——请再完整退出一次再打开。

## 常见问题

| 现象 | 处理 |
|---|---|
| 找不到 `dsh` 命令 | 用本文档里的绝对路径 `"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"` |
| 右侧栏没有 Scan2Ebook | 完全退出并重启 DSH;再确认 `~/.dsh/profiles/desktop/package.json` 的 `dsh.profile.bundles` 里有 `dsh-client-ui-scan2ebook` |
| 面板显示"无法连接 DSH 宿主" | 插件宿主半没加载:确认插件已安装,然后完全重启 DSH;若仍报错,把面板里的报错文本发回给用户转交开发者 |
| 按名字安装拿到旧版 0.1.0 | 用 `dsh plugin --profile desktop add "dsh-client-ui-scan2ebook@^0.2.0"`;profile 里若已写死 `^0.1.0`,该命令会把它替换掉。仍不行则用第 2 步的仓库路径安装 |
| 之前装过 `^0.1.0`,升级不到 0.2 | `^0.1.0` 不会自动升级(`0.x` caret 锁小版本),必须显式 `@^0.2.0` 重装 |
| 已装 0.2.0,`add @^0.2.0` 升不到 0.2.1 | lockfile 已满足该范围,add 不会重新解析;用**旧版不满足**的范围 `@^0.2.1`(见 2.1 节) |
| 用户问费用 | 面板显示的是估算值;重试次数、空白页跳过和模型定价变化都会影响实际账单,以服务商账单为准 |
| 用户问 API Key 安全 | Key 只在该面板内存里保留,关闭面板或 DSH 即清除,不写 `.env`/钥匙串/浏览器存储/日志 |
