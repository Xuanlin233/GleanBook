import { useState } from 'react';
import {
  D,
  dayIn,
  exact,
  planEnds,
  planFrequencies,
  rateFor,
  uid,
  type Holding,
  type Ledger,
  type Plan,
  type PlanRun,
} from './domain';
import { type Commit } from './forms';
import { autoPriced, cachedCalendar, holidayPublished, nextOccurrence, runFx } from './plans';
import { formatAt } from './pages';
import { Button, Empty, ErrorText, Field, Icon, IconButton, Notice, Panel, humanError } from './ui';
import { tr } from './i18n';

const weekdays = [
  tr('周一'),
  tr('周二'),
  tr('周三'),
  tr('周四'),
  tr('周五'),
  tr('周六'),
  tr('周日'),
];
const unitOf = (h: Holding) => (h.kind === 'fund' ? tr('份') : h.symbol);
const hidden = (l: Ledger, v: string) => (l.settings.hideAmounts ? '••••' : v);
const round = (v: string | undefined, places = 8) =>
  v === undefined ? '—' : D(v).toDecimalPlaces(places).toFixed();

export function scheduleText(p: Plan) {
  const when =
    p.frequency === 'weekly'
      ? tr('每{weekday}', { weekday: weekdays[(p.weekday ?? 1) - 1] })
      : p.frequency === 'biweekly'
        ? tr('每两周的{weekday}', { weekday: weekdays[(p.weekday ?? 1) - 1] })
        : p.frequency === 'monthly'
          ? p.monthDay! > 28
            ? tr('每月 {day} 日（小月取月末）', { day: p.monthDay })
            : tr('每月 {day} 日', { day: p.monthDay })
          : planFrequencies[p.frequency];
  return `${when} ${p.time}${p.skipHolidays ? tr(' · 节假日不扣款') : ''}`;
}
// No next period: either the plan ended, or a holiday-skipping plan awaits next year's notice.
function noNextText(p: Plan) {
  if (!p.active) return tr('已暂停');
  const year = new Date().getFullYear();
  if (p.skipHolidays && (!p.endDate || p.endDate > `${year}-12-31`) && !holidayPublished(year + 1))
    return tr('等待 {year} 年节假日安排公布', { year: year + 1 });
  return tr('无后续期数');
}
export function amountText(l: Ledger, p: Plan) {
  const target = l.holdings.find((h) => h.id === p.targetId);
  return p.mode === 'amount'
    ? tr('定额 {amount} {amountCurrency}', { amount: p.amount, amountCurrency: p.amountCurrency })
    : tr('定份额 {amount} {unit}', { amount: p.amount, unit: target ? unitOf(target) : '' });
}
function endsText(l: Ledger, p: Plan | PlanRun) {
  try {
    const { target, sourceName } = planEnds(l, p);
    return `${sourceName} → ${target.name}`;
  } catch {
    return tr('来源或去向已不存在');
  }
}

