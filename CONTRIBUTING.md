# 参与贡献

感谢你愿意让拾账 Gleanbook 变得更好。

## 开始之前

- 较大的改动请先开一个 Issue 讨论方向，避免白费功夫。不知道做什么，可以看 [ROADMAP.md](ROADMAP.md)。
- 提交的代码以 AGPL-3.0-or-later 授权，与本项目一致。

## 开发约定

- 金额一律使用 `Decimal`（`src/domain.ts` 中的 `D()`），不要用浮点数计算钱。
- 账本结构的任何变化都要经过 `validateLedger` 校验，并考虑旧账本与备份的兼容（新增字段用 `.optional()` 或 `.default()`）。
- 影响多设备同步的数据（新的记录类型或字段）需要在 `src/sync-core.ts` 中纳入记录级差异与合并。
- 外部接口：只读、带超时、失败时保留旧数据，不把上游错误原文、请求头或密钥写入日志或返回给前端。
- 界面文字在代码里写简体中文原文，并用 `tr()` 包起来，例如 `tr('{count} 笔', { count })`；同时在 `src/locales/en.ts` 加上英文。整句放进一个 `tr()`，不要把一句话拆成几段拼接，变化的部分用 `{名称}` 占位符。`npm run i18n:check` 会列出漏翻的文字。必须保持中文的固定值（例如数据里的分类键）在同一行或上一行写 `i18n-ignore` 注释。
- 视觉样式放在 `src/theme.css`，布局放在 `src/styles.css`。

## 提交前

```bash
npm run check
npm run i18n:check
npm test
npm run format
```

涉及界面的改动请运行 `npm run test:e2e`，并在手机宽度（375px）、深色模式和英文界面下检查。浏览器测试在 Windows 上使用本机 Chrome；macOS / Linux 先运行一次 `npx playwright install chromium`。

推送和发起合并请求后，GitHub Actions 会在 Windows、macOS、Linux 上自动运行以上检查。

## 绝对不要提交

`.env`、OKX 或任何 API 密钥、真实账本或主库文件（`GleanbookData/`）、个人截图。
