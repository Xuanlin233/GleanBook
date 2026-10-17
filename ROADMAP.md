# 路线图与欢迎贡献的方向 / Roadmap and help wanted

下面每一项都可以单独做成一个 Pull Request。动手前请先开一个 Issue 说一声，避免重复劳动。
Each item below can be a pull request of its own. Please open an issue first so work is not duplicated.

所有改动都要遵守项目原则：数据只保存在用户自己的设备上；外部接口只读、带超时、失败时保留旧数据；金额用 `Decimal`。
Every change keeps the project principles: data stays on the user's own devices; external sources are read-only, time out, and keep old data on failure; money uses `Decimal`.

## 数据源 / Data sources

- **Binance 只读余额 / Binance read-only balances**：参照 `server/okx.ts` 的签名、错误码映射和只读权限检查。Follow the signing, error mapping and read-only check in `server/okx.ts`.
- **港股、美股行情 / HK and US stock prices**：需要一个免费、无需密钥、可长期使用的公开来源。Needs a free, keyless, long-lived public source.
- **其他国家的基金净值 / Fund NAVs outside China**：`server/funds.ts` 目前只支持 6 位代码的中国公募基金。`server/funds.ts` only handles 6-digit Chinese mutual funds today.
- **其他报告货币 / Reporting currencies other than CNY**：现在所有汇总都折算成人民币，这一项改动较大，请先讨论设计。All totals are in CNY today; this is a bigger change, so discuss the design first.

## 平台 / Platforms

- **在 macOS 和 Linux 真机上验证** `npm run start:private`（钥匙串 / `secret-tool`）和 `npm run autostart:on`，并报告结果。Try `npm run start:private` (Keychain / `secret-tool`) and `npm run autostart:on` on real macOS and Linux machines and report back.
- **Docker 部署说明 / Docker deployment guide**：`Dockerfile` 已存在，缺一份完整的使用说明与数据卷配置。The `Dockerfile` exists; a full guide with data volumes is missing.
- **Android 主屏幕安装说明 / Android home-screen guide**。

## 语言 / Languages

- **翻译文档 / Translate the docs**：`docs/` 下的文档目前只有中文。The documents in `docs/` are Chinese only.
- **后端和启动器提示的英文版 / English messages for the backend and launcher**：`server/` 和 `scripts/` 的提示还是中文。Messages in `server/` and `scripts/` are still Chinese.
- **新增界面语言 / New interface languages**：复制 `src/locales/en.ts` 翻译，并在 `src/i18n.ts` 注册，`npm run i18n:check` 会检查遗漏。Copy `src/locales/en.ts`, translate it, register it in `src/i18n.ts`; `npm run i18n:check` reports anything missing.

## 功能 / Features

- **按记录回算的历史净资产曲线 / Net-worth history rebuilt from records**：用账单与历史净值补出没有打开网站的日子，并与实际观测点区分显示（例如虚线）。Fill in days the site was not opened from entries and historical NAVs, drawn differently from observed points (e.g. dashed).
- **账本加密备份 / Encrypted backups**：导出时可选用口令加密 JSON 备份。Optional password-encrypted JSON backups.
- **前端分包 / Code splitting**：生产包约 600 KB，可按页面拆分以加快首次加载。The production bundle is about 600 KB; splitting by page would speed up the first load.
