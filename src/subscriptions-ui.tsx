import { useState } from 'react';
import { D, dayIn, money, subscriptionCycles, uid, type Ledger, type Subscription } from './domain';
import { type Commit } from './forms';
import {
  SUBSCRIPTION_CATEGORY,
  billingTimes,
  monthlyEquivalent,
  monthlyTotal,
  nextBilling,
} from './subscriptions';
import { Button, Empty, ErrorText, Field, Icon, Notice, Panel, humanError } from './ui';

const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const presets = [
  'iCloud+',
  'Apple Music',
  'ChatGPT Plus',
  'Claude Pro',
  'Netflix',
  'Spotify',
  'YouTube Premium',
  'B站大会员',
  '腾讯视频',
  '爱奇艺',
  '网易云音乐',
  'QQ音乐',
];
const cycleUnit = { monthly: '月', yearly: '年', weekly: '周' } as const;
export function billingText(s: Subscription) {
  if (s.cycle === 'weekly') return `每${weekdays[(s.weekday ?? 1) - 1]}`;
  const day = `${s.day} 日${(s.day ?? 1) > 28 ? '（小月取月末）' : ''}`;
  return s.cycle === 'yearly' ? `每年 ${s.month} 月 ${day}` : `每月 ${day}`;
}
// Stable soft colour per name, so each service keeps its own monogram tint.
function tint(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) % 360;
  return `hsl(${h} 62% 40%)`;
}
function dueText(next: number | null, tz: string) {
  if (next === null) return { text: '无后续扣款', soon: false };
  const today = dayIn(new Date(), tz),
    day = dayIn(new Date(next), tz),
    days = Math.round((Date.parse(day) - Date.parse(today)) / 86400000);
  if (days <= 0) return { text: '今天扣款', soon: true };
  if (days === 1) return { text: '明天扣款', soon: true };
  if (days <= 3) return { text: `${days} 天后扣款`, soon: true };
  return { text: `下次 ${day.slice(5).replace('-', '/')}`, soon: false };
}

