# GitHub 开源发布检查清单

## 发布阻断项

- [x] 选择并添加 MIT 开源许可证。
- [ ] 确认 Git 历史中从未提交 `.env`、API Key、真实书籍 PDF 或受版权保护的转换产物。
- [x] 为 Python 项目补充 `pyproject.toml`，声明包元数据、Python 版本、依赖和 CLI 入口。
- [ ] 将安装说明从本机绝对路径改为仓库相对路径或占位路径。
- [ ] 确认示例 PDF、截图、字体、图标和 SF Symbols 导出资源具有可再分发许可。
- [ ] 决定 DeepSeek 模型名称是否仍为公开可用模型；实验模型应允许用户覆盖并在文档中标注。

## 仓库结构

- [x] Python 转换器位于 `scan2ebook/`。
- [x] 网页阅读器位于 `frontend/`。
- [x] DSH 插件位于 `dsh-plugin/dsh-client-ui-scan2ebook/`。
- [x] 可发布 Skill 位于 `dsh-skill/scan2ebook/`。
- [ ] 增加根目录架构图和“CLI / Skill / 插件 / 阅读器”的关系说明。
- [ ] 增加最小可运行示例；只使用自制或明确可公开的数据。

## 密钥与隐私

- [x] `.env` 已在 `.gitignore` 中排除，仓库只提供 `.env.example`。
- [x] DSH sidebar 支持 macOS Keychain、仅本次输入、环境变量/`.env` 三种来源。
- [x] 钥匙串明文不返回浏览器，不写入 `localStorage`、日志或仓库。
- [ ] 发布前运行秘密扫描（例如 Gitleaks）并检查完整 Git 历史。
- [ ] 删除截图、测试日志和示例数据中的用户名、绝对路径、书名及其他个人信息。

## 可移植性与安装

- [x] DSH 插件默认从自身位置推导项目根目录，不再硬编码开发者路径。
- [x] README 明确说明 Apple Vision OCR 仅支持 macOS；其他系统需要替代 OCR backend。
- [x] 写明 Python、Node.js 与 DSH 版本要求；最低 macOS 版本仍需进一步实机确认。
- [ ] 提供从全新 clone 开始的安装验证步骤。
- [ ] 决定是否发布 PyPI 包、npm 包；若不发布，明确使用源码安装。
- [ ] 检查 `启动阅读器.command` 的可执行权限和相对路径行为。

## 质量保障

- [ ] GitHub Actions：Python 单元测试、Node 插件测试、前端测试与前端构建。
- [ ] 为 macOS 专有 OCR 增加可跳过或 mock 的 CI 测试边界。
- [ ] 增加一份小型、可公开、可重复的端到端 fixture。
- [ ] 测试空白 PDF、加密 PDF、损坏 PDF、页码越界、无 API Key、API 限流和中途取消。
- [ ] 明确费用只是估算，并记录重试、空白页跳过和模型计费变化的影响。

## 文档与社区

- [ ] README 增加截图/GIF，但先清除本机路径和真实书籍内容。
- [ ] 增加 `CONTRIBUTING.md`、Issue 模板和安全漏洞报告方式。
- [ ] 增加 `CHANGELOG.md` 或 GitHub Releases 约定。
- [ ] 说明 `.s2e` 格式版本、兼容策略和未来 schema 变更原则。
- [ ] 明确用户必须对输入 PDF 拥有合法处理权，项目不附带受版权保护的书籍。
