# Gleanbook (拾账)

[![CI](https://github.com/Xuanlin233/gleanbook/actions/workflows/ci.yml/badge.svg)](https://github.com/Xuanlin233/gleanbook/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)

[简体中文](README.md) | English

**A private, offline-first personal finance and portfolio tracker.** Your ledger lives on your own computer, with no cloud service involved. The desktop browser and the iPhone home-screen app show the same ledger; you can record entries offline, and changes merge automatically once you are back online.

> Nothing here is investment advice. Fund NAVs, prices and exchange rates come from public sources with no guarantee of accuracy, timeliness or availability; rely on official data from fund companies, exchanges and banks.

<p>
  <img src="docs/screenshots/desktop-light.png" alt="Desktop overview, light theme, demo data" width="68%" />
  <img src="docs/screenshots/mobile-dark.png" alt="Mobile assets, dark theme, demo data" width="25%" />
</p>

_Screenshots show the made-up data of the built-in demo ledger._

## Features

- **Everyday bookkeeping**: income, expenses, transfers and refunds across CNY / USD / HKD / EUR / USDT / USDC accounts. Cross-currency transfers show the actual rate and the premium, which you can record as a fee. Monthly and per-category budgets.
- **Investments**: official NAVs for any 6-digit Chinese mutual fund (fund company → Eastmoney → Sina, free, no key); OKX spot prices; read-only OKX API import of funding, trading and Simple Earn balances, reviewed by you before import; moving weighted-average cost with realized and unrealized gains.
- **Automatic exchange rates**: USD, EUR and HKD use the CNY central parity; USDT and USDC use actual OKX prices instead of assuming 1 USD. Rates you enter manually take priority.
- **Recurring buys**: from an account or another holding; fixed amount or fixed quantity; daily, weekdays, weekly, biweekly or monthly, to the minute. Funds fill at the official NAV of the trading day (15:00 cutoff), crypto at the price of that exact minute. Optional "skip holidays" following China's official holiday calendar.
- **Subscriptions**: monthly, yearly or weekly charges recorded automatically on the billing day, with a monthly total and upcoming-charge reminders.
- **Overview**: net worth, monthly income and spending, asset allocation, and a net-worth trend (today intraday / 7 / 30 / 90 days / custom range).
- **Multi-device sync**: a master ledger on your PC plus an offline copy on each device, merged record by record (later change wins, deletion wins over edits, invalid changes are rejected with a reason). The master is backed up daily.
- **PWA**: add it to the iPhone home screen and use it offline; light and dark themes.
- **Privacy**: no ads, analytics or third-party fonts. OKX keys must be read-only and are stored encrypted in the operating system's own secret store (Windows DPAPI, macOS Keychain, Linux Secret Service).
- **Chinese and English interface**, chosen from your browser language and switchable under Settings → Preferences & privacy.

Gleanbook was built for someone living in China: CNY is the reporting currency, and the fund, holiday and exchange-rate sources are Chinese. Everything else works anywhere, and other markets are welcome as contributions (see [ROADMAP.md](ROADMAP.md)).

## Try it in a minute

No keys or accounts needed. With [Node.js 24](https://nodejs.org/) or later:

```bash
git clone https://github.com/Xuanlin233/gleanbook.git
cd gleanbook
npm ci
npm run build
npm start
```

Open <http://localhost:8787/?demo> to land in the **demo ledger** (made-up data) and click around every page. The demo ledger is completely separate from your real one; drop `?demo` or click "Back to my real ledger" to start your own.

Runs on Windows, macOS and Linux. `npm start` covers bookkeeping, fund NAVs, prices, recurring buys and subscriptions; only OKX holdings and multi-device sync need `start:private` below.

### OKX read-only holdings and multi-device sync

```bash
npm run start:private
```

On first run, enter an OKX API key, secret and passphrase with **Read permission only**, plus an access password of your choice for the website (at least 32 characters). Once verified, they are stored encrypted in the system secret store (Windows DPAPI, macOS Keychain; Linux needs `secret-tool`, from `libsecret-tools` or `libsecret`) and never asked for again. `npm run forget:okx` removes them.

- Accounts outside OKX's global site: set `OKX_API_ORIGIN` in `.env` (US / Australia `https://us.okx.com`, EEA `https://eea.okx.com`).
- The backend cannot reach OKX (common on networks that need a proxy): run `npm run diagnose:okx` and set `OKX_PROXY` in `.env` as suggested. `npm run diagnose:okx:private` tests each signed endpoint with your saved keys and prints only status and timing.

Start at sign-in: run `npm run start:private` once to save the credentials, then `npm run autostart:on` (Windows Startup folder / macOS LaunchAgent / Linux systemd user service). `npm run autostart:off` turns it off.

### On your iPhone

Reach your PC over HTTPS through the free [Tailscale](https://tailscale.com/), then use Safari's "Add to Home Screen" to get an offline app that syncs with the PC. Step-by-step instructions (in Chinese) are in [docs/IPHONE.md](docs/IPHONE.md).

## Configuration (`.env`, optional)

Copy `.env.example` to `.env` and fill in what you need:

| Variable                     | Purpose                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| `GLEANBOOK_DATA_DIR`         | Folder of the PC master ledger, default `<home>/GleanbookData`                                   |
| `OKX_API_ORIGIN`             | Official OKX API domain for your account's region                                                |
| `OKX_PROXY`                  | HTTP proxy for reaching OKX, e.g. `http://127.0.0.1:7890`; `off` forces a direct connection      |
| `GLEANBOOK_PUBLIC_ORIGIN`    | HTTPS address phones use; read from Tailscale when empty                                         |
| `APP_ORIGIN`, `PORT`, `HOST` | Site address and listening settings for deployment, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) |

**Never commit `.env`, OKX keys or the master ledger.**

## Documentation

The detailed documents are in Chinese for now; translations are welcome.

- [Accounting rules](docs/ACCOUNTING.md): cost, gains, transfers, recurring buys, subscriptions, snapshots and sync
- [Data sources and costs](docs/DATA-SOURCES.md)
- [Deployment and security](docs/DEPLOYMENT.md)
- [iPhone and multi-device sync](docs/IPHONE.md)

## Development

```bash
npm run dev        # Vite dev server (run npm run server in another terminal for /api)
npm run check      # TypeScript type check
npm run i18n:check # every interface text has a translation
npm test           # unit tests (Vitest)
npm run test:e2e   # browser tests (Playwright; uses the installed Chrome on Windows)
npm run format     # Prettier
```

```text
src/            React front end: domain.ts (Decimal ledger rules and validation), plans.ts
                (recurring buys), subscriptions.ts, sync-core.ts (sync merge), theme.css,
                i18n.ts and locales/ (interface languages)
server/         Node backend: same-origin static server, auth, OKX read-only, fund NAVs,
                exchange rates, holidays, PC master ledger
scripts/        launcher, diagnostics, encrypted credential storage, autostart, service worker build
tests/          unit and browser tests
```

Interface text is written in Chinese in the code and wrapped in `tr()`; translations live in `src/locales/`. To add a language, copy `src/locales/en.ts`, translate it, and register it in `src/i18n.ts`.

Contributions are welcome: read [CONTRIBUTING.md](CONTRIBUTING.md), and see [ROADMAP.md](ROADMAP.md) for ideas. Report security issues privately as described in [SECURITY.md](SECURITY.md). Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## License

[GNU Affero General Public License v3.0 or later](LICENSE) (AGPL-3.0-or-later).

You may use, modify and distribute this project freely. If you distribute a modified version, or **let others use a modified version over a network**, you must publish its complete source code under the same license.

## Name

**Gleanbook**: to glean is to gather what is left, entry by entry; the Chinese name 拾账 means the same. Internal identifiers such as browser storage keys and the format tags of backups keep the older `shizhang` name, so JSON backups exported from early versions import directly.
