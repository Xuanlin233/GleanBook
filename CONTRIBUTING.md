# 参与贡献

感谢你愿意让拾账 Gleanbook 变得更好。

## 开始之前

- 较大的改动请先开一个 Issue 讨论方向，避免白费功夫。
- 提交的代码以 AGPL-3.0-or-later 授权，与本项目一致。

## 开发约定

- 金额一律使用 `Decimal`（`src/domain.ts` 中的 `D()`），不要用浮点数计算钱。
- 账本结构的任何变化都要经过 `validateLedger` 校验，并考虑旧账本与备份的兼容（新增字段用 `.optional()` 或 `.default()`）。
- 影响多设备同步的数据（新的记录类型或字段）需要在 `src/sync-core.ts` 中纳入记录级差异与合并。
- 外部接口：只读、带超时、失败时保留旧数据，不把上游错误原文、请求头或密钥写入日志或返回给前端。
- 界面文字为简体中文；视觉样式放在 `src/theme.css`，布局放在 `src/styles.css`。

## 提交前

```powershell
npm run check
npm test
npm run format
```

涉及界面的改动请运行 `npm run test:e2e`，并在手机宽度（375px）和深色模式下检查。

## 绝对不要提交

`.env`、OKX 或任何 API 密钥、真实账本或主库文件（`GleanbookData/`）、个人截图。