export function PlansPanel({
  ledger: l,
  onNew,
  onOpen,
}: {
  ledger: Ledger;
  onNew: () => void;
  onOpen: (p: Plan) => void;
}) {
  return (
    <Panel
      title={tr('定投计划')}
      aside={
        <Button variant="text" onClick={onNew}>
          <Icon name="plus" size={17} />
          {tr('新建定投')}
        </Button>
      }
    >
      {l.plans.length ? (
        <div className="holdings-list">
          {l.plans.map((p) => {
            const runs = l.planRuns.filter((r) => r.planId === p.id),
              waiting = runs.filter((r) => r.status === 'pending').length,
              next = nextOccurrence(p, Date.now(), cachedCalendar);
            return (
              <button className="holding-row" key={p.id} onClick={() => onOpen(p)}>
                <span className="category-icon blue">
                  <Icon name="calendar" size={23} />
                </span>
                <span className="holding-copy">
                  <strong>
                    {p.name}
                    <span className="tiny-pill">{p.active ? tr('执行中') : tr('已暂停')}</span>
                  </strong>
                  <span>{endsText(l, p)}</span>
                  <small>
                    {scheduleText(p)} · {amountText(l, p)}
                  </small>
                </span>
                <span className="holding-value">
                  <strong>{tr('{count} 期已入账', { count: runs.length - waiting })}</strong>
                  {waiting > 0 && <small>{tr('{count} 期待处理', { count: waiting })}</small>}
                  <small>
                    {next
                      ? tr('下次 {time}', {
                          time: formatAt(new Date(next).toISOString(), p.timezone),
                        })
                      : noNextText(p)}
                  </small>
                </span>
                <Icon name="right" size={16} />
              </button>
            );
          })}
        </div>
      ) : (
        <Empty
          icon="calendar"
          title={tr('还没有定投计划')}
          description={tr('设定来源账户或持仓、去向持仓和频率，打开网站时自动按当期价格入账。')}
          action={<Button onClick={onNew}>{tr('新建定投')}</Button>}
        />
      )}
    </Panel>
  );
}