export function SubscriptionsPanel({
  ledger: l,
  onOpen,
}: {
  ledger: Ledger;
  onOpen: (s?: Subscription) => void;
}) {
  const hide = l.settings.hideAmounts,
    { total, missing } = monthlyTotal(l);
  const list = [...l.subscriptions].sort(
    (a, b) =>
      Number(b.active) - Number(a.active) ||
      (nextBilling(a) ?? Infinity) - (nextBilling(b) ?? Infinity),
  );
  return (
    <Panel
      title="订阅"
      className="subscriptions-panel"
      aside={
        <div className="button-group">
          {l.subscriptions.some((s) => s.active) && (
            <span className="subtle">每月约 {money(total, hide)}</span>
          )}
          <Button variant="text" onClick={() => onOpen()}>
            <Icon name="plus" size={16} />
            添加订阅
          </Button>
        </div>
      }
    >
      {list.length ? (
        <div className="subscription-list">
          {list.map((s) => {
            const a = l.accounts.find((x) => x.id === s.accountId),
              due = dueText(nextBilling(s), s.timezone);
            return (
              <button
                key={s.id}
                className={`subscription-item ${s.active ? '' : 'paused'}`}
                onClick={() => onOpen(s)}
              >
                <span className="subscription-mark" style={{ background: tint(s.name) }}>
                  {[...s.name][0]?.toUpperCase()}
                </span>
                <span className="subscription-copy">
                  <strong>
                    {s.name}
                    {!s.active && <span className="tiny-pill">已暂停</span>}
                  </strong>
                  <span>
                    {billingText(s)} · {a?.name ?? '账户已删除'}
                  </span>
                </span>
                <span className="subscription-value">
                  <strong>
                    {hide
                      ? '••••'
                      : `${a?.currency === 'CNY' ? '¥' : (a?.currency ?? '') + ' '}${D(s.amount).toFixed(2)}`}
                    <small>/{cycleUnit[s.cycle]}</small>
                  </strong>
                  {s.active && <small className={due.soon ? 'due-soon' : ''}>{due.text}</small>}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <Empty
          icon="calendar"
          title="还没有订阅"
          description="记下每月固定扣费的软件和会员，到扣款日自动从设定账户记一笔支出。"
          action={<Button onClick={() => onOpen()}>添加订阅</Button>}
        />
      )}
      {missing.length > 0 && (
        <p className="subtle subscriptions-note">
          {missing.join('、')} 账户缺少人民币汇率，未计入每月合计，且到期时会暂缓扣款。
        </p>
      )}
    </Panel>
  );
}

export function SubscriptionForm({
  ledger: l,
  record,
  onSave,
  onClose,
  notify,
}: {
  ledger: Ledger;
  record?: Subscription;
  onSave: Commit;
  onClose: () => void;
  notify: (s: string) => void;
}) {
  const today = dayIn(new Date(), l.settings.timezone),
    accounts = l.accounts.filter((a) => a.source === 'manual'),
    categories = [
      ...l.categories.filter((c) => c.kind === 'expense'),
      ...(l.categories.some((c) => c.id === SUBSCRIPTION_CATEGORY.id)
        ? []
        : [SUBSCRIPTION_CATEGORY]),
    ];
  const [name, setName] = useState(record?.name ?? ''),
    [amount, setAmount] = useState(record?.amount ?? ''),
    [accountId, setAccount] = useState(record?.accountId ?? accounts[0]?.id ?? ''),
    [categoryId, setCategory] = useState(record?.categoryId ?? SUBSCRIPTION_CATEGORY.id),
    [cycle, setCycle] = useState<Subscription['cycle']>(record?.cycle ?? 'monthly'),
    [day, setDay] = useState(record?.day ?? Number(today.slice(8))),
    [month, setMonth] = useState(record?.month ?? Number(today.slice(5, 7))),
    [weekday, setWeekday] = useState(
      record?.weekday ?? (new Date(today + 'T00:00:00Z').getUTCDay() || 7),
    ),
    [startDate, setStart] = useState(record?.startDate ?? today),
    [endDate, setEnd] = useState(record?.endDate ?? ''),
    [note, setNote] = useState(record?.note ?? ''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const account = accounts.find((a) => a.id === accountId);
  const draft: Subscription = {
    id: record?.id ?? 'draft',
    name: name.trim() || '订阅',
    amount: /^\d+(\.\d+)?$/.test(amount) && D(amount).gt(0) ? amount : '1',
    accountId,
    categoryId,
    cycle,
    day: cycle === 'weekly' ? undefined : day,
    month: cycle === 'yearly' ? month : undefined,
    weekday: cycle === 'weekly' ? weekday : undefined,
    startDate,
    endDate: endDate || undefined,
    active: record?.active ?? true,
    timezone: record?.timezone ?? l.settings.timezone,
    cursor: record?.cursor,
    note,
    createdAt: record?.createdAt ?? new Date().toISOString(),
  };
  const backfill = record ? 0 : billingTimes(draft, null, Date.now()).length,
    paid = record ? l.transactions.filter((t) => t.subscriptionId === record.id) : [];
  async function save(next: Subscription, message?: string) {
    setError('');
    setBusy(true);
    try {
      await onSave((s) => ({
        ...s,
        categories: s.categories.some((c) => c.id === next.categoryId)
          ? s.categories
          : [...s.categories, SUBSCRIPTION_CATEGORY],
        subscriptions: [...s.subscriptions.filter((x) => x.id !== next.id), next],
      }));
      if (message) notify(message);
      onClose();
    } catch (e) {
      setError(humanError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return setError('请填写订阅名称');
        if (!/^\d+(\.\d+)?$/.test(amount.trim()) || !D(amount.trim()).gt(0))
          return setError('请填写大于零的金额');
        void save({ ...draft, id: record?.id ?? uid(), name: name.trim(), amount: amount.trim() });
      }}
    >
      {!record && (
        <div className="suggestions">
          <span>常见订阅</span>
          {presets.map((p) => (
            <button type="button" key={p} onClick={() => setName(p)}>
              {p}
            </button>
          ))}
        </div>
      )}
      <div className="form-grid">
        <Field label="名称">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
        </Field>
        <Field label="扣款账户">
          <select value={accountId} onChange={(e) => setAccount(e.target.value)} required>
            <option value="" disabled>
              请选择手动维护的账户
            </option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}（{a.currency}）
              </option>
            ))}
          </select>
        </Field>
        <Field label={`每期金额（${account?.currency ?? '账户币种'}）`}>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            required
          />
        </Field>
        <Field label="扣费周期">
          <select value={cycle} onChange={(e) => setCycle(e.target.value as Subscription['cycle'])}>
            {Object.entries(subscriptionCycles).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        {cycle === 'yearly' && (
          <Field label="扣款月份">
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>
                  {m} 月
                </option>
              ))}
            </select>
          </Field>
        )}
        {cycle === 'weekly' ? (
          <Field label="扣款星期">
            <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
              {weekdays.map((w, i) => (
                <option key={w} value={i + 1}>
                  {w}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label="扣款日">
            <select value={day} onChange={(e) => setDay(Number(e.target.value))}>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d} 日{d > 28 ? '（小月取月末）' : ''}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="支出分类">
          <select value={categoryId} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="开始日期" hint="从这天起的扣款日开始自动扣费">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStart(e.target.value)}
            required
          />
        </Field>
        <Field label="结束日期（选填）" hint="到期不再续订时填写">
          <input type="date" value={endDate} onChange={(e) => setEnd(e.target.value)} />
        </Field>
        <Field label="备注（选填）">
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
        </Field>
      </div>
      <Notice>
        每到扣款日，打开网站时会自动从「{account?.name ?? '扣款账户'}」记一笔支出
        {account && account.currency !== 'CNY' ? '，按当时的人民币汇率计入消费统计' : ''}
        ，计入当月消费和预算。约合每月 {money(monthlyEquivalent(draft), false, false)}{' '}
        {account?.currency ?? ''}。
      </Notice>
      {backfill > 0 && (
        <Notice tone="warning">
          开始日期早于今天：保存后会补记从 {startDate} 起已到期的 {backfill}{' '}
          笔扣款。如果这些扣款已经手动记过账，请把开始日期改成下一次扣款日。
        </Notice>
      )}
      {record && (
        <p className="form-footnote">
          已自动扣款 {paid.length} 笔
          {paid.length
            ? `，共 ${money(
                paid.reduce((v, t) => v.plus(t.amount), D(0)),
                l.settings.hideAmounts,
                false,
              )} ${account?.currency ?? ''}`
            : ''}
          。修改只影响以后的扣款，已记的账单可在账单页修改或删除。
        </p>
      )}
      <ErrorText error={error} />
      <div className="form-actions">
        {record && (
          <>
            <Button
              disabled={busy}
              onClick={() =>
                save(
                  // Resuming continues from now; periods while paused are not charged.
                  {
                    ...record,
                    active: !record.active,
                    cursor: record.active ? record.cursor : new Date().toISOString(),
                  },
                  record.active ? '订阅已暂停，不再自动扣款' : '订阅已恢复，从下一个扣款日开始扣款',
                )
              }
            >
              {record.active ? '暂停' : '恢复'}
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                if (!confirm(`删除「${record.name}」订阅？已经记下的扣款账单会保留。`)) return;
                setBusy(true);
                onSave((s) => ({
                  ...s,
                  subscriptions: s.subscriptions.filter((x) => x.id !== record.id),
                }))
                  .then(() => {
                    notify('订阅已删除，已记的扣款账单保留');
                    onClose();
                  })
                  .catch((e) => setError(humanError(e)))
                  .finally(() => setBusy(false));
              }}
            >
              删除
            </Button>
          </>
        )}
        <Button onClick={onClose}>取消</Button>
        <Button type="submit" variant="primary" disabled={busy || !accounts.length}>
          保存订阅
        </Button>
      </div>
    </form>
  );
}
