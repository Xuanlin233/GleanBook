## 改了什么 / What changed

<!-- 一两句话说明改动和原因；关联的 Issue 写 Closes #编号 -->

## 怎么验证的 / How it was tested

- [ ] `npm run check`
- [ ] `npm test`
- [ ] 涉及界面：`npm run test:e2e`，并在 375px 手机宽度和深色模式下看过 / UI changes: e2e, checked at 375px and in dark mode
- [ ] 改了账本结构：旧账本和 JSON 备份仍能导入，多设备同步已考虑 / Ledger schema changes keep old ledgers and backups importable and are covered by sync

## 安全检查 / Safety

- [ ] 没有提交 `.env`、密钥、真实账本或个人截图 / No `.env`, keys, real ledger data or personal screenshots
- [ ] 金额计算使用 `Decimal` / Money is calculated with `Decimal`
