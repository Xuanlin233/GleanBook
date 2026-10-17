import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  D,
  money,
  uid,
  monthIn,
  monthly,
  parseBackup,
  mergeBackup,
  csvExport,
  type Ledger,
} from './domain';
import { type Commit } from './forms';
import {
  Button,
  Panel,
  Field,
  Icon,
  Notice,
  Modal,
  ErrorText,
  DownloadLink,
  humanError,
} from './ui';
import { requestPersistence } from './storage';
import { ConnectionSettings } from './sync';
import { SyncPanel } from './sync-ui';
import type { SyncState } from './storage';
import type { SyncStatus } from './sync-client';
export function Settings({
  ledger: l,
  onSave,
  onAccount,
  onNavigate,
  onClear,
  mode,
  setMode,
  notify,
  onRefresh,
  syncStatus,
  syncInfo,
  onSyncNow,
  jumpToConnect,
}: {
  ledger: Ledger;
  onSave: Commit;
  onAccount: () => void;
  onNavigate: (p: string) => void;
  onClear: () => void;
  mode: string;
  setMode: (mode: string) => void;
  notify: (s: string) => void;
  onRefresh: () => void;
  syncStatus: SyncStatus;
  syncInfo: SyncState;
  onSyncNow: () => Promise<void>;
  jumpToConnect: number;
}) {
  const [tab, setTab] = useState(jumpToConnect ? 'connect' : 'general');
  // The top bar sync chip opens this tab.
  useEffect(() => {
    if (jumpToConnect) setTab('connect');
  }, [jumpToConnect]);
  const tabs = [
    ['general', 'sliders', '偏好与隐私'],
    ['accounts', 'wallet', '账户与分类'],
    ['budget', 'donut', '月度预算'],
    ['rates', 'globe', '汇率与统计'],
    ['connect', 'lock', '数据连接'],
    ['backup', 'shield', '备份与恢复'],
    ['install', 'phone', '安装与说明'],
  ];
  const safe = (update: (l: Ledger) => Ledger) =>
    onSave(update)
      .then(() => notify('已保存设置'))
      .catch((e) => notify(humanError(e)));
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">按你的方式，打理你的财务</p>
          <h1>设置</h1>
          <p>让工具安静地适应你。</p>
        </div>
        <span className="version-badge">拾账 Gleanbook v0.1.0</span>
      </div>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="设置分类">
          {tabs.map(([id, icon, name]) => (
            <button key={id} onClick={() => setTab(id)} className={tab === id ? 'selected' : ''}>
              <Icon name={icon === 'sliders' ? 'settings' : icon} />
              {name}
              <Icon name="right" size={14} />
            </button>
          ))}
        </nav>
        <div className="settings-content">
          {tab === 'general' && (
            <>
              <Panel title="外观">
                <div className="setting-description">简单、清晰，在每一块屏幕上都舒适。</div>
                <div className="theme-options">
                  {[
                    ['system', 'desktop', '跟随系统'],
                    ['light', 'sun', '浅色'],
                    ['dark', 'moon', '深色'],
                  ].map(([v, icon, name]) => (
                    <button
                      key={v}
                      className={l.settings.theme === v ? 'selected' : ''}
                      onClick={() =>
                        safe((s) => ({
                          ...s,
                          settings: { ...s.settings, theme: v as 'system' | 'light' | 'dark' },
                        }))
                      }
                    >
                      <Icon name={icon} size={25} />
                      <span>{name}</span>
                      {l.settings.theme === v && <Icon name="check" size={16} />}
                    </button>
                  ))}
                </div>
                <div className="setting-row">
                  <div>
                    <strong>涨跌颜色</strong>
                    <p>始终保留正负号，颜色作为辅助。</p>
                  </div>
                  <select
                    aria-label="涨跌颜色"
                    value={l.settings.gainColor}
                    onChange={(e) =>
                      safe((s) => ({
                        ...s,
                        settings: { ...s.settings, gainColor: e.target.value as 'green' | 'red' },
                      }))
                    }
                  >
                    <option value="green">绿涨红跌</option>
                    <option value="red">红涨绿跌</option>
                  </select>
                </div>
              </Panel>
              <Panel title="金额隐私">
                <div className="setting-row">
                  <div>
                    <strong>隐藏金额</strong>
                    <p>总览、账单与资产列表统一隐藏；编辑表单保留输入值。</p>
                  </div>
                  <button
                    role="switch"
                    aria-checked={l.settings.hideAmounts}
                    aria-label="隐藏金额"
                    className={`toggle ${l.settings.hideAmounts ? 'on' : ''}`}
                    onClick={() =>
                      safe((s) => ({
                        ...s,
                        settings: { ...s.settings, hideAmounts: !s.settings.hideAmounts },
                      }))
                    }
                  >
                    <span />
                  </button>
                </div>
                <Notice>
                  账本仅保存在当前设备、当前浏览器。没有云同步和应用登录锁；可访问此浏览器配置的使用者也可访问账本，请使用设备锁并定期导出备份。
                </Notice>
              </Panel>
              <Panel title="体验演示">
                <div className="setting-description">
                  演示账本和真实账本使用独立存储。演示行情是虚构数据，不表示接口连接成功。
                </div>
                <Button onClick={() => setMode(mode === 'real' ? 'demo' : 'real')}>
                  {mode === 'real' ? '打开独立演示账本' : '返回我的真实账本'}
                  <Icon name="arrow" />
                </Button>
              </Panel>
            </>
          )}
          {tab === 'accounts' && (
            <>
              <Panel
                title="账户管理"
                aside={
                  <Button variant="text" onClick={onAccount}>
                    <Icon name="plus" size={17} />
                    添加账户
                  </Button>
                }
              >
                <p className="setting-description">
                  在资产页打开账户，可查看余额、编辑期初余额或删除空账户。
                </p>
                {l.accounts.map((a) => (
                  <div className="setting-row" key={a.id}>
                    <div>
                      <strong>{a.name}</strong>
                      <p>
                        {a.currency} · {a.source === 'manual' ? '手动账本' : '外部快照'}
                      </p>
                    </div>
                  </div>
                ))}
                <Button onClick={() => onNavigate('assets')}>
                  查看与管理账户
                  <Icon name="arrow" />
                </Button>
              </Panel>
              <CategoryManager ledger={l} onSave={onSave} />
            </>
          )}
          {tab === 'budget' && <BudgetSettings ledger={l} onSave={onSave} />}
          {tab === 'rates' && <RateSettings ledger={l} onSave={onSave} onRefresh={onRefresh} />}
          {tab === 'connect' && (
            <SyncPanel status={syncStatus} info={syncInfo} mode={mode} onSyncNow={onSyncNow} />
          )}
          {tab === 'connect' && (
            <ConnectionSettings
              ledger={l}
              onSave={onSave}
              notify={notify}
              mode={mode}
              onImported={onRefresh}
            />
          )}
          {tab === 'backup' && (
            <>
              <BackupSettings ledger={l} onSave={onSave} notify={notify} mode={mode} />
              <Panel title="设备保存">
                <Notice tone="warning">
                  浏览器数据可能因清理、存储回收或设备损坏而丢失。本地存储不是永久备份。请将 JSON
                  备份保存在其他设备或可信存储中；备份包含财务隐私，未加密。
                </Notice>
                <div className="button-group wrap">
                  <Button
                    onClick={async () => {
                      try {
                        notify(
                          (await requestPersistence())
                            ? '浏览器已允许持久存储，仍请定期备份'
                            : '浏览器未授予持久存储，请定期备份',
                        );
                      } catch (e) {
                        notify(humanError(e));
                      }
                    }}
                  >
                    申请持久存储
                  </Button>
                  <Button variant="danger" onClick={onClear}>
                    清空当前{mode === 'demo' ? '演示' : '真实'}账本
                  </Button>
                </div>
              </Panel>
            </>
          )}
          {tab === 'install' && (
            <>
              <Panel title="添加到主屏幕">
                <div className="install-art">
                  <div className="app-icon">
                    <Icon name="book" size={42} />
                  </div>
                  <strong>拾账</strong>
                  <span>像 App 一样，随手打开。</span>
                </div>
                <ol className="steps">
                  <li>
                    <strong>iPhone / iPad</strong>
                    <p>
                      用 Safari 打开 HTTPS 地址，点击“分享”，再选“添加到主屏幕”。如有“作为网页 App
                      打开”，请开启。
                    </p>
                  </li>
                  <li>
                    <strong>Windows</strong>
                    <p>在 Edge 或 Chrome 地址栏中选择安装应用；也可以直接在浏览器使用。</p>
                  </li>
                  <li>
                    <strong>离线使用</strong>
                    <p>首次联网打开生产构建并完成缓存后，可离线记账。重新联网不等于已云同步。</p>
                  </li>
                </ol>
                <Notice>
                  HTTP 局域网地址通常无法启用 Service Worker；手机测试请部署 HTTPS。无需 IPA
                  签名或苹果开发者付费账号。
                </Notice>
              </Panel>
              <Panel title="当前实现范围">
                <div className="feature-list">
                  <div>
                    <Icon name="check" />
                    <span>本地账本、预算、JSON 备份恢复、CSV 导出、离线 PWA</span>
                  </div>
                  <div>
                    <Icon name="check" />
                    <span>手动投资持仓、申赎分红与份额调整、公共现货行情</span>
                  </div>
                  <div>
                    <Icon name="info" />
                    <span>
                      基金正式净值：任意 6 位代码公募基金免费自动获取（官网 / 东方财富 /
                      新浪）；货币基金手动维护
                    </span>
                  </div>
                  <div>
                    <Icon name="info" />
                    <span>
                      OKX：可选只读后端，需部署、配置凭证并实盘核对；历史交易和收益导入未实现
                    </span>
                  </div>
                  <div>
                    <Icon name="info" />
                    <span>后端每日快照、云端账本与跨设备同步：未实现</span>
                  </div>
                </div>
              </Panel>
              <Panel title="记账口径">
                <div className="setting-description long-copy">
                  期初余额不算收入；转账本金与信用卡还款不算消费，转账手续费单列支出。退款关联原支出并在退款发生月冲减原分类。投资申赎与现金分红不计生活收支，交易手续费进入投资成本或减少卖出净额。移动加权平均成本计算已实现和未实现收益，缺少成本则收益不可计算。份额调整保持总成本不变，适合拆分、合并或更正份额。新增本金、充值、提现不作为投资收益。历史快照是当时观测值，修改历史记录只重算当前余额与对应月份统计，不回写过去观测的市场估值。
                </div>
              </Panel>
            </>
          )}
        </div>
      </div>
    </>
  );
}
function CategoryManager({ ledger: l, onSave }: { ledger: Ledger; onSave: Commit }) {
  const [name, setName] = useState(''),
    [kind, setKind] = useState<'expense' | 'income'>('expense'),
    [edit, setEdit] = useState<string | null>(null),
    [error, setError] = useState('');
  const execute = async (fn: (l: Ledger) => Ledger) => {
    try {
      await onSave(fn);
      setError('');
    } catch (e) {
      setError(humanError(e));
    }
  };
  return (
    <Panel title="收支分类">
      <div className="category-manager">
        {l.categories.map((c) => (
          <div key={c.id}>
            <span className="category-icon">
              <Icon name={c.icon} size={17} />
            </span>
            <span>
              {c.name}
              <small>{c.kind === 'expense' ? '支出' : '收入'}</small>
            </span>
            <Button
              variant="text"
              onClick={() => {
                setEdit(c.id);
                setName(c.name);
                setKind(c.kind);
              }}
            >
              改名
            </Button>
            <button
              className="icon-button"
              aria-label={`删除${c.name}分类`}
              onClick={() =>
                execute((s) => {
                  if (
                    s.transactions.some((t) => t.categoryId === c.id) ||
                    s.budgets.some((b) => b.categoryId === c.id)
                  )
                    throw new Error('分类已有账单或预算引用，请先调整相关记录');
                  return { ...s, categories: s.categories.filter((x) => x.id !== c.id) };
                })
              }
            >
              <Icon name="trash" size={17} />
            </button>
          </div>
        ))}
      </div>
      <form
        className="form inline-category-form"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            if (!name.trim()) throw new Error('请输入分类名称');
            await onSave((s) => {
              if (
                s.categories.some((c) => c.id !== edit && c.kind === kind && c.name === name.trim())
              )
                throw new Error('同类型下已有此分类');
              return {
                ...s,
                categories: edit
                  ? s.categories.map((c) => (c.id === edit ? { ...c, name: name.trim() } : c))
                  : [...s.categories, { id: uid(), name: name.trim(), kind, icon: 'dots' }],
              };
            });
            setName('');
            setEdit(null);
            setError('');
          } catch (e) {
            setError(humanError(e));
          }
        }}
      >
        <Field label={edit ? '修改分类名称' : '新分类名称'}>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} required />
        </Field>
        <Field label="类型">
          <select
            value={kind}
            disabled={!!edit}
            onChange={(e) => setKind(e.target.value as 'income' | 'expense')}
          >
            <option value="expense">支出</option>
            <option value="income">收入</option>
          </select>
        </Field>
        <Button type="submit">{edit ? '保存改名' : '添加分类'}</Button>
        {edit && (
          <Button
            variant="text"
            onClick={() => {
              setEdit(null);
              setName('');
            }}
          >
            取消
          </Button>
        )}
      </form>
      <ErrorText error={error} />
    </Panel>
  );
}
function BudgetSettings({ ledger: l, onSave }: { ledger: Ledger; onSave: Commit }) {
  const [month, setMonth] = useState(monthIn(new Date(), l.settings.timezone)),
    [values, setValues] = useState<Record<string, string>>(() =>
      Object.fromEntries(
        l.budgets
          .filter((b) => b.month === monthIn(new Date(), l.settings.timezone))
          .map((b) => [b.categoryId ?? 'total', b.amount]),
      ),
    ),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false);
  const usage = monthly(l, month);
  return (
    <Panel title="每月预算">
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await onSave((s) => ({
              ...s,
              budgets: [
                ...s.budgets.filter((b) => b.month !== month),
                ...Object.entries(values)
                  .filter(([, v]) => v !== '')
                  .map(([id, amount]) => ({
                    month,
                    categoryId: id === 'total' ? null : id,
                    amount,
                  })),
              ],
            }));
            setError('');
            setSaved(true);
          } catch (e) {
            setError(humanError(e));
          }
        }}
      >
        <Field label="预算月份">
          <input
            type="month"
            value={month}
            onChange={(e) => {
              if (!e.target.value) return;
              setMonth(e.target.value);
              setValues(
                Object.fromEntries(
                  l.budgets
                    .filter((b) => b.month === e.target.value)
                    .map((b) => [b.categoryId ?? 'total', b.amount]),
                ),
              );
              setSaved(false);
            }}
            required
          />
        </Field>
        <Field
          label="月度总预算（人民币）"
          hint="留空表示未设置，0 表示不计划消费。每个月独立设置。"
        >
          <input
            inputMode="decimal"
            value={values.total ?? ''}
            onChange={(e) => {
              setValues({ ...values, total: e.target.value });
              setSaved(false);
            }}
            placeholder="例如 6000"
          />
        </Field>
        <h3>分类预算（可选）</h3>
        <div className="form-grid">
          {l.categories
            .filter((c) => c.kind === 'expense')
            .map((c) => (
              <Field
                label={c.name + '（CNY）'}
                key={c.id}
                hint={`本月已用 ${money(usage.categories[c.id] ?? 0, l.settings.hideAmounts)}${l.budgets.some((b) => b.month === month && b.categoryId === c.id && D(b.amount).lt(usage.categories[c.id] ?? 0)) ? ' · 已超分类预算' : ''}`}
              >
                <input
                  inputMode="decimal"
                  value={values[c.id] ?? ''}
                  onChange={(e) => {
                    setValues({ ...values, [c.id]: e.target.value });
                    setSaved(false);
                  }}
                  placeholder="未设置"
                />
              </Field>
            ))}
        </div>
        <Notice>
          分类预算用于单项提醒，不与总预算相加。不同币种账单按发生时保存的人民币汇率统计。
        </Notice>
        <ErrorText error={error} />
        {saved && <Notice tone="success">本月预算已保存。</Notice>}
        <Button variant="primary" type="submit">
          保存预算
        </Button>
      </form>
    </Panel>
  );
}
function RateSettings({
  ledger: l,
  onSave,
  onRefresh,
}: {
  ledger: Ledger;
  onSave: Commit;
  onRefresh: () => void;
}) {
  const [currency, setCurrency] = useState('USD'),
    [value, setValue] = useState(l.rates.find((r) => r.currency === 'USD')?.value ?? ''),
    [source, setSource] = useState(''),
    [date, setDate] = useState(new Date().toISOString().slice(0, 10)),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false),
    [tz, setTz] = useState(l.settings.timezone),
    [confirmTZ, setConfirmTZ] = useState(false);
  return (
    <>
      <Panel title="人民币换算汇率">
        <Notice>
          账本用到的外币会自动补齐汇率：美元、欧元、港元取中国外汇交易中心人民币中间价，USDT = OKX
          USDT-USD × 美元中间价，USDC = OKX USDC-USDT × USDT 汇率，不预设稳定币等于 1
          美元。自动汇率每 30
          分钟检查一次；你手动保存的汇率优先，不会被覆盖。历史收支保留记账时汇率。
        </Notice>
        <div className="rates-list">
          {l.rates.length ? (
            l.rates.map((r) => (
              <div className="setting-row" key={r.currency}>
                <div>
                  <strong>
                    1 {r.currency} = {l.settings.hideAmounts ? '••••' : r.value} CNY
                  </strong>
                  <p>
                    {r.source} · {r.asOf.slice(0, 10)}
                    {Date.now() - Date.parse(r.asOf) > 7 * 86400000 ? ' · 数据较旧' : ''}
                  </p>
                </div>
                {r.auto ? (
                  <span className="tiny-pill">自动</span>
                ) : (
                  <Button
                    variant="text"
                    onClick={() =>
                      onSave((s) => ({
                        ...s,
                        rates: s.rates.filter((x) => x.currency !== r.currency),
                      }))
                        .then(onRefresh)
                        .catch((e) => setError(humanError(e)))
                    }
                  >
                    手动 · 改用自动
                  </Button>
                )}
              </div>
            ))
          ) : (
            <p className="setting-description">
              尚未添加汇率。人民币资产无需换算；其他币种未补齐时显示估值不完整。
            </p>
          )}
        </div>
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            setError('');
            setSaved(false);
            try {
              if (Date.parse(date) > Date.now() + 86400000)
                throw new Error('汇率日期不能是未来日期');
              await onSave((s) => ({
                ...s,
                rates: [
                  ...s.rates.filter((r) => r.currency !== currency),
                  {
                    currency: currency as Ledger['rates'][number]['currency'],
                    value,
                    source,
                    asOf: new Date(date + 'T15:00:00+08:00').toISOString(),
                  },
                ],
              }));
              setSaved(true);
            } catch (e) {
              setError(humanError(e));
            }
          }}
        >
          <div className="form-grid">
            <Field label="原币">
              <select
                value={currency}
                onChange={(e) => {
                  setCurrency(e.target.value);
                  const r = l.rates.find((r) => r.currency === e.target.value);
                  setValue(r?.value ?? '');
                  setSource(r?.source ?? '');
                  setSaved(false);
                }}
              >
                {['USD', 'USDT', 'USDC', 'HKD', 'EUR'].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="1 原币 = 多少人民币">
              <input
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                required
              />
            </Field>
            <Field label="数据日期">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </Field>
            <Field label="汇率来源与口径">
              <input
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="例如：银行现汇中间价 / 个人成交价"
                maxLength={200}
                required
              />
            </Field>
          </div>
          <ErrorText error={error} />
          {saved && <Notice tone="success">汇率已保存，资产换算已更新。</Notice>}
          <Button variant="primary" type="submit">
            保存汇率
          </Button>
        </form>
      </Panel>
      <Panel title="统计时区">
        <Field label="日、月统计边界">
          <select
            value={tz}
            onChange={(e) => {
              setTz(e.target.value);
              setConfirmTZ(false);
            }}
          >
            {[
              ...new Set([
                'Asia/Shanghai',
                'America/New_York',
                'Asia/Hong_Kong',
                'UTC',
                'Europe/London',
                l.settings.timezone,
              ]),
            ].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Field>
        <p className="setting-description">
          修改后，靠近午夜或月末的账单可能划入不同日期和月份。交易原始时间保持不变；旧时区的历史观测快照保留，趋势图只显示当前时区快照。
        </p>
        {tz !== l.settings.timezone && (
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={confirmTZ}
              onChange={(e) => setConfirmTZ(e.target.checked)}
            />
            我了解统计日期和月份可能发生变化
          </label>
        )}
        <Button
          disabled={tz === l.settings.timezone || !confirmTZ}
          onClick={async () => {
            try {
              await onSave((s) => ({ ...s, settings: { ...s.settings, timezone: tz } }));
              setConfirmTZ(false);
            } catch (e) {
              setError(humanError(e));
            }
          }}
        >
          更新统计时区
        </Button>
      </Panel>
    </>
  );
}
function BackupSettings({
  ledger: l,
  onSave,
  notify,
  mode,
}: {
  ledger: Ledger;
  onSave: Commit;
  notify: (s: string) => void;
  mode: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null),
    [incoming, setIncoming] = useState<Ledger | null>(null),
    [error, setError] = useState(''),
    [restoreMode, setRestoreMode] = useState('merge'),
    [confirm, setConfirm] = useState(''),
    [busy, setBusy] = useState(false);
  const merge = incoming ? mergeBackup(l, incoming) : null;
  return (
    <>
      <Panel title="备份与导出">
        <p className="setting-description">
          JSON 保存账户、账单、持仓、投资记录、预算、汇率和快照。CSV
          仅导出日常账单，不能用于完整恢复。
        </p>
        <div className="button-group wrap">
          <DownloadLink
            label="完整 JSON 备份"
            content={() =>
              JSON.stringify(
                {
                  format: 'shizhang-backup',
                  version: 1,
                  exportedAt: new Date().toISOString(),
                  ledger: l,
                },
                null,
                2,
              )
            }
            name={`拾账-${mode === 'demo' ? '演示-' : ''}${new Date().toISOString().slice(0, 10)}.json`}
            type="application/json"
          />
          <DownloadLink
            label="导出账单 CSV"
            content={() => csvExport(l)}
            name={`拾账-账单-${mode}.csv`}
            type="text/csv;charset=utf-8"
          />
        </div>
      </Panel>
      <Panel title="恢复 JSON 备份">
        <p className="setting-description">
          先校验、预览，再执行恢复。合并按稳定 ID 去重，同 ID 内容冲突时停止合并；不同 ID
          的相似消费保留，避免误删真实重复消费。
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="visually-hidden"
          aria-label="选择 JSON 备份"
          onChange={async (e) => {
            setError('');
            const file = e.target.files?.[0];
            if (!file) return;
            try {
              if (file.size > 20 * 1024 * 1024) throw new Error('备份不能超过 20 MB');
              const data = parseBackup(await file.text());
              setIncoming(data);
              setRestoreMode('merge');
              setConfirm('');
            } catch (e) {
              setError(humanError(e));
            }
            e.target.value = '';
          }}
        />
        <Button onClick={() => fileRef.current?.click()}>
          <Icon name="upload" />
          选择备份文件
        </Button>
        <ErrorText error={error} />
      </Panel>
      {incoming && (
        <Modal title="导入前预览" onClose={() => setIncoming(null)}>
          <div className="form">
            <Notice>
              当前目标：{mode === 'real' ? '真实账本' : '独立演示账本'}
              。现有数据只会在校验通过并确认后一次性写入。
            </Notice>
            <div className="preview-counts">
              {[
                ['账户', incoming.accounts.length],
                ['账单', incoming.transactions.length],
                ['持仓', incoming.holdings.length],
                ['投资记录', incoming.investments.length],
                ['历史快照', incoming.snapshots.length],
              ].map(([k, v]) => (
                <div key={k}>
                  <span>{k}</span>
                  <strong>{v}</strong>
                </div>
              ))}
            </div>
            <Field label="恢复方式">
              <select value={restoreMode} onChange={(e) => setRestoreMode(e.target.value)}>
                <option value="merge">合并，保留当前偏好</option>
                <option value="replace">覆盖，恢复备份中的全部数据</option>
              </select>
            </Field>
            {restoreMode === 'merge' ? (
              <Notice tone={merge!.conflicts.length ? 'warning' : 'info'}>
                {merge!.conflicts.length
                  ? `发现 ${merge!.conflicts.length} 项内容冲突，无法自动合并。可取消，或确认覆盖。`
                  : `新增 ${merge!.added} 项；跳过 ${merge!.skipped} 项重复数据。`}
              </Notice>
            ) : (
              <Field label="输入“恢复”以确认覆盖当前账本">
                <input
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="off"
                />
              </Field>
            )}
            <ErrorText error={error} />
            <div className="form-actions">
              <Button onClick={() => setIncoming(null)}>取消</Button>
              <Button
                variant="primary"
                disabled={
                  busy || (restoreMode === 'merge' ? !!merge!.conflicts.length : confirm !== '恢复')
                }
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    await onSave((current) => {
                      if (restoreMode === 'replace')
                        return { ...incoming, revision: current.revision };
                      const result = mergeBackup(current, incoming);
                      if (result.conflicts.length)
                        throw new Error('当前数据发生变化，存在导入冲突');
                      return result.ledger;
                    });
                    setIncoming(null);
                    notify('恢复完成，数据已完整写入当前设备');
                  } catch (e) {
                    setError(humanError(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                确认恢复
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
