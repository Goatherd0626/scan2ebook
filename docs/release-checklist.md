# GitHub 开源发布检查清单

## 发布阻断项

- [x] 选择并添加 MIT 开源许可证。
- [x] 确认 Git 历史中从未提交 `.env`、API Key、真实书籍 PDF 或受版权保护的转换产物。
      （2026-10-08 gitleaks 8.30.1 全历史扫描：99 个提交 / 2.71 MB，`no leaks found`；`.env`、`output/` 均在 `.gitignore` 且从未被跟踪）
- [x] 为 Python 项目补充 `pyproject.toml`，声明包元数据、Python 版本、依赖和 CLI 入口。
- [x] 将安装说明从本机绝对路径改为仓库相对路径或占位路径。
- [x] 确认示例 PDF、截图、字体、图标和 SF Symbols 导出资源具有可再分发许可。
      （已删除含真实书籍封面/正文/书名的 19 张验收截图；保留的面板预览图已用占位数据重绘；图标为自绘 SVG，无第三方字体/图标资源）
- [x] 决定 DeepSeek 模型名称是否仍为公开可用模型；实验模型应允许用户覆盖并在文档中标注。
      （默认 `deepseek-flash`；面板与 `defaultVisionModel` 配置均可覆盖，README 明确说明默认模型不保证长期可用）

## 仓库结构

- [x] Python 转换器位于 `scan2ebook/`。
- [x] 网页阅读器位于 `reader/`。
- [x] DSH 插件位于 `dsh-plugin/dsh-client-ui-scan2ebook/`。
- [x] 可发布 Skill 位于 `dsh-skill/scan2ebook/`。
- [x] 增加根目录架构图和“CLI / Skill / 插件 / 阅读器”的关系说明。
- [x] 增加最小可运行示例；只使用自制或明确可公开的数据。
      （`scripts/make_sample_book.py` 可再生成示例书；`sample/` 已列入 `.gitignore`，真实扫描书与转换产物都不进仓库）

## 密钥与隐私

- [x] 安装与运行不要求 `.env`；API Key 只由右栏面板或 CLI 用户在运行时提供。
- [x] DSH 右栏面板仅在其内存中保留 API Key，关闭面板或 DSH 后自动清除。
- [x] API Key 不写入钥匙串、`.env`、`localStorage`、日志或仓库。
- [x] 发布前运行秘密扫描（例如 Gitleaks）并检查完整 Git 历史。
      （本地 gitleaks 全历史 `no leaks found`；并已加入 CI `secrets` job 持续把关）
- [x] 删除截图、测试日志和示例数据中的用户名、绝对路径、书名及其他个人信息。
      （`reader-smoke.mjs` 改为 `S2E_SMOKE_BOOK` 环境变量且书名占位；`make_sample_book.py` 作者改为“示例作者”；`git grep /Users/goatherd` 无残留）

## 可移植性与安装

- [x] DSH 插件不再推导项目根目录；转换器使用 `PATH`/`scan2ebookCommand`，阅读器使用 npm 依赖。
- [x] README 明确说明 Apple Vision OCR 仅支持 macOS；其他系统需要替代 OCR backend。
- [x] 写明 Python、Node.js 与 DSH 版本要求；最低 macOS 版本仍需进一步实机确认。
- [x] 提供从全新 clone 开始的安装验证步骤。
- [x] `0.1.0` 明确说明源码安装；reader 与 DSH 插件均已具备独立 npm 打包结构。
- [x] Python wheel 不再包含或查找仓库 `reader/dist/`；`serve` 兼容入口调用独立 `scan2ebook-reader` CLI。
- [x] 本地构建 Python wheel/sdist，审计包内文件，并通过 `twine check` 与隔离安装冒烟测试。
- [ ] 确认 `scan2ebook` PyPI 包名可用性、发布账号与 2FA；未确认前不上传。
- [x] reader npm tarball 包含 `dist/`、CLI、Node API、README 和 MIT License，不包含源码、测试、`.env` 或电子书。
- [x] 已发布 `scan2ebook-reader@0.1.0`，并设置为 npm `latest`。
- [x] 已发布 `dsh-client-ui-scan2ebook@0.1.0`（旧版：依赖第三方 `dsh-better-sidebar`，仅适用于 DSH 0.1.x）。
- [x] **已发布 `dsh-client-ui-scan2ebook@0.2.0` 与 `0.2.1`**（0.2.0 改用 DSH Desktop 0.2 原生右栏;0.2.1 补面板合法使用脚注）。
      已校验：registry `dist.shasum` 与本地打包一致（`aa4fff23…`）、profile 锁定 integrity 与 registry 一致，按名安装实测装到 0.2.0。
- [x] **已把本地提交推送到 GitHub**（`4c5aee3` → `8f17749`，含 0.2 移植、路由修复、面板重做、AGENTS.md 与安装脚本）。
- [x] 插件在 DSH Desktop `0.2.0-rc.2` 实机验证：右侧栏出现 Scan2Ebook 入口，宿主工具可唤起面板。
- [x] DSH 插件 npm tarball 包含 host/client、patch、README 和 MIT License，不包含测试、`.env` 或仓库源码。
- [x] 用户安装文档不要求任何第三方侧栏插件：插件使用 DSH Desktop 0.2.x 自带的右侧栏（`--profile desktop`）。
- [x] reader 使用独立应用数据目录，不再按 origin/端口隔离书库，并支持旧 IndexedDB 合并迁移。
- [x] README 说明数据目录结构、跨端口共享、旧库迁移和备份风险。

## 质量保障

- [x] GitHub Actions：Python 单元测试、Node 插件测试、前端测试与前端构建。
      （`.github/workflows/ci.yml`：gitleaks / Python(macOS) / 阅读器(测试+构建+打包) / 插件(测试+打包)；首次运行在推送时触发）
- [x] 为 macOS 专有 OCR 增加可跳过或 mock 的 CI 测试边界。
      （Python job 直接跑在 `macos-latest`，视觉调用在测试里 mock；不依赖跳过逻辑）
- [ ] 增加一份小型、可公开、可重复的端到端 fixture。
- [ ] 测试空白 PDF、加密 PDF、损坏 PDF、页码越界、无 API Key、API 限流和中途取消。
- [x] 明确费用只是估算，并记录重试、空白页跳过和模型计费变化的影响。
      （面板估算行标注“空白页跳过、重试另计”；README「费用是否准确」说明以服务商最终账单为准）

## 文档与社区

- [x] README 增加截图/GIF，但先清除本机路径和真实书籍内容。
      （`docs/visual-check/plugin-panel-preview.png`：用示例书名与 `/Users/you/...` 占位路径重绘）
- [ ] 增加 `CONTRIBUTING.md`、Issue 模板和安全漏洞报告方式。
- [ ] 增加 `CHANGELOG.md` 或 GitHub Releases 约定。
- [ ] 说明 `.s2e` 格式版本、兼容策略和未来 schema 变更原则。
- [x] 明确用户必须对输入 PDF 拥有合法处理权，项目不附带受版权保护的书籍。
      （README 新增「合法使用与版权」章节；插件 README 与 Skill 同步；`sample/` 与 `output/` 均在 `.gitignore`，仓库不含真实书籍）
