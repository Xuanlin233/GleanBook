import { useEffect, useState } from 'react';
import { z } from 'zod';
import { D, type Ledger, type Holding, type Account } from './domain';
import { type Commit } from './forms';
import { Button, Field, Panel, Notice, ErrorText, Modal, humanError, Icon } from './ui';
import { locale, tr } from './i18n';
const rowSchema = z.object({
  key: z.string().max(100),
  location: z.enum(['funding', 'trading', 'earn']),
  currency: z.string().max(40),
  quantity: z.string().regex(/^\d+(\.\d+)?$/),
  earnings: z.string().nullable(),
  at: z.string().datetime(),
});
const syncSchema = z.object({
  rows: z.array(rowSchema).max(5000),
  generatedAt: z.string().datetime(),
  permissions: z.literal('read_only'),
  scope: z.string(),
});
type SyncResult = z.infer<typeof syncSchema>;
async function api(path: string, options?: RequestInit) {
  const res = await fetch(path, {
    ...options,
    credentials: 'same-origin',
    cache: 'no-store',
    // Up to 5 read-only endpoints, each up to 20 s plus one retry on the backend.
    signal: AbortSignal.timeout(120000),
  });
  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    throw new Error(tr('后端未运行或返回内容无效，请按运行文档启动服务'));
  }
  if (!res.ok) throw new Error((raw as { error?: string }).error ?? tr('后端请求失败'));
  return raw;
}
export function ConnectionSettings({
  ledger: l,
  onSave,
  notify,
  mode,
  onImported,
}: {
  ledger: Ledger;
  onSave: Commit;
  notify: (s: string) => void;
  mode: string;
  onImported: () => void;
}) {
  const [token, setToken] = useState(''),
    [authenticated, setAuthenticated] = useState(false),
    [configured, setConfigured] = useState(false),
    [lastRead, setLastRead] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [preview, setPreview] = useState<SyncResult | null>(null),
    [reconciled, setReconciled] = useState(false);
  async function check() {
    const raw = (await api('/api/okx/status')) as {
      authenticated: boolean;
      configured: boolean;
      lastVerifiedAt?: string | null;
    };
    setAuthenticated(raw.authenticated === true);
    setConfigured(raw.configured === true);
    setLastRead(raw.lastVerifiedAt ?? null);
  }
  // A saved 30-day session is picked up silently; no password prompt when it is still valid.
  useEffect(() => {
    if (mode !== 'demo') check().catch(() => {});
  }, [mode]);
  const wrap = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(humanError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Panel title={tr('OKX 只读持仓')}>
        <div className="connection-status">
          <span className={`status-dot ${authenticated && configured ? 'configured' : ''}`} />
          <strong>
            {authenticated
              ? configured
                ? lastRead
                  ? tr('只读读取已验证 · 持仓覆盖待核对')
                  : tr('后端已配置 · 实盘覆盖待核对')
                : tr('后端已鉴权 · OKX 凭证未配置')
              : tr('未连接')}
          </strong>
          <span className="tiny-pill">{tr('可选后端 · 实验性')}</span>
        </div>
        <Notice>
          {tr(
            '需要在后端部署平台配置只读密钥。这里仅输入独立的“后端访问口令”，不要填写 OKX API Secret、Passphrase、账户密码、私钥或助记词。',
          )}
        </Notice>
        {!authenticated ? (
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              wrap(async () => {
                await api('/api/session', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ token }),
                });
                setToken('');
                await check();
              });
            }}
          >
            <Field label={tr('后端访问口令')}>
              <input
                type="password"
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={tr('由部署者在服务端安全配置')}
                required
              />
            </Field>
            <div className="button-group wrap">
              <Button variant="primary" type="submit" disabled={busy || mode === 'demo'}>
                {tr('验证后端')}
              </Button>
              <Button onClick={() => wrap(check)} disabled={busy || mode === 'demo'}>
                {tr('检查已有会话')}
              </Button>
            </div>
          </form>
        ) : (
          <div className="button-group wrap">
            <Button
              variant="primary"
              disabled={!configured || busy || mode === 'demo'}
              onClick={() =>
                wrap(async () => {
                  const raw = syncSchema.parse(await api('/api/okx/sync', { method: 'POST' }));
                  setPreview(raw);
                  setLastRead(raw.generatedAt);
                  setReconciled(false);
                })
              }
            >
              <Icon name="refresh" />
              {busy ? tr('读取中…') : tr('读取持仓并预览')}
            </Button>
            <Button
              onClick={() =>
                wrap(async () => {
                  await api('/api/session', { method: 'DELETE' });
                  setAuthenticated(false);
                  setConfigured(false);
                  setLastRead(null);
                  setPreview(null);
                  if ('caches' in window)
                    for (const key of await caches.keys())
                      if (key.includes('private')) await caches.delete(key);
                  notify(tr('后端会话已退出。当前设备账本与已确认的持仓快照保留。'));
                })
              }
            >
              <Icon name="logout" />
              {tr('退出后端会话')}
            </Button>
          </div>
        )}
        <ErrorText error={error} />
        <div className="setting-description long-copy">
          {tr(
            '支持各账户模式，但非现货模式下必须没有未平仓的杠杆、合约或期权仓位（否则现金余额不含未实现盈亏）；只读取资金余额、交易现金余额和简单赚币活期。三者全部读取成功才可导入；赚币总额 amt 不再叠加 loanAmt 与 pendingAmt。不导入成交、充值提现或全部历史收益；不保证覆盖定期产品、Web3、代币化股票及中间划转状态。发现借贷、隔离仓位或明确赎回中金额时停止更新。接口不返回所有产品并不表示未返回产品余额为零，请始终和 App 总览对账。',
          )}
        </div>
        <Notice tone="warning">
          {lastRead
            ? tr('本后端最近成功读取时间：{time}。仍须与 App 逐项对账。', {
                time: new Date(lastRead).toLocaleString(locale),
              })
            : tr('本后端尚未完成真实账户读取验证。')}
          {tr(
            '多个余额接口无法保证原子读取，申赎或划转过程中请勿导入。若已有手动 OKX 持仓，导入前移除对应重复项。',
          )}
        </Notice>
      </Panel>
      <Panel title={tr('公共行情与基金')}>
        <div className="setting-row">
          <div>
            <strong>{tr('OKX 公共现货行情')}</strong>
            <p>
              {tr('已实际请求验证 BTC-USDT、ETH-USDT、OKB-USDT、USDC-USDT；不代表私人账户已连接。')}
            </p>
          </div>
          <span className="tiny-pill">{tr('需要后端网络可达')}</span>
        </div>
        <div className="setting-row">
          <div>
            <strong>{tr('正式基金净值')}</strong>
            <p>
              {tr(
                '任意 6 位代码的公募基金免费获取正式单位净值，每 6 小时最多一次；失败保留旧值。免费来源无服务承诺，货币基金需手动记录收益。',
              )}
            </p>
          </div>
          <span className="tiny-pill">{tr('免费 · 无需 Key')}</span>
        </div>
        <p className="setting-description">
          {tr(
            '来源顺序：000218、110020 先用基金公司官网；其余及官网失败时依次使用东方财富天天基金、新浪财经。你的份额与成本需自行核对，不从截图推算。',
          )}
        </p>
      </Panel>
      <Panel title={tr('每日快照与云同步')}>
        <Notice>
          {tr(
            '未部署后端定时任务，未实现云同步。只在打开、刷新或本地数据更新时覆盖当前统计日快照。关闭 iPhone PWA 后不保证后台运行。不存在的历史日期不会补齐。',
          )}
        </Notice>
      </Panel>
      {preview && (
        <Modal title={tr('核对 OKX 只读快照')} onClose={() => setPreview(null)} wide>
          <div className="form">
            <Notice tone="warning">
              {tr(
                '本次共有 {count} 项。请核对资金、交易与赚币归属，申赎中资产、未覆盖产品以及与手动持仓的重复。导入替换上次 OKX 快照，手动数据保留。',
                { count: preview.rows.length },
              )}
            </Notice>
            <div className="sync-preview">
              {preview.rows.map((r) => (
                <div key={r.key}>
                  <span>
                    {
                      { funding: tr('资金账户'), trading: tr('交易账户'), earn: tr('简单赚币') }[
                        r.location
                      ]
                    }{' '}
                    · {r.currency}
                  </span>
                  <strong>{l.settings.hideAmounts ? '••••' : r.quantity}</strong>
                </div>
              ))}
            </div>
            <p className="subtle">{preview.scope}</p>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={reconciled}
                onChange={(e) => setReconciled(e.target.checked)}
              />
              {tr('我已核对 OKX 总览，确认没有重复手动持仓、在途划转或遗漏需要单独维护的资产')}
            </label>
            <ErrorText error={error} />
            <div className="form-actions">
              <Button onClick={() => setPreview(null)}>{tr('取消')}</Button>
              <Button
                variant="primary"
                disabled={!reconciled || busy}
                onClick={() =>
                  wrap(async () => {
                    await onSave((s) => applySync(s, preview));
                    setPreview(null);
                    notify(tr('只读快照已导入，正在获取行情与汇率…'));
                    // Price every imported coin and fill the USDT/CNY rate right away.
                    onImported();
                  })
                }
              >
                {tr('确认覆盖 OKX 快照')}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
export function applySync(l: Ledger, result: SyncResult): Ledger {
  const isOKXAccount = (a: Account) =>
    a.source === 'external' &&
    a.id.startsWith('okx-') &&
    ['CNY', 'USD', 'HKD', 'EUR'].includes(a.currency) &&
    ['funding', 'trading'].some((location) => a.externalKey === `${location}:${a.currency}`);
  const isFiatRow = (r: SyncResult['rows'][number]) =>
    ['CNY', 'USD', 'HKD', 'EUR'].includes(r.currency) && r.location !== 'earn';
  const oldAccounts = l.accounts.filter(isOKXAccount),
    oldHoldings = l.holdings.filter((h) => h.source === 'okx'),
    accountKeys = new Set(result.rows.filter(isFiatRow).map((r) => r.key)),
    holdingKeys = new Set(result.rows.filter((r) => !isFiatRow(r)).map((r) => r.key));
  // An omitted row may be a zero balance or a product outside the API's coverage.
  // Preserve the complete previous snapshot until the user can reconcile it.
  const missing = [
    ...oldAccounts
      .filter((a) => !a.externalKey || !accountKeys.has(a.externalKey))
      .map((a) => tr('账户 {name}（{externalKey}）', { name: a.name, externalKey: a.externalKey })),
    ...oldHoldings
      .filter((h) => !h.externalKey || !holdingKeys.has(h.externalKey))
      .map((h) =>
        tr('持仓 {name}（{key}）', { name: h.name, key: h.externalKey ?? tr('缺少标识') }),
      ),
  ];
  if (missing.length)
    throw new Error(
      tr(
        '新快照缺少以下已有 OKX 项目：{missing}。本次未覆盖任何数据，请先核对这些项目；未返回不等于余额为零。',
        { missing: missing.join(tr('；')) },
      ),
    );
  const accounts = l.accounts.filter((a) => !isOKXAccount(a)),
    holdings = l.holdings.filter((h) => h.source !== 'okx');
  for (const r of result.rows) {
    if (isFiatRow(r)) {
      const previous = oldAccounts.find((a) => a.externalKey === r.key),
        a: Account = {
          id: previous?.id ?? 'okx-' + r.key.replace(/[^a-zA-Z0-9_-]/g, '_'),
          name: `OKX ${r.location === 'funding' ? tr('资金') : tr('交易')} · ${r.currency}`,
          currency: r.currency as Account['currency'],
          source: 'external',
          kind: 'manual',
          opening: '0',
          externalBalance: r.quantity,
          externalKey: r.key,
          updatedAt: r.at,
        };
      accounts.push(a);
    } else {
      const previous = l.holdings.find((h) => h.source === 'okx' && h.externalKey === r.key);
      const h: Holding = {
        id: previous?.id ?? 'okx-' + r.key.replace(/[^a-zA-Z0-9_-]/g, '_'),
        name: r.currency + (r.location === 'earn' ? tr(' 简单赚币') : ''),
        kind: r.location === 'earn' ? 'earn' : 'crypto',
        symbol: r.currency,
        quantity: r.quantity,
        cost: null,
        currency: 'USDT',
        source: 'okx',
        location:
          r.location === 'funding'
            ? tr('OKX 资金')
            : r.location === 'trading'
              ? tr('OKX 交易')
              : tr('OKX 简单赚币'),
        externalKey: r.key,
        updatedAt: r.at,
        earnings: r.earnings,
        price:
          previous?.price ??
          (r.currency === 'USDT'
            ? {
                value: '1',
                currency: 'USDT',
                source: tr('同币种单位价格：1 USDT / USDT（非美元汇率）'),
                mode: 'manual',
                asOf: r.at,
                fetchedAt: r.at,
              }
            : null),
      };
      holdings.push(h);
    }
  }
  return { ...l, accounts, holdings };
}
