import { useState, type ReactNode } from 'react';
import {
  D,
  exact,
  money,
  dayIn,
  monthIn,
  totals,
  monthly,
  accountBalance,
  holdingPosition,
  holdingValue,
  rateFor,
  type Ledger,
  type Transaction,
  type Account,
  type Holding,
  type Investment,
} from './domain';
import { Button, Icon, IconButton, Empty, Panel, Notice } from './ui';
import { canRefreshPrice } from './market';
import { PlansPanel, RunList } from './plans-ui';
import { SubscriptionsPanel } from './subscriptions-ui';
import type { PlanRun } from './domain';
import { locale, monthLabel, tr } from './i18n';
const kindLabels = {
  income: tr('收入'),
  expense: tr('支出'),
  transfer: tr('转账'),
  refund: tr('退款'),
  fee: tr('手续费'),
};
export const holdingLabels = {
  fund: tr('基金'),
  crypto: tr('加密资产'),
  earn: tr('简单赚币'),
  other: tr('其他资产'),
};
export const formatAt = (at: string, tz: string) =>
  new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(at));
export function TransactionList({
  ledger: l,
  records,
  onEdit,
  compact = false,
}: {
  ledger: Ledger;
  records: Transaction[];
  onEdit: (t: Transaction) => void;
  compact?: boolean;
}) {
  const hide = l.settings.hideAmounts;
  if (!records.length)
    return (
      <Empty
        icon="receipt"
        title={tr('还没有账单')}
        description={tr('记录第一笔，慢慢看清生活的每一份收支。')}
      />
    );
  const groups: Record<string, Transaction[]> = {};
  for (const t of records.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))) {
    const key = dayIn(t.occurredAt, l.settings.timezone);
    (groups[key] ??= []).push(t);
  }
  return (
    <div className="transaction-list">
      {Object.entries(groups).map(([day, items]) => (
        <div className="day-group" key={day}>
          {!compact && (
            <div className="day-heading">
              <span>{day === dayIn(new Date(), l.settings.timezone) ? tr('今天') : day}</span>
              <span>{tr('{count} 笔', { count: items!.length })}</span>
            </div>
          )}
          {items!.map((t) => {
            const cat = l.categories.find((c) => c.id === t.categoryId),
              account = l.accounts.find((a) => a.id === t.accountId),
              to = l.accounts.find((a) => a.id === t.toAccountId),
              positive = t.kind === 'income' || t.kind === 'refund';
            return (
              <button className="transaction-row" key={t.id} onClick={() => onEdit(t)}>
                <span
                  className={`category-icon ${t.kind === 'income' ? 'green' : t.kind === 'transfer' ? 'blue' : (cat?.icon ?? '')}`}
                >
                  <Icon
                    name={t.kind === 'transfer' ? 'transfer' : (cat?.icon ?? 'wallet')}
                    size={21}
                  />
                </span>
                <span className="transaction-copy">
                  <strong>{t.note || cat?.name || tr('账户转账')}</strong>
                  <span>
                    {t.kind === 'transfer'
                      ? `${account?.name} → ${to?.name}`
                      : `${cat?.name} · ${account?.name}`}
                    {compact
                      ? ` · ${day?.slice(5)}`
                      : ` · ${new Intl.DateTimeFormat(locale, { timeZone: l.settings.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(t.occurredAt))}`}
                  </span>
                </span>
                <span className={`transaction-amount ${positive ? 'gain' : ''}`}>
                  {hide
                    ? '••••'
                    : `${positive ? '+' : t.kind === 'transfer' ? '' : '−'}${account?.currency === 'CNY' ? '¥ ' : account?.currency + ' '}${D(t.amount).toFixed(account?.currency === 'CNY' ? 2 : 4)}`}
                  <small>
                    {t.kind === 'transfer' && to && account && to.currency !== account.currency
                      ? tr('转入 {currency} {amount}', {
                          currency: to.currency,
                          amount: hide
                            ? '••••'
                            : D(t.received ?? '0').toFixed(to.currency === 'CNY' ? 2 : 4),
                        })
                      : kindLabels[t.kind]}
                    {t.kind === 'transfer' && D(t.fee).gt(0) && !hide
                      ? tr(' · 手续费 {fee}', { fee: t.fee })
                      : ''}
                  </small>
                </span>
                <Icon name="right" size={16} />
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
const colors = ['#1683f8', '#77b5f8', '#708be0', '#64b9ad', '#c5ccdb'];
export function Distribution({ ledger: l }: { ledger: Ledger }) {
  const t = totals(l),
    entries = Object.entries(t.distribution),
    hide = l.settings.hideAmounts;
  let cursor = 0;
  const gradient = entries
    .map(([, v], i) => {
      const start = cursor;
      cursor += t.assets.gt(0) ? v.div(t.assets).toNumber() * 100 : 0;
      return `${colors[i]} ${start}% ${cursor}%`;
    })
    .join(',');
  return (
    <div className="distribution">
      <div
        className="donut"
        style={{ background: t.assets.gt(0) ? `conic-gradient(${gradient})` : 'var(--empty-ring)' }}
        role="img"
        aria-label={
          hide
            ? tr('资产分布，金额已隐藏')
            : entries.map(([k, v]) => `${tr(k) /* i18n-ignore */} ${money(v)}`).join(tr('，'))
        }
      >
        <div>
          <small>{t.complete ? tr('总资产') : tr('已知总资产')}</small>
          <strong>{money(t.assets, hide)}</strong>
        </div>
      </div>
      <div className="legend">
        {entries.map(([k, v], i) => (
          <div key={k}>
            <span>
              <i style={{ background: colors[i] }} />
              {tr(k) /* i18n-ignore: fixed category keys from totals() */}
            </span>
            <strong>{money(v, hide)}</strong>
            <small>{t.assets.gt(0) ? v.div(t.assets).mul(100).toFixed(1) : '0'}%</small>
          </div>
        ))}
      </div>
    </div>
  );
}
export function History({ ledger: l }: { ledger: Ledger }) {
  const tz = l.settings.timezone,
    today = dayIn(new Date(), tz),
    hide = l.settings.hideAmounts;
  const daily = l.snapshots
    .filter((p) => p.timezone === tz && p.complete)
    .sort((a, b) => a.day.localeCompare(b.day));
  // With fewer than two recorded days there is no daily line yet; start on today's curve.
  const [range, setRange] = useState<'today' | 7 | 30 | 90 | 'custom'>(() =>
      daily.filter((p) => Date.parse(p.at) >= Date.now() - 90 * 86400000).length < 2 ? 'today' : 30,
    ),
    [selected, setSelected] = useState<string | null>(null),
    // Custom range defaults to the whole recorded history.
    first = daily[0]?.day ?? today,
    [from, setFrom] = useState(first),
    [to, setTo] = useState(today);
  const [start, end] = from <= to ? [from, to] : [to, from];
  const time = (at: string) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(at));
  const points =
    range === 'today'
      ? l.intraday
          .filter((p) => p.complete && dayIn(p.at, tz) === today)
          .map((p) => ({
            id: p.at,
            t: Date.parse(p.at),
            net: p.net,
            label: `${today} ${time(p.at)}`,
            axis: time(p.at),
          }))
      : daily
          .filter((p) =>
            range === 'custom'
              ? p.day >= start && p.day <= end
              : Date.parse(p.at) >= Date.now() - range * 86400000,
          )
          .map((p) => ({
            id: p.id,
            t: Date.parse(p.day),
            net: p.net,
            label: p.day,
            // Show the year once a range crosses a year boundary.
            axis:
              start.slice(0, 4) !== end.slice(0, 4) && range === 'custom' ? p.day : p.day.slice(5),
          }));
  const values = points.map((x) => Number(x.net)),
    min = Math.min(...values),
    max = Math.max(...values),
    spread = max - min || Math.max(Math.abs(max) * 0.05, 100);
  // Points sit at their real time (intraday) or date (daily), so days without a record show
  // as a visible gap instead of being squeezed out.
  const t0 = points.length ? points[0].t : 0,
    span = points.length > 1 ? points.at(-1)!.t - t0 : 0;
  const xy = points.map((p, i) => ({
    x:
      points.length === 1
        ? 350
        : 25 + (span > 0 ? (p.t - t0) / span : i / (points.length - 1)) * 650,
    y: 150 - ((Number(p.net) - min) / spread) * 112,
    p,
  }));
  const active = points.find((x) => x.id === selected) ?? points.at(-1);
  const todayIncomplete =
    l.snapshots.some((s) => s.timezone === tz && s.day === today && !s.complete) ||
    (range === 'today' && l.intraday.at(-1)?.complete === false);
  return (
    <Panel
      title={tr('净资产趋势')}
      className="history-panel"
      aside={
        <div className="segmented small">
          {(['today', 7, 30, 90, 'custom'] as const).map((r) => (
            <button
              key={r}
              className={range === r ? 'selected' : ''}
              onClick={() => {
                setRange(r);
                setSelected(null);
              }}
            >
              {r === 'today'
                ? tr('今日')
                : r === 'custom'
                  ? tr('自定义')
                  : tr('{days} 天', { days: r })}
            </button>
          ))}
        </div>
      }
    >
      {range === 'custom' && (
        <div className="chart-range">
          <label>
            <span>{tr('开始')}</span>
            <input
              type="date"
              value={from}
              min={first}
              max={today}
              onChange={(e) => {
                setFrom(e.target.value || first);
                setSelected(null);
              }}
            />
          </label>

          <label>
            <span>{tr('结束')}</span>
            <input
              type="date"
              value={to}
              min={first}
              max={today}
              onChange={(e) => {
                setTo(e.target.value || today);
                setSelected(null);
              }}
            />
          </label>
          <button
            type="button"
            className="button text"
            onClick={() => {
              setFrom(first);
              setTo(today);
            }}
          >
            {tr('全部历史')}
          </button>
        </div>
      )}
      {points.length ? (
        <>
          <div className="chart-summary">
            <strong>{money(active!.net, hide)}</strong>
            <span>
              {tr('{label} · {count} 个真实数据点', {
                label: active!.label,
                count: points.length,
              })}
            </span>
          </div>
          <div className="line-chart">
            <svg
              viewBox="0 0 700 185"
              role="img"
              aria-label={
                hide
                  ? tr('净资产金额已隐藏')
                  : tr('真实净资产历史，共 {count} 个点', { count: points.length })
              }
            >
              <defs>
                <linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1">
                  <stop stopColor="#1683f8" stopOpacity=".14" />
                  <stop offset="1" stopColor="#1683f8" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d="M25 160H675" stroke="var(--border)" strokeDasharray="3 5" />
              {xy.length > 1 && (
                <>
                  <path
                    d={`M${xy[0].x} 160 ${xy.map((v) => `L${v.x} ${v.y}`).join(' ')} L${xy.at(-1)!.x} 160Z`}
                    fill="url(#chart-fill)"
                  />
                  <path
                    d={xy.map((v, i) => `${i ? 'L' : 'M'}${v.x} ${v.y}`).join(' ')}
                    fill="none"
                    stroke="#1683f8"
                    strokeWidth="2.5"
                    strokeLinejoin="round"
                  />
                </>
              )}
              {xy.map(({ x, y, p }) => (
                <g
                  key={p.id}
                  tabIndex={0}
                  role="button"
                  aria-label={`${p.label} ${money(p.net, hide)}`}
                  onFocus={() => setSelected(p.id)}
                  onMouseEnter={() => setSelected(p.id)}
                  onClick={() => setSelected(p.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') setSelected(p.id);
                  }}
                >
                  <circle cx={x} cy={y} r="16" fill="transparent" />
                  <circle
                    cx={x}
                    cy={y}
                    r={p.id === active?.id ? 5 : points.length > 60 ? 0 : 3}
                    fill="#1683f8"
                    stroke="var(--surface)"
                    strokeWidth="2"
                  />
                </g>
              ))}
              <text x="25" y="181" fill="var(--muted)" fontSize="12">
                {points[0].axis}
              </text>
              <text x="675" y="181" textAnchor="end" fill="var(--muted)" fontSize="12">
                {points.at(-1)!.axis}
              </text>
            </svg>
          </div>
          {points.length === 1 && (
            <p className="subtle chart-note">
              {range === 'today'
                ? tr('今天目前只有 1 个数据点。资产、价格或汇率再变化时会自动记录并连成曲线。')
                : tr(
                    '这个范围内只有 1 天的数据，按天的趋势需要至少两天；可切换到“今日”查看当天变化。',
                  )}
            </p>
          )}
        </>
      ) : (
        <Empty
          icon="chart"
          title={
            range === 'today'
              ? tr('今天还没有完整估值')
              : range === 'custom'
                ? tr('所选日期内没有记录')
                : tr('给时间一点时间')
          }
          description={
            range === 'today'
              ? tr('资产估值完整后，每次资产、价格或汇率变化都会在这里记一个点。')
              : range === 'custom'
                ? tr('最早的完整记录是 {first}。只有打开网站的日子才有数据点，缺失日期不会补造。', {
                    first,
                  })
                : tr('有资产后，打开或刷新时记录当日快照。缺失日期不会补造。')
          }
        />
      )}
      {todayIncomplete && (
        <Notice tone="warning">
          {tr('今天的估值不完整（有资产缺少价格或汇率），不完整的数值不绘制。')}
        </Notice>
      )}
      <div className="panel-footnote">
        <Icon name="info" size={14} />
        {range === 'today'
          ? tr('今日：每次变化记一个点，同一分钟内只保留最后一次，保留最近 48 小时。')
          : tr(
              '按天：每天一个点，同一天覆盖为最新观测；仅在打开或刷新时记录，后台定时任务未启用。',
            )}
      </div>
    </Panel>
  );
}
export function Overview({
  ledger: l,
  onAdd,
  onAccount,
  onNavigate,
  onEdit,
  onSubscription,
  errors,
}: {
  ledger: Ledger;
  onAdd: () => void;
  onAccount: () => void;
  onNavigate: (page: string) => void;
  onEdit: (t: Transaction) => void;
  onSubscription: (s?: Ledger['subscriptions'][number]) => void;
  errors: string[];
}) {
  const t = totals(l),
    month = monthIn(new Date(), l.settings.timezone),
    m = monthly(l, month),
    hide = l.settings.hideAmounts,
    pct =
      m.budget && m.budget.gt(0)
        ? Math.max(0, Math.min(100, m.expense.div(m.budget).mul(100).toNumber()))
        : m.budget && m.expense.gt(0)
          ? 100
          : 0;
  const dates = [
    ...l.accounts.filter((a) => a.updatedAt).map((a) => a.updatedAt!),
    ...l.holdings.filter((h) => h.price).map((h) => h.price!.asOf),
  ].sort();
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{tr('每一笔生活，都值得被记得')}</p>
          <h1>{tr('财务总览')}</h1>
          <p>{tr('看清当下，让生活更有底气。')}</p>
        </div>
        <Button variant="primary" onClick={onAdd}>
          <Icon name="plus" />
          {tr('记一笔')}
        </Button>
      </div>
      {!l.accounts.length && !l.holdings.length && (
        <div className="welcome-strip">
          <span className="welcome-icon">
            <Icon name="wallet" size={24} />
          </span>
          <div>
            <strong>{tr('从你的第一个账户开始')}</strong>
            <p>{tr('添加期初余额，再记下今天的第一笔。')}</p>
          </div>
          <Button variant="text" onClick={onAccount}>
            {tr('添加账户')}
            <Icon name="arrow" size={17} />
          </Button>
        </div>
      )}
      {!t.complete && (
        <Notice tone="warning">
          <strong>{tr('估值不完整 · 以下项目尚未计入汇总')}</strong>
          <br />
          {tr('{items}。请在设置补充汇率，或在资产详情更新价格。', {
            items: t.missing.join(tr('；')),
          })}
        </Notice>
      )}
      {!!errors.length && (
        <Notice tone="warning">
          {tr('部分更新失败，已保留最近数据：{errors}。可以再次刷新或手动更新。', {
            errors: errors.join(tr('；')),
          })}
        </Notice>
      )}
      <section className="net-worth panel">
        <div className="net-main">
          <span className="label">
            {t.complete ? tr('人民币净资产') : tr('已知人民币净资产')}
            <span className="tiny-pill">CNY</span>
          </span>
          <div className="net-amount">{money(t.net, hide)}</div>
          <span className="net-caption">
            <span className="status-dot" />
            {l.accounts.length || l.holdings.length
              ? tr('基于当前账本与各项最近数据')
              : tr('等待添加你的资产')}
            <span className="net-caption-divider">·</span> {tr('仅保存在当前设备')}
          </span>
        </div>
        <div className="net-breakdown">
          <div>
            <span>{tr('总资产')}</span>
            <strong>{money(t.assets, hide)}</strong>
          </div>
          <div>
            <span>{tr('总负债')}</span>
            <strong>{money(t.liabilities, hide)}</strong>
          </div>
        </div>
      </section>
      <div className="summary-grid">
        <section className="stat-card">
          <div className="stat-label">
            <span>
              <Icon name="down" />
              {tr('本月收入')}
            </span>
            <small>{monthLabel(month)}</small>
          </div>
          <strong>{money(m.income, hide)}</strong>
          <span className="stat-bottom">{tr('生活收入，不含转账与投资回款')}</span>
        </section>
        <section className="stat-card">
          <div className="stat-label">
            <span>
              <Icon name="up" />
              {tr('本月支出')}
            </span>
            <small>{monthLabel(month)}</small>
          </div>
          <strong>{money(m.expense, hide)}</strong>
          <span className="stat-bottom">
            {tr('本月结余')} <b>{money(m.balance, hide)}</b>
          </span>
        </section>
        <section className="stat-card budget-card">
          <div className="stat-label">
            <span>
              <Icon name="wallet" />
              {tr('预算剩余')}
            </span>
            <Button variant="text" onClick={() => onNavigate('settings')}>
              {tr('设置')}
              <Icon name="right" size={13} />
            </Button>
          </div>
          <strong className={m.remaining?.lt(0) ? 'loss' : ''}>
            {m.remaining === null ? tr('待设置') : money(m.remaining, hide)}
          </strong>
          <div
            className="progress"
            role="progressbar"
            aria-label={tr('月度预算使用')}
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span className={m.remaining?.lt(0) ? 'over' : ''} style={{ width: `${pct}%` }} />
          </div>
          <span className="stat-bottom">
            {m.budget
              ? m.remaining!.lt(0)
                ? tr('已超预算 {money}', { money: money(m.remaining!.abs(), hide) })
                : tr('月度预算 {money}', { money: money(m.budget, hide) })
              : tr('给每月支出设一个从容的目标')}
          </span>
        </section>
      </div>
      <div className="dashboard-grid">
        <History ledger={l} />
        <Panel title={tr('资产分布')} aside={<span className="tiny-pill">{tr('人民币')}</span>}>
          <Distribution ledger={l} />
        </Panel>
      </div>
      <div className="dashboard-grid lower-grid">
        <Panel
          title={tr('最近账单')}
          aside={
            <Button variant="text" onClick={() => onNavigate('bills')}>
              {tr('查看全部')}
              <Icon name="right" size={14} />
            </Button>
          }
        >
          <TransactionList
            ledger={l}
            records={[...l.transactions]
              .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
              .slice(0, 5)}
            onEdit={onEdit}
            compact
          />
        </Panel>
        <Panel title={tr('本月消费')} aside={<span className="subtle">{monthLabel(month)}</span>}>
          {Object.values(m.categories).some((v) => v.gt(0)) ? (
            <div className="spending-list">
              {Object.entries(m.categories)
                .sort(([, a], [, b]) => b.cmp(a))
                .filter(([, v]) => v.gt(0))
                .slice(0, 5)
                .map(([catId, v]) => {
                  const cat = l.categories.find((c) => c.id === catId),
                    budget = l.budgets.find((b) => b.month === month && b.categoryId === catId);
                  return (
                    <div className="spending-row" key={catId}>
                      <div>
                        <span>
                          <Icon name={cat?.icon ?? 'dots'} size={17} />
                          {cat?.name ?? tr('其他支出')}
                        </span>
                        <strong>{money(v, hide)}</strong>
                      </div>
                      <div className="progress">
                        <span
                          style={{
                            width: `${m.expense.gt(0) ? Math.min(100, v.div(m.expense).mul(100).toNumber()) : 0}%`,
                          }}
                        />
                      </div>
                      {budget && (
                        <small className={v.gt(budget.amount) ? 'loss' : 'subtle'}>
                          {v.gt(budget.amount) ? tr('已超分类预算') : tr('分类预算')}{' '}
                          {money(budget.amount, hide)}
                        </small>
                      )}
                    </div>
                  );
                })}
            </div>
          ) : (
            <Empty
              icon="donut"
              title={tr('消费脉络，慢慢清晰')}
              description={tr('记录支出后，在这里了解钱花在了哪里。')}
            />
          )}
        </Panel>
      </div>
      <SubscriptionsPanel ledger={l} onOpen={onSubscription} />
      <div className="data-footer">
        <Icon name="shield" size={16} />
        <span>{tr('你的账本，只属于你')}</span>
        <span className="push">
          {dates.length
            ? dates.at(-1) !== dates[0]
              ? tr('行情日期 {from} 至 {to} · 各项时间详见资产', {
                  from: dayIn(dates[0], l.settings.timezone),
                  to: dayIn(dates.at(-1)!, l.settings.timezone),
                })
              : tr('行情日期 {from} · 各项时间详见资产', {
                  from: dayIn(dates[0], l.settings.timezone),
                })
            : tr('本地账本 · 尚无外部行情')}
        </span>
      </div>
    </>
  );
}
export function Bills({
  ledger: l,
  onAdd,
  onEdit,
}: {
  ledger: Ledger;
  onAdd: () => void;
  onEdit: (t: Transaction) => void;
}) {
  const [month, setMonth] = useState(monthIn(new Date(), l.settings.timezone)),
    [type, setType] = useState('all'),
    [category, setCategory] = useState('all'),
    [account, setAccount] = useState('all'),
    [search, setSearch] = useState(''),
    [limit, setLimit] = useState(100);
  const m = monthly(l, month),
    hide = l.settings.hideAmounts;
  const records = l.transactions.filter(
    (t) =>
      monthIn(t.occurredAt, l.settings.timezone) === month &&
      (type === 'all' ||
        (type === 'expense' ? ['expense', 'fee', 'refund'].includes(t.kind) : t.kind === type)) &&
      (category === 'all' || t.categoryId === category) &&
      (account === 'all' || t.accountId === account || t.toAccountId === account) &&
      (
        t.note +
        ' ' +
        l.categories.find((c) => c.id === t.categoryId)?.name +
        ' ' +
        l.accounts.find((a) => a.id === t.accountId)?.name +
        ' ' +
        t.amount
      )
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  function changeMonth(delta: number) {
    const [y, m] = month.split('-').map(Number),
      d = new Date(Date.UTC(y, m - 1 + delta, 1));
    setMonth(d.toISOString().slice(0, 7));
    setLimit(100);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{tr('把日子，记得清清楚楚')}</p>
          <h1>{tr('日常账单')}</h1>
          <p>{tr('每笔收支有迹可循，每次转账恰如其分。')}</p>
        </div>
        <Button variant="primary" onClick={onAdd}>
          <Icon name="plus" />
          {tr('记一笔')}
        </Button>
      </div>
      <section className="panel bills-panel">
        <div className="bills-toolbar">
          <div className="month-switch">
            <IconButton name="left" label={tr('上个月')} onClick={() => changeMonth(-1)} />
            <input
              aria-label={tr('账单月份')}
              type="month"
              value={month}
              onChange={(e) => {
                if (e.target.value) setMonth(e.target.value);
              }}
            />
            <IconButton name="right" label={tr('下个月')} onClick={() => changeMonth(1)} />
          </div>
          <div className="bills-summary">
            <span>
              {tr('收入')} <b>{money(m.income, hide)}</b>
            </span>
            <span>
              {tr('支出')} <b>{money(m.expense, hide)}</b>
            </span>
            <span>
              {tr('结余')} <b>{money(m.balance, hide)}</b>
            </span>
          </div>
        </div>
        <div className="bill-filters">
          <div className="segmented">
            {[
              ['all', tr('全部')],
              ['expense', tr('支出')],
              ['income', tr('收入')],
              ['transfer', tr('转账')],
            ].map(([v, n]) => (
              <button key={v} className={type === v ? 'selected' : ''} onClick={() => setType(v)}>
                {n}
              </button>
            ))}
          </div>
          <label className="search-input">
            <Icon name="search" size={18} />
            <input
              aria-label={tr('搜索账单')}
              placeholder={tr('搜索备注、分类、金额…')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <select
            aria-label={tr('筛选分类')}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="all">{tr('全部分类')}</option>
            {l.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            aria-label={tr('筛选账户')}
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          >
            <option value="all">{tr('全部账户')}</option>
            {l.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <TransactionList ledger={l} records={records.slice(0, limit)} onEdit={onEdit} />
        {!records.length && l.transactions.length > 0 && (
          <p className="subtle no-results">{tr('当前月份或筛选条件下没有记录。')}</p>
        )}
        {records.length > limit && (
          <div className="load-more">
            <Button onClick={() => setLimit((v) => v + 100)}>
              {tr('加载更多（剩余 {count} 笔）', { count: records.length - limit })}
            </Button>
          </div>
        )}
      </section>
      <p className="page-note">
        {tr('统计时区 {timezone} · 转账本金不计入收支 · 退款冲减退款发生月份的原消费分类', {
          timezone: l.settings.timezone,
        })}
      </p>
    </>
  );
}
export function Assets({
  ledger: l,
  onAccount,
  onHolding,
  onAccountDetail,
  onHoldingDetail,
  onPlan,
  onPlanDetail,
  onToggleSmall,
}: {
  ledger: Ledger;
  onAccount: () => void;
  onHolding: () => void;
  onAccountDetail: (a: Account) => void;
  onHoldingDetail: (h: Holding) => void;
  onPlan: () => void;
  onPlanDetail: (p: Ledger['plans'][number]) => void;
  onToggleSmall: () => void;
}) {
  const [tab, setTab] = useState('all'),
    t = totals(l),
    hide = l.settings.hideAmounts;
  // Dust filter: only items with a known CNY value under ¥0.1. Unknown values stay visible
  // because they need attention; liabilities and pending subscriptions are never hidden.
  const small = (v: ReturnType<typeof D> | null) => v !== null && v.abs().lt(0.1);
  const smallAccount = (a: Account) => {
      const fx = rateFor(l, a.currency);
      return a.kind !== 'liability' && fx !== null && small(accountBalance(l, a).mul(fx));
    },
    smallHolding = (h: Holding) => holdingPosition(l, h).pending.eq(0) && small(holdingValue(l, h));
  const hideSmall = !!l.settings.hideSmall;
  const tabAccounts = l.accounts.filter(
      (a) =>
        tab === 'all' ||
        (tab === 'cash' && a.kind !== 'liability') ||
        (tab === 'liability' && a.kind === 'liability'),
    ),
    tabHoldings = l.holdings.filter((h) => tab === 'all' || h.kind === tab),
    accounts = hideSmall ? tabAccounts.filter((a) => !smallAccount(a)) : tabAccounts,
    holdings = hideSmall ? tabHoldings.filter((h) => !smallHolding(h)) : tabHoldings,
    hiddenCount = tabAccounts.length + tabHoldings.length - accounts.length - holdings.length;
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{tr('分散的资产，清晰地在一起')}</p>
          <h1>{tr('我的资产')}</h1>
          <p>{tr('账户余额与投资市值分开看，合起来更清楚。')}</p>
        </div>
        <div className="button-group">
          <Button onClick={onAccount}>
            <Icon name="plus" />
            {tr('添加账户')}
          </Button>
          <Button variant="primary" onClick={onHolding}>
            <Icon name="plus" />
            {tr('添加持仓')}
          </Button>
        </div>
      </div>
      <div className="asset-totals panel">
        <div>
          <span>{t.complete ? tr('净资产') : tr('已知净资产')}</span>
          <strong>{money(t.net, hide)}</strong>
        </div>
        <div>
          <span>{tr('总资产')}</span>
          <strong>{money(t.assets, hide)}</strong>
        </div>
        <div>
          <span>{tr('总负债')}</span>
          <strong>{money(t.liabilities, hide)}</strong>
        </div>
      </div>
      {!t.complete && (
        <Notice tone="warning">
          {tr('{items}。以上是已知部分，尚非完整资产估值。', { items: t.missing.join(tr('；')) })}
        </Notice>
      )}
      <div className="asset-tabs">
        {[
          ['all', tr('全部资产')],
          ['cash', tr('现金账户')],
          ['fund', tr('基金')],
          ['crypto', tr('OKX / 加密资产')],
          ['earn', tr('简单赚币')],
          ['other', tr('其他资产')],
          ['liability', tr('负债')],
        ].map(([k, n]) => (
          <button key={k} className={tab === k ? 'selected' : ''} onClick={() => setTab(k)}>
            {n}
          </button>
        ))}
      </div>
      <label className="checkbox-label small-toggle">
        <input type="checkbox" checked={hideSmall} onChange={onToggleSmall} />
        {tr('隐藏低于 ¥0.1 的资产')}
        {hideSmall && hiddenCount > 0 ? tr('（已隐藏 {count} 项）', { count: hiddenCount }) : ''}
      </label>
      {accounts.length > 0 && (
        <section className="asset-section">
          <div className="section-heading">
            <h2>{tab === 'liability' ? tr('负债账户') : tr('现金与账本账户')}</h2>
            <span className="subtle">{tr('期初余额 + 账本变动')}</span>
          </div>
          <div className="account-grid">
            {accounts.map((a) => {
              const bal = accountBalance(l, a),
                fx = rateFor(l, a.currency);
              return (
                <button className="account-card" key={a.id} onClick={() => onAccountDetail(a)}>
                  <div>
                    <span className={`account-icon ${a.kind}`}>
                      <Icon
                        name={
                          a.kind === 'bank' ? 'bank' : a.kind === 'liability' ? 'receipt' : 'wallet'
                        }
                        size={24}
                      />
                    </span>
                    <span className="tiny-pill">
                      {a.source === 'manual' ? tr('手动账本') : tr('外部快照')}
                    </span>
                  </div>
                  <strong>{a.name}</strong>
                  <span className="account-value">
                    {hide
                      ? '••••••'
                      : `${a.currency === 'CNY' ? '¥' : a.currency} ${D(a.kind === 'liability' ? bal.abs() : bal).toFixed(a.currency === 'CNY' ? 2 : 4)}`}
                  </span>
                  <div className="account-caption">
                    <span>
                      {a.kind === 'liability'
                        ? tr('待还余额')
                        : a.currency === 'CNY'
                          ? tr('人民币账户')
                          : fx
                            ? tr('约 {money}', { money: money(bal.mul(fx), hide) })
                            : tr('人民币换算待补充')}
                    </span>
                    <Icon name="right" size={15} />
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}
      {holdings.length > 0 && (
        <Panel
          title={tr('投资持仓')}
          aside={<span className="subtle">{tr('各资产按独立数据时间估值')}</span>}
        >
          <div className="holdings-list">
            {holdings.map((h) => {
              const p = holdingPosition(l, h),
                v = holdingValue(l, h),
                stale =
                  h.price &&
                  Date.now() - Date.parse(h.price.asOf) >
                    (h.kind === 'fund' ? 5 * 86400000 : 15 * 60000);
              return (
                <button className="holding-row" key={h.id} onClick={() => onHoldingDetail(h)}>
                  <span className={`category-icon ${h.kind === 'fund' ? 'gold' : 'blue'}`}>
                    <Icon
                      name={
                        h.kind === 'fund'
                          ? 'trend'
                          : h.kind === 'earn'
                            ? 'coins'
                            : h.kind === 'crypto'
                              ? 'btc'
                              : 'wallet'
                      }
                      size={23}
                    />
                  </span>
                  <span className="holding-copy">
                    <strong>
                      {h.name}
                      <span className="tiny-pill">{holdingLabels[h.kind]}</span>
                    </strong>
                    <span>
                      {h.symbol} · {h.location} ·{' '}
                      {h.source === 'okx' ? tr('只读快照') : tr('手动维护')}
                    </span>
                    <small>
                      {h.price
                        ? h.symbol === h.currency
                          ? tr('同币种单位价格 1 {currency}', { currency: h.currency })
                          : `${h.price.mode === 'manual' ? tr('手动价格') : h.price.navDate ? tr('正式净值 · 实验接入') : tr('官方市场价格')} · ${h.price.navDate ?? formatAt(h.price.asOf, l.settings.timezone)}${stale ? tr(' · 数据较旧') : ''}`
                        : tr('价格待补充')}
                    </small>
                  </span>
                  <span className="holding-value">
                    <strong>{v === null ? tr('估值待补充') : money(v, hide)}</strong>
                    <small>
                      {hide ? '••••' : exact(p.quantity)} {h.kind === 'fund' ? tr('份') : h.symbol}
                    </small>
                    {p.pending.gt(0) && <small>{tr('含待确认本金')}</small>}
                  </span>
                  <Icon name="right" size={16} />
                </button>
              );
            })}
          </div>
        </Panel>
      )}
      {l.holdings.some((h) => h.source === 'manual') &&
        ['all', 'fund', 'crypto', 'earn', 'other'].includes(tab) && (
          <PlansPanel ledger={l} onNew={onPlan} onOpen={onPlanDetail} />
        )}
      {!accounts.length && !holdings.length && !(hideSmall && hiddenCount) && (
        <section className="panel">
          <Empty
            icon="wallet"
            title={tab === 'all' ? tr('你的资产，值得好好打理') : tr('这个分类还没有资产')}
            description={tr('从现金账户开始，也可以录入精确的基金或加密资产持仓。')}
            action={<Button onClick={onAccount}>{tr('添加一个账户')}</Button>}
          />
        </section>
      )}
      <Notice>
        <strong>
          {tr('连接状态：')}
          {l.holdings.some((h) => h.source === 'okx') ||
          l.accounts.some((a) => a.source === 'external')
            ? tr('已保存 OKX 只读快照，后台同步未启用')
            : tr('OKX 未连接')}{' '}
          {tr('· 基金净值免费自动更新')}
        </strong>
        <br />
        {tr(
          '公共行情与私人持仓独立。xStock 产品标识和当前账号接口覆盖尚待核实，请按真实产品资料手动维护。',
        )}
      </Notice>
    </>
  );
}
export function HoldingDetail({
  ledger: l,
  holding: h,
  onPrice,
  onEdit,
  onTrade,
  onRefresh,
  onDelete,
  onDeleteEvent,
  onConfirm,
  onPlan,
  onRun,
  onDeleteRun,
}: {
  ledger: Ledger;
  holding: Holding;
  onPrice: () => void;
  onEdit: () => void;
  onTrade: () => void;
  onRefresh: () => void;
  onDelete: () => void;
  onDeleteEvent: (e: Investment) => void;
  onConfirm: (e: Investment) => void;
  onPlan: () => void;
  onRun: (r: PlanRun) => void;
  onDeleteRun: (r: PlanRun) => void;
}) {
  const p = holdingPosition(l, h),
    v = holdingValue(l, h),
    hide = l.settings.hideAmounts,
    unrealized = p.cost !== null && h.price ? p.quantity.mul(h.price.value).minus(p.cost) : null,
    cumulative = unrealized !== null && p.realized !== null ? unrealized.plus(p.realized) : null;
  const gainClass = (value: ReturnType<typeof D> | null) =>
    value === null ? '' : value.gte(0) ? 'gain' : 'loss';
  const signed = (v: ReturnType<typeof D> | null) =>
    v === null
      ? tr('暂不可计算')
      : hide
        ? '••••'
        : `${v.gte(0) ? '+' : ''}${v.toFixed(h.currency === 'CNY' ? 2 : 8)} ${h.currency}`;
  return (
    <div className="detail-body">
      <div className="detail-hero">
        <span>
          {holdingLabels[h.kind]} · {h.symbol}
        </span>
        <strong>{v === null ? tr('估值待补充') : money(v, hide)}</strong>
        <p>
          {hide ? '••••' : exact(p.quantity)} {h.kind === 'fund' ? tr('份') : h.symbol} ·{' '}
          {h.location}
        </p>
      </div>
      <div className="detail-grid">
        <div>
          <span>{tr('当前单位价格')}</span>
          <strong>
            {h.price ? (hide ? '••••' : `${h.price.value} ${h.currency}`) : tr('待补充')}
          </strong>
        </div>
        <div>
          <span>{tr('剩余持仓成本')}</span>
          <strong>
            {p.cost === null
              ? tr('成本待补充')
              : hide
                ? '••••'
                : `${p.cost.toFixed(h.currency === 'CNY' ? 2 : 8)} ${h.currency}`}
          </strong>
        </div>
        <div>
          <span>{tr('未实现收益')}</span>
          <strong className={gainClass(unrealized)}>{signed(unrealized)}</strong>
        </div>
        <div>
          <span>{tr('已实现收益（含现金分红）')}</span>
          <strong className={gainClass(p.realized)}>{signed(p.realized)}</strong>
        </div>
        <div>
          <span>{tr('持仓累计收益（原计价币种）')}</span>
          <strong className={gainClass(cumulative)}>{signed(cumulative)}</strong>
        </div>
        <div>
          <span>{tr('市场 24 小时涨跌（非持仓收益）')}</span>
          <strong className={h.price?.change24h == null ? '' : gainClass(D(h.price.change24h))}>
            {h.price?.change24h == null
              ? tr('暂无市场涨跌数据')
              : `${D(h.price.change24h).gte(0) ? '+' : ''}${D(h.price.change24h).toFixed(2)}%`}
          </strong>
        </div>
        <div>
          <span>{tr('本地记录的赚币利息')}</span>
          <strong>
            {hide ? '••••' : exact(p.interest)} {h.symbol}
          </strong>
        </div>
        <div>
          <span>{tr('待确认申购本金')}</span>
          <strong>
            {hide ? '••••' : exact(p.pending)} {h.currency}
          </strong>
        </div>
        {h.earnings !== undefined && (
          <div>
            <span>{tr('接口返回累计收益（原币）')}</span>
            <strong>
              {h.earnings === null ? tr('接口未提供') : hide ? '••••' : h.earnings + ' ' + h.symbol}
            </strong>
          </div>
        )}
      </div>
      <div className="source-box">
        <Icon name="globe" size={19} />
        <div>
          <strong>{h.price?.source ?? tr('尚无价格来源')}</strong>
          <p>
            {h.price
              ? tr('{when} · 录入 / 获取时间 {fetched}', {
                  when: h.price.navDate
                    ? tr('正式净值日 {date}（上海日期）', { date: h.price.navDate })
                    : tr('数据时间 {time}', { time: formatAt(h.price.asOf, l.settings.timezone) }),
                  fetched: formatAt(h.price.fetchedAt, l.settings.timezone),
                })
              : tr('请手动录入价格，或为支持的现货产品获取公共行情。')}
          </p>
          <p>
            {h.kind === 'fund'
              ? tr(
                  '6 位代码的公募基金可自动获取正式单位净值：000218、110020 优先基金公司官网，其余依次使用东方财富、新浪的免费公开查询。每只基金每 6 小时最多更新一次；免费来源无服务承诺。货币基金请手动记录收益。净值日与获取时间不同，当日未披露时不会补造当日价格。',
                )
              : tr('收益采用移动加权平均法，不用市场 24 小时涨跌代替持仓收益。')}
          </p>
        </div>
      </div>
      <div className="button-group wrap">
        {h.source === 'manual' && (
          <Button variant="primary" onClick={onTrade}>
            <Icon name="plus" />
            {tr('投资操作')}
          </Button>
        )}
        <Button onClick={onPrice}>{tr('更新价格')}</Button>
        {canRefreshPrice(h) && (
          <Button onClick={onRefresh}>
            <Icon name="refresh" />
            {h.kind === 'fund' ? tr('获取正式净值') : tr('获取行情')}
          </Button>
        )}
        {h.source === 'manual' && (
          <Button onClick={onPlan}>
            <Icon name="calendar" />
            {tr('定投')}
          </Button>
        )}
        {h.source === 'manual' && <Button onClick={onEdit}>{tr('编辑期初持仓')}</Button>}
      </div>
      <h3 className="detail-subheading">{tr('投资记录')}</h3>
      {l.investments.filter((e) => e.holdingId === h.id).length ? (
        <div>
          {l.investments
            .filter((e) => e.holdingId === h.id)
            .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
            .map((e) => (
              <div className="investment-row" key={e.id}>
                <div>
                  <strong>
                    {
                      {
                        buy: tr('申购 / 买入'),
                        sell: tr('赎回 / 卖出'),
                        dividend: tr('现金分红'),
                        adjust: tr('份额调整'),
                        interest: tr('赚币利息'),
                      }[e.kind]
                    }{' '}
                    <span className="tiny-pill">
                      {e.status === 'pending' ? tr('待确认') : tr('已确认')}
                    </span>
                  </strong>
                  <p>
                    {formatAt(e.occurredAt, l.settings.timezone)} · {hide ? '••••' : e.quantity}{' '}
                    {tr('份')} · {hide ? '••••' : e.cash} {h.currency}
                  </p>
                  {e.note && <p>{e.note}</p>}
                </div>
                <div className="button-group">
                  {e.status === 'pending' && (
                    <Button variant="text" onClick={() => onConfirm(e)}>
                      {tr('确认成交')}
                    </Button>
                  )}
                  <IconButton
                    name="trash"
                    label={tr('删除投资记录')}
                    onClick={() => onDeleteEvent(e)}
                  />
                </div>
              </div>
            ))}
        </div>
      ) : (
        <p className="subtle">{tr('尚无投资交易记录，期初持仓不会生成虚假交易。')}</p>
      )}
      {l.planRuns.some(
        (r) => r.targetId === h.id || (r.sourceType === 'holding' && r.sourceId === h.id),
      ) && (
        <>
          <h3 className="detail-subheading">{tr('定投记录')}</h3>
          <RunList
            ledger={l}
            runs={l.planRuns.filter(
              (r) => r.targetId === h.id || (r.sourceType === 'holding' && r.sourceId === h.id),
            )}
            onRun={onRun}
            onDelete={onDeleteRun}
          />
        </>
      )}
      <div className="detail-danger">
        <Button variant="text" onClick={onDelete}>
          <Icon name="trash" size={17} />
          {tr('删除持仓')}
        </Button>
      </div>
    </div>
  );
}