export function PlanForm({
  ledger: l,
  record,
  targetId: presetTarget,
  onSave,
  onClose,
}: {
  ledger: Ledger;
  record?: Plan;
  targetId?: string;
  onSave: Commit;
  onClose: () => void;
}) {
  const sources = [
    ...l.accounts
      .filter((a) => a.source === 'manual' && a.kind !== 'liability')
      .map((a) => ({
        key: 'account:' + a.id,
        name: tr('{name}（{currency} 账户）', { name: a.name, currency: a.currency }),
        currency: a.currency,
      })),
    ...l.holdings
      .filter((h) => h.source === 'manual')
      .map((h) => ({
        key: 'holding:' + h.id,
        name: tr('{name}（持仓 · {currency}）', { name: h.name, currency: h.currency }),
        currency: h.currency,
      })),
  ];
  const today = dayIn(new Date(), l.settings.timezone);
  const [source, setSource] = useState(
      record ? `${record.sourceType}:${record.sourceId}` : (sources[0]?.key ?? ''),
    ),
    [targetId, setTarget] = useState(
      record?.targetId ?? presetTarget ?? l.holdings.find((h) => h.source === 'manual')?.id ?? '',
    ),
    [name, setName] = useState(record?.name ?? ''),
    [mode, setMode] = useState<Plan['mode']>(record?.mode ?? 'amount'),
    [amount, setAmount] = useState(record?.amount ?? ''),
    [amountCurrency, setAmountCurrency] = useState<string>(record?.amountCurrency ?? ''),
    [feeRate, setFeeRate] = useState(record?.feeRate ?? '0'),
    [frequency, setFrequency] = useState<Plan['frequency']>(record?.frequency ?? 'monthly'),
    [weekday, setWeekday] = useState(record?.weekday ?? 1),
    [monthDay, setMonthDay] = useState(record?.monthDay ?? Number(today.slice(8))),
    [time, setTime] = useState(record?.time ?? '09:30'),
    [startDate, setStart] = useState(record?.startDate ?? today),
    [endDate, setEnd] = useState(record?.endDate ?? ''),
    [skipHolidays, setSkip] = useState(record?.skipHolidays ?? false),
    [note, setNote] = useState(record?.note ?? ''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [sourceType, sourceId] = source.split(':') as [Plan['sourceType'], string];
  const sourceCurrency = sources.find((s) => s.key === source)?.currency,
    target = l.holdings.find((h) => h.id === targetId),
    targets = l.holdings.filter(
      (h) => h.source === 'manual' && !(sourceType === 'holding' && h.id === sourceId),
    );
  const currencyChoices = [
    ...new Set([sourceCurrency, target?.currency].filter(Boolean)),
  ] as string[];
  const moneyCurrency = currencyChoices.includes(amountCurrency)
    ? amountCurrency
    : currencyChoices[0];
  const fx = sourceCurrency && target ? runFx(l, sourceCurrency, target.currency) : null;
  const missingRates =
    sourceCurrency && target && !fx
      ? [sourceCurrency, target.currency].filter((c) => !rateFor(l, c))
      : [];
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        setError('');
        setBusy(true);
        try {
          if (!target) throw new Error(tr('请选择定投去向持仓'));
          const plan: Plan = {
            id: record?.id ?? uid(),
            name: name.trim() || tr('{name} 定投', { name: target.name }),
            sourceType,
            sourceId,
            targetId,
            mode,
            amount: amount.trim(),
            amountCurrency: (mode === 'amount'
              ? moneyCurrency
              : target.currency) as Plan['amountCurrency'],
            feeRate: feeRate.trim() || '0',
            frequency,
            weekday: ['weekly', 'biweekly'].includes(frequency) ? weekday : undefined,
            monthDay: frequency === 'monthly' ? monthDay : undefined,
            time,
            timezone: record?.timezone ?? l.settings.timezone,
            startDate,
            endDate: endDate || undefined,
            skipHolidays: skipHolidays || undefined,
            active: record?.active ?? true,
            cursor: record?.cursor,
            createdAt: record?.createdAt ?? new Date().toISOString(),
            note,
          };
          await onSave((s) => ({
            ...s,
            plans: [...s.plans.filter((p) => p.id !== plan.id), plan],
          }));
          onClose();
        } catch (e) {
          setError(humanError(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="form-grid">
        <Field label={tr('资金来源（账户或持仓）')}>
          <select value={source} onChange={(e) => setSource(e.target.value)} required>
            <option value="" disabled>
              {tr('请选择手动维护的账户或持仓')}
            </option>
            {sources.map((s) => (
              <option key={s.key} value={s.key}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={tr('定投去向（持仓）')}>
          <select value={targetId} onChange={(e) => setTarget(e.target.value)} required>
            <option value="" disabled>
              {tr('请选择手动维护的持仓')}
            </option>
            {targets.map((h) => (
              <option key={h.id} value={h.id}>
                {tr('{name}（{symbol} · {currency}）', {
                  name: h.name,
                  symbol: h.symbol,
                  currency: h.currency,
                })}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="segmented type-switch">
        {(
          [
            ['amount', tr('定额：每期固定金额')],
            ['quantity', tr('定份额：每期固定数量')],
          ] as const
        ).map(([k, label]) => (
          <button
            type="button"
            key={k}
            className={mode === k ? 'selected' : ''}
            onClick={() => setMode(k)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="form-grid">
        <Field
          label={
            mode === 'amount'
              ? tr('每期金额')
              : tr('每期买入数量（{unit}）', { unit: target ? unitOf(target) : tr('单位') })
          }
          hint={mode === 'amount' ? tr('含手续费的总扣款') : tr('手续费另计，按当期价格折算扣款')}
        >
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </Field>
        {mode === 'amount' ? (
          <Field
            label={tr('金额币种')}
            hint={currencyChoices.length > 1 ? tr('可按来源或去向币种计') : undefined}
          >
            <select value={moneyCurrency ?? ''} onChange={(e) => setAmountCurrency(e.target.value)}>
              {currencyChoices.map((c) => (
                <option key={c} value={c}>
                  {c}
                  {c === sourceCurrency ? tr('（来源币种）') : tr('（去向币种）')}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label={tr('计价币种')}>
            <input value={target?.currency ?? ''} disabled />
          </Field>
        )}
        <Field label={tr('手续费率（%）')} hint={tr('外扣法：净额 = 金额 ÷ (1 + 费率)')}>
          <input inputMode="decimal" value={feeRate} onChange={(e) => setFeeRate(e.target.value)} />
        </Field>
        <Field label={tr('频率')}>
          <select
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as Plan['frequency'])}
          >
            {Object.entries(planFrequencies).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        {['weekly', 'biweekly'].includes(frequency) && (
          <Field label={tr('星期')}>
            <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
              {weekdays.map((w, i) => (
                <option key={w} value={i + 1}>
                  {w}
                </option>
              ))}
            </select>
          </Field>
        )}
        {frequency === 'monthly' && (
          <Field label={tr('每月日期')}>
            <select value={monthDay} onChange={(e) => setMonthDay(Number(e.target.value))}>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {tr('{d} 日', { d })}
                  {d > 28 ? tr('（小月取月末）') : ''}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field
          label={tr('执行时间（{timezone}）', {
            timezone: record?.timezone ?? l.settings.timezone,
          })}
          hint={tr('精确到分钟')}
        >
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
        </Field>
        <Field label={tr('开始日期')}>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStart(e.target.value)}
            required
          />
        </Field>
        <Field label={tr('结束日期（选填）')}>
          <input type="date" value={endDate} onChange={(e) => setEnd(e.target.value)} />
        </Field>
        <Field label={tr('计划名称（选填）')}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            placeholder={target ? tr('{name} 定投', { name: target.name }) : ''}
          />
        </Field>
      </div>
      <Field label={tr('备注')}>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </Field>
      <label className="checkbox-label">
        <input type="checkbox" checked={skipHolidays} onChange={(e) => setSkip(e.target.checked)} />
        {tr('节假日不扣款：执行日是周末或法定节假日（沪深交易所休市日）时跳过这一期，不顺延')}
      </label>
      {skipHolidays && ['weekly', 'biweekly'].includes(frequency) && weekday >= 6 && (
        <Notice tone="warning">
          {tr('所选星期是周末，开启“节假日不扣款”后这个计划永远不会执行。')}
        </Notice>
      )}
      {skipHolidays && (
        <p className="form-footnote">
          {tr(
            '节假日依据国务院放假通知（holiday-cn 公开数据）。下一年的安排通常在 11–12 月公布，公布前该年工作日的期数会暂缓生成，公布后自动补上。',
          )}
        </p>
      )}
      {target && (
        <Notice>
          {target.kind === 'fund' && autoPriced(target)
            ? skipHolidays
              ? tr(
                  '基金按正式净值成交：15:00 前下单用当日净值，15:00 及以后用下一交易日净值；净值公布前显示“待处理”，公布后自动算出份额。',
                )
              : tr(
                  '基金按正式净值成交：15:00 前下单用当日净值，15:00 及以后用下一交易日净值，执行日是节假日时顺延到下一交易日；净值公布前显示“待处理”，公布后自动算出份额。',
                )
            : autoPriced(target) && target.symbol !== target.currency
              ? tr('按 OKX {symbol}-USDT 在执行时间那一分钟的开盘价成交，每期独立取价。', {
                  symbol: target.symbol,
                })
              : autoPriced(target)
                ? tr('同币种单位价格 1 {currency}。', { currency: target.currency })
                : tr('此资产无法自动取得历史价格，每期需要在记录中手动确认成交数量和金额。')}
          {mode === 'amount' && sourceType === 'account'
            ? tr(' 定额且来源为账户时，到期即从账户扣款，份额确定前计为待确认本金。')
            : tr(' 价格确定后才同时扣减来源、增加去向。')}
        </Notice>
      )}
      {!record && startDate < today && (
        <Notice tone="warning">
          {tr(
            '开始日期早于今天：保存后会按计划补记从 {startDate} 起每一期，并按各期当时的价格结算。',
            { startDate },
          )}
        </Notice>
      )}
      {missingRates.length > 0 && (
        <Notice tone="warning">
          {tr(
            '来源与去向币种不同，缺少 {currencies}/CNY 汇率。请到 设置 → 汇率与统计 补充，否则各期无法结算。结算时会锁定当时的汇率。',
            { currencies: missingRates.join(tr('、')) },
          )}
        </Notice>
      )}
      {record && (
        <p className="form-footnote">{tr('修改只影响以后生成的期数，已生成的记录保留原条款。')}</p>
      )}
      <ErrorText error={error} />
      <div className="form-actions">
        <Button onClick={onClose}>{tr('取消')}</Button>
        <Button
          type="submit"
          variant="primary"
          disabled={busy || !sources.length || !targets.length}
        >
          {tr('保存定投计划')}
        </Button>
      </div>
    </form>
  );
}

export function RunList({
  ledger: l,
  runs,
  onRun,
  onDelete,
}: {
  ledger: Ledger;
  runs: PlanRun[];
  onRun: (r: PlanRun) => void;
  onDelete: (r: PlanRun) => void;
}) {
  if (!runs.length) return <p className="subtle">{tr('尚无到期的定投记录。')}</p>;
  return (
    <div>
      {[...runs]
        .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt))
        .slice(0, 200)
        .map((r) => {
          let unit = '',
            sourceUnit = '';
          try {
            const { target, sourceCurrency } = planEnds(l, r);
            unit = unitOf(target);
            sourceUnit =
              r.sourceType === 'holding'
                ? unitOf(l.holdings.find((h) => h.id === r.sourceId)!)
                : sourceCurrency;
          } catch {
            /* reference removed */
          }
          return (
            <div className="investment-row" key={r.id}>
              <div>
                <strong>
                  {r.planName}{' '}
                  <span className="tiny-pill">
                    {r.status === 'confirmed'
                      ? r.manual
                        ? tr('手动确认')
                        : tr('已入账')
                      : tr('待处理')}
                  </span>
                </strong>
                <p>
                  {formatAt(r.scheduledAt, l.settings.timezone)} ·{' '}
                  {r.status === 'confirmed'
                    ? tr('扣 {paid} {sourceUnit} → 买入 {bought} {unit}', {
                        paid: hidden(l, round(r.sourceAmount)),
                        sourceUnit,
                        bought: hidden(l, round(r.targetQuantity)),
                        unit,
                      }) + (r.targetPrice ? ' @ ' + round(r.targetPrice) : '')
                    : r.mode === 'amount'
                      ? tr('定额 {amount} {amountCurrency}', {
                          amount: r.amount,
                          amountCurrency: r.amountCurrency,
                        }) + (r.sourceAmount ? tr(' · 已预扣款') : '')
                      : tr('定份额 {amount} {unit}', { amount: r.amount, unit })}
                </p>
                {r.status === 'confirmed' && r.fee !== undefined && D(r.fee).gt(0) && (
                  <p>
                    {tr('手续费 {fee} · 含费成本 {cost}', {
                      fee: hidden(l, round(r.fee)),
                      cost: hidden(l, round(r.targetCost)),
                    })}
                  </p>
                )}
                {r.priceNote && <p>{r.priceNote}</p>}
                {r.waiting && r.status === 'pending' && <p>{r.waiting}</p>}
              </div>
              <div className="button-group">
                <Button variant="text" onClick={() => onRun(r)}>
                  {r.status === 'pending' ? tr('手动确认') : tr('修改')}
                </Button>
                <IconButton
                  name="trash"
                  label={tr('删除这期定投记录')}
                  onClick={() => onDelete(r)}
                />
              </div>
            </div>
          );
        })}
    </div>
  );
}

export function PlanDetail({
  ledger: l,
  plan: p,
  onEdit,
  onSave,
  onClose,
  onRun,
  onDeleteRun,
  notify,
}: {
  ledger: Ledger;
  plan: Plan;
  onEdit: () => void;
  onSave: Commit;
  onClose: () => void;
  onRun: (r: PlanRun) => void;
  onDeleteRun: (r: PlanRun) => void;
  notify: (s: string) => void;
}) {
  const runs = l.planRuns.filter((r) => r.planId === p.id),
    done = runs.filter((r) => r.status === 'confirmed'),
    next = nextOccurrence(p, Date.now(), cachedCalendar);
  let unit = '',
    sourceUnit = '',
    broken = '';
  try {
    const { target, sourceCurrency } = planEnds(l, p);
    unit = unitOf(target);
    sourceUnit =
      p.sourceType === 'holding'
        ? unitOf(l.holdings.find((h) => h.id === p.sourceId)!)
        : sourceCurrency;
  } catch (e) {
    broken = humanError(e);
  }
  const sum = (k: 'sourceAmount' | 'targetQuantity') =>
    exact(done.reduce((v, r) => v.plus(r[k] ?? '0'), D(0)));
  return (
    <div className="detail-body">
      <div className="detail-hero">
        <span>
          {p.active ? tr('执行中') : tr('已暂停')} · {scheduleText(p)}
        </span>
        <strong>{amountText(l, p)}</strong>
        <p>{endsText(l, p)}</p>
      </div>
      {broken && <Notice tone="warning">{broken}</Notice>}
      <div className="detail-grid">
        <div>
          <span>{tr('下次执行')}</span>
          <strong>
            {next ? formatAt(new Date(next).toISOString(), p.timezone) : noNextText(p)}
          </strong>
        </div>
        <div>
          <span>{tr('已入账期数')}</span>
          <strong>
            {tr('{count} 期', { count: done.length })}
            {runs.length > done.length
              ? tr(' · {count} 期待处理', { count: runs.length - done.length })
              : ''}
          </strong>
        </div>
        <div>
          <span>{tr('累计扣减来源')}</span>
          <strong>
            {hidden(l, sum('sourceAmount'))} {sourceUnit}
          </strong>
        </div>
        <div>
          <span>{tr('累计买入')}</span>
          <strong>
            {hidden(l, sum('targetQuantity'))} {unit}
          </strong>
        </div>
        <div>
          <span>{tr('手续费率')}</span>
          <strong>{p.feeRate}%</strong>
        </div>
        <div>
          <span>{tr('期间')}</span>
          <strong>
            {tr('{startDate} 起', { startDate: p.startDate })}
            {p.endDate ? tr(' 至 {endDate}', { endDate: p.endDate }) : ''}
          </strong>
        </div>
      </div>
      {p.note && <p className="subtle">{p.note}</p>}
      <div className="button-group wrap">
        <Button variant="primary" onClick={onEdit}>
          <Icon name="edit" />
          {tr('编辑计划')}
        </Button>
        <Button
          onClick={() =>
            onSave((s) => ({
              ...s,
              plans: s.plans.map((x) =>
                x.id === p.id
                  ? // Resuming continues from now; periods while paused are not back-filled.
                    {
                      ...x,
                      active: !x.active,
                      cursor: x.active ? x.cursor : new Date().toISOString(),
                    }
                  : x,
              ),
            }))
              .then(() =>
                notify(p.active ? tr('定投已暂停') : tr('定投已恢复，从现在开始，不补记暂停期间')),
              )
              .catch((e) => notify(humanError(e)))
          }
        >
          {p.active ? tr('暂停') : tr('恢复')}
        </Button>
      </div>
      <h3 className="detail-subheading">{tr('执行记录')}</h3>
      <RunList ledger={l} runs={runs} onRun={onRun} onDelete={onDeleteRun} />
      <div className="detail-danger">
        <Button
          variant="text"
          onClick={() => {
            if (
              !confirm(
                tr('删除此定投计划？已入账的记录会保留，待处理的期数会一并删除并退回预扣款。'),
              )
            )
              return;
            onSave((s) => ({
              ...s,
              plans: s.plans.filter((x) => x.id !== p.id),
              planRuns: s.planRuns.filter((r) => r.planId !== p.id || r.status === 'confirmed'),
            }))
              .then(() => {
                onClose();
                notify(tr('定投计划已删除，已入账记录保留'));
              })
              .catch((e) => notify(humanError(e)));
          }}
        >
          <Icon name="trash" size={17} />
          {tr('删除计划')}
        </Button>
      </div>
    </div>
  );
}

export function RunForm({
  ledger: l,
  run,
  onSave,
  onClose,
}: {
  ledger: Ledger;
  run: PlanRun;
  onSave: Commit;
  onClose: () => void;
}) {
  const { target, sourceCurrency } = planEnds(l, run);
  const source =
    run.sourceType === 'holding' ? l.holdings.find((h) => h.id === run.sourceId)! : null;
  const [quantity, setQuantity] = useState(
      run.targetQuantity ?? (run.mode === 'quantity' ? run.amount : ''),
    ),
    [cost, setCost] = useState(
      run.targetCost ??
        (run.mode === 'amount' && run.amountCurrency === target.currency ? run.amount : ''),
    ),
    [fee, setFee] = useState(run.fee ?? '0'),
    [sourceAmount, setSourceAmount] = useState(
      run.sourceAmount ??
        (run.mode === 'amount' && run.amountCurrency === sourceCurrency ? run.amount : ''),
    ),
    [sourcePrice, setSourcePrice] = useState(run.sourcePrice ?? source?.price?.value ?? ''),
    [error, setError] = useState('');
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        setError('');
        try {
          if (D(fee).gt(cost)) throw new Error(tr('手续费不能超过含费成本'));
          await onSave((s) => ({
            ...s,
            planRuns: s.planRuns.map((r) =>
              r.id === run.id
                ? {
                    ...r,
                    status: 'confirmed',
                    manual: true,
                    targetQuantity: quantity.trim(),
                    targetCost: cost.trim(),
                    fee: fee.trim(),
                    sourceAmount: sourceAmount.trim(),
                    sourcePrice: source ? sourcePrice.trim() : undefined,
                    targetPrice: D(quantity).gt(0)
                      ? D(cost).minus(fee).div(quantity).toDecimalPlaces(8).toFixed()
                      : undefined,
                    priceNote: tr('按实际成交手动确认'),
                    waiting: undefined,
                  }
                : r,
            ),
          }));
          onClose();
        } catch (e) {
          setError(humanError(e));
        }
      }}
    >
      <Notice>
        {tr('{time} · {planName}。按平台的实际确认单填写；手动确认后不再自动取价。', {
          time: formatAt(run.scheduledAt, l.settings.timezone),
          planName: run.planName,
        })}
      </Notice>
      <div className="form-grid">
        <Field label={tr('买入数量（{unit}）', { unit: unitOf(target) })}>
          <input
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            required
          />
        </Field>
        <Field label={tr('含费成本（{currency}）', { currency: target.currency })}>
          <input
            inputMode="decimal"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            required
          />
        </Field>
        <Field label={tr('其中手续费（{currency}）', { currency: target.currency })}>
          <input
            inputMode="decimal"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            required
          />
        </Field>
        <Field
          label={
            source
              ? tr('卖出来源数量（{unit}）', { unit: unitOf(source) })
              : tr('来源扣款（{sourceCurrency}）', { sourceCurrency })
          }
        >
          <input
            inputMode="decimal"
            value={sourceAmount}
            onChange={(e) => setSourceAmount(e.target.value)}
            required
          />
        </Field>
        {source && (
          <Field label={tr('来源成交单价（{currency}）', { currency: source.currency })}>
            <input
              inputMode="decimal"
              value={sourcePrice}
              onChange={(e) => setSourcePrice(e.target.value)}
              required
            />
          </Field>
        )}
      </div>
      <ErrorText error={error} />
      <div className="form-actions">
        <Button onClick={onClose}>{tr('取消')}</Button>
        <Button type="submit" variant="primary">
          {tr('确认这期成交')}
        </Button>
      </div>
    </form>
  );
}
