import { useEffect, useState, type FormEvent } from 'react';
import {
  D,
  exact,
  uid,
  currencies,
  accountKinds,
  rateFor,
  dayIn,
  type Ledger,
  type Transaction,
  type Account,
  type Holding,
  type Investment,
  holdingPosition,
} from './domain';
import { Button, Field, Icon, Notice, ErrorText, humanError } from './ui';
import { saveDraft, loadDraft, deleteDraft } from './storage';
import { transferQuote } from './transfer';
export type Commit = (update: (l: Ledger) => Ledger) => Promise<void>;
const localTime = (s?: string) => {
  const d = s ? new Date(s) : new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
export function TransactionForm({
  ledger: l,
  record,
  onSave,
  onClose,
  mode,
}: {
  ledger: Ledger;
  record?: Transaction;
  onSave: Commit;
  onClose: () => void;
  mode: string;
}) {
  const [kind, setKind] = useState<Transaction['kind']>(record?.kind ?? 'expense');
  const [amount, setAmount] = useState(record?.amount ?? '');
  const [accountId, setAccount] = useState(record?.accountId ?? l.accounts[0]?.id ?? '');
  const [toAccountId, setTo] = useState(
    record?.toAccountId ??
      l.accounts.find((a) => a.id !== accountId && a.source === 'manual')?.id ??
      '',
  );
  const [received, setReceived] = useState(record?.received ?? '');
  const [fee, setFee] = useState(record?.fee ?? '0');
  const [categoryId, setCategory] = useState(record?.categoryId ?? 'food'),
    [note, setNote] = useState(record?.note ?? '');
  const initialFx = rateFor(l, l.accounts.find((a) => a.id === accountId)?.currency ?? 'CNY');
  const [at, setAt] = useState(localTime(record?.occurredAt)),
    [fx, setFx] = useState(record?.cnyRate ?? (initialFx ? exact(initialFx) : ''));
  const [refundOf, setRefund] = useState(record?.refundOf ?? ''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [draftLoaded, setDraftLoaded] = useState(!!record);
  const account = l.accounts.find((a) => a.id === accountId),
    to = l.accounts.find((a) => a.id === toAccountId),
    catKind = kind === 'income' ? 'income' : 'expense';
  const crossCurrency =
      kind === 'transfer' && !!account && !!to && to.currency !== account.currency,
    hasOtherCurrency = l.accounts.some(
      (a) => a.source === 'manual' && a.id !== accountId && a.currency !== account?.currency,
    ),
    quote = crossCurrency
      ? transferQuote(l, account!.currency, to!.currency, amount, received)
      : null;
  useEffect(() => {
    if (record) return;
    loadDraft(mode)
      .then((d) => {
        if (d) {
          setKind(d.kind ?? 'expense');
          setAmount(d.amount ?? '');
          setAccount(d.accountId ?? accountId);
          setTo(d.toAccountId ?? toAccountId);
          setReceived(d.received ?? '');
          setFee(d.fee ?? '0');
          setCategory(d.categoryId ?? 'food');
          setNote(d.note ?? '');
          setAt(d.at ?? localTime());
          setFx(d.fx ?? '1');
          setRefund(d.refundOf ?? '');
        }
        setDraftLoaded(true);
      })
      .catch((e) => {
        setError(humanError(e));
        setDraftLoaded(true);
      });
  }, []);
  useEffect(() => {
    if (!record && draftLoaded)
      saveDraft(
        { kind, amount, accountId, toAccountId, received, fee, categoryId, note, at, fx, refundOf },
        mode,
      ).catch((e) => setError(humanError(e)));
  }, [
    kind,
    amount,
    accountId,
    toAccountId,
    received,
    fee,
    categoryId,
    note,
    at,
    fx,
    refundOf,
    draftLoaded,
  ]);
  useEffect(() => {
    if (!l.categories.some((c) => c.id === categoryId && c.kind === catKind))
      setCategory(l.categories.find((c) => c.kind === catKind)?.id ?? '');
  }, [catKind]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const original = l.transactions.find((t) => t.id === refundOf);
      const t: Transaction = {
        id: record?.id ?? uid(),
        kind,
        amount,
        accountId,
        toAccountId: kind === 'transfer' ? toAccountId : undefined,
        received:
          kind === 'transfer'
            ? account?.currency === to?.currency
              ? amount
              : received
            : undefined,
        fee: kind === 'transfer' ? fee : '0',
        categoryId:
          kind === 'transfer' ? undefined : kind === 'refund' ? original?.categoryId : categoryId,
        occurredAt: new Date(at).toISOString(),
        note,
        cnyRate: account?.currency === 'CNY' ? '1' : fx,
        refundOf: kind === 'refund' ? refundOf : undefined,
      };
      await onSave((s) => ({
        ...s,
        transactions: [...s.transactions.filter((x) => x.id !== t.id), t],
      }));
      await deleteDraft(mode);
      onClose();
    } catch (e) {
      setError(humanError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="form">
      <div className="segmented type-switch">
        {(['expense', 'income', 'transfer'] as const).map((k) => (
          <button
            type="button"
            className={kind === k ? 'selected' : ''}
            key={k}
            onClick={() => setKind(k)}
          >
            {k === 'expense' ? '支出' : k === 'income' ? '收入' : '转账'}
          </button>
        ))}
      </div>
      <div className="amount-input">
        <span>
          {kind === 'transfer' && <em>转出</em>}
          {account?.currency ?? 'CNY'}
        </span>
        <input
          aria-label={kind === 'transfer' ? '转出金额' : '金额'}
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          required
          autoComplete="off"
        />
      </div>
      {crossCurrency && (
        <div className="amount-input">
          <span>
            <em>转入</em>
            {to?.currency}
          </span>
          <input
            aria-label={`转入金额（${to?.currency ?? ''}）`}
            inputMode="decimal"
            value={received}
            onChange={(e) => setReceived(e.target.value)}
            placeholder="0.00"
            required
            autoComplete="off"
          />
        </div>
      )}
      {crossCurrency && quote && (
        <div className="fx-quote">
          <span>
            实际汇率 1 {to?.currency} = {quote.actual} {account?.currency}
          </span>
          {quote.reference && (
            <span>
              参考 {quote.reference} · {quote.premiumText}
            </span>
          )}
          {quote.extra && (
            <Button
              variant="text"
              onClick={() => {
                setAmount(quote.extra!.principal);
                setFee(
                  D(fee || '0')
                    .plus(quote.extra!.amount)
                    .toFixed(),
                );
              }}
            >
              把溢价 {quote.extra.amount} {account?.currency} 记为手续费（计入支出）
            </Button>
          )}
        </div>
      )}
      {kind === 'transfer' && !hasOtherCurrency && (
        <p className="form-footnote">
          要跨币种转账（例如用人民币买美区 App Store 礼品卡），先在 资产 → 添加账户 建一个 USD
          账户，如「App Store 美区余额」，再在这里选它作为转入账户。
        </p>
      )}
      <div className="form-grid">
        <Field label={kind === 'transfer' ? '转出账户' : '所属账户'}>
          <select
            value={accountId}
            onChange={(e) => {
              setAccount(e.target.value);
              const a = l.accounts.find((a) => a.id === e.target.value);
              const rate = rateFor(l, a?.currency ?? 'CNY');
              setFx(rate ? exact(rate) : '');
            }}
            required
          >
            <option value="" disabled>
              请选择账户
            </option>
            {l.accounts
              .filter((a) => kind !== 'transfer' || a.source === 'manual')
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.currency}
                  {a.source === 'external' ? '（同步）' : ''}
                </option>
              ))}
          </select>
        </Field>
        {kind === 'transfer' ? (
          <Field label="转入账户">
            <select value={toAccountId} onChange={(e) => setTo(e.target.value)} required>
              <option value="" disabled>
                请选择账户
              </option>
              {l.accounts
                .filter((a) => a.id !== accountId && a.source === 'manual')
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {a.currency}
                  </option>
                ))}
            </select>
          </Field>
        ) : kind === 'refund' ? (
          <Field label="关联原支出">
            <select value={refundOf} onChange={(e) => setRefund(e.target.value)} required>
              <option value="">请选择原支出</option>
              {l.transactions
                .filter(
                  (t) =>
                    t.kind === 'expense' &&
                    l.accounts.find((a) => a.id === t.accountId)?.currency === account?.currency,
                )
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {dayIn(t.occurredAt, l.settings.timezone)} ·{' '}
                    {t.note || l.categories.find((c) => c.id === t.categoryId)?.name} · {t.amount}
                  </option>
                ))}
            </select>
          </Field>
        ) : (
          <Field label="分类">
            <select value={categoryId} onChange={(e) => setCategory(e.target.value)} required>
              {l.categories
                .filter((c) => c.kind === catKind)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </Field>
        )}
        {kind === 'transfer' && (
          <Field
            label={`手续费（${account?.currency ?? ''}）`}
            hint={
              D(fee || '0').gt(0) && /^\d+(\.\d+)?$/.test(amount)
                ? `单独计入支出；转出账户共扣 ${D(amount)
                    .plus(fee || '0')
                    .toFixed()} ${account?.currency ?? ''}`
                : '单独计入支出，转账本金不计收支'
            }
          >
            <input
              inputMode="decimal"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              required
            />
          </Field>
        )}
        <Field label="日期与时间" hint={`按设备时区输入；统计时区 ${l.settings.timezone}`}>
          <input
            type="datetime-local"
            value={at}
            onChange={(e) => setAt(e.target.value)}
            required
          />
        </Field>
        {account?.currency !== 'CNY' && (
          <Field
            label={`记账时 1 ${account?.currency ?? ''} 折合人民币`}
            hint="此汇率固定用于历史收支，请核对实际发生时的换算口径"
          >
            <input
              inputMode="decimal"
              value={fx}
              onChange={(e) => setFx(e.target.value)}
              required
            />
          </Field>
        )}
      </div>
      <Field label="备注（选填）">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          placeholder="记录这一笔的小细节"
        />
      </Field>
      {kind !== 'transfer' && (
        <div className="inline-options">
          <button
            type="button"
            className={kind === 'refund' ? 'active' : ''}
            onClick={() => setKind(kind === 'refund' ? 'expense' : 'refund')}
          >
            记录退款
          </button>
          <button
            type="button"
            className={kind === 'fee' ? 'active' : ''}
            onClick={() => setKind(kind === 'fee' ? 'expense' : 'fee')}
          >
            记录手续费
          </button>
        </div>
      )}
      {account?.source === 'external' && (
        <Notice>此账单仅统计生活收支，不改变已同步的外部余额。</Notice>
      )}
      <ErrorText error={error} />
      <div className="form-actions">
        <Button onClick={onClose}>稍后继续</Button>
        <Button type="submit" variant="primary" disabled={busy || !draftLoaded}>
          {busy ? '保存中…' : record ? '保存修改' : '保存这笔记录'}
        </Button>
      </div>
      {!record && <p className="form-footnote">草稿自动保存在当前设备，稍后可继续填写。</p>}
    </form>
  );
}
export function AccountForm({
  record,
  onSave,
  onClose,
}: {
  record?: Account;
  onSave: Commit;
  onClose: () => void;
}) {
  const [name, setName] = useState(record?.name ?? ''),
    [kind, setKind] = useState<Account['kind']>(record?.kind ?? 'bank'),
    [currency, setCurrency] = useState<Account['currency']>(record?.currency ?? 'CNY'),
    [opening, setOpening] = useState(
      record
        ? record.kind === 'liability'
          ? exact(D(record.opening).abs())
          : record.opening
        : '0',
    ),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
          const a: Account = {
            ...record,
            id: record?.id ?? uid(),
            name,
            kind,
            currency,
            opening: kind === 'liability' ? exact(D(opening).abs().neg()) : opening,
            source: record?.source ?? 'manual',
          };
          await onSave((l) => {
            if (
              record &&
              record.currency !== currency &&
              (l.transactions.some(
                (t) => t.accountId === record.id || t.toAccountId === record.id,
              ) ||
                l.investments.some((t) => t.accountId === record.id))
            )
              throw new Error('已有交易的账户不能修改币种，请新建账户');
            return { ...l, accounts: [...l.accounts.filter((x) => x.id !== a.id), a] };
          });
          onClose();
        } catch (e) {
          setError(humanError(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="账户名称">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：招商银行储蓄卡"
          maxLength={60}
          required
        />
      </Field>
      <div className="form-grid">
        <Field label="账户类型">
          <select value={kind} onChange={(e) => setKind(e.target.value as Account['kind'])}>
            {Object.entries(accountKinds).map(([k, n]) => (
              <option key={k} value={k}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        <Field label="币种">
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value as Account['currency'])}
          >
            {currencies.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field
        label={kind === 'liability' ? '期初欠款（正数）' : '期初余额'}
        hint="期初余额不计入收入。修改这里会重新计算此账户当前余额。"
      >
        <input
          inputMode="decimal"
          value={opening}
          onChange={(e) => setOpening(e.target.value)}
          required
        />
      </Field>
      <Notice>
        手动账户由期初余额和账本记录计算。基金、赚币等已独立维护的持仓，请勿重复包含在这里。
      </Notice>
      <ErrorText error={error} />
      <div className="form-actions">
        <Button onClick={onClose}>取消</Button>
        <Button type="submit" variant="primary" disabled={busy}>
          保存账户
        </Button>
      </div>
    </form>
  );
}
export function HoldingForm({
  record,
  onSave,
  onClose,
}: {
  record?: Holding;
  onSave: Commit;
  onClose: () => void;
}) {
  const [name, setName] = useState(record?.name ?? ''),
    [kind, setKind] = useState<Holding['kind']>(record?.kind ?? 'fund'),
    [symbol, setSymbol] = useState(record?.symbol ?? ''),
    [currency, setCurrency] = useState<Holding['currency']>(record?.currency ?? 'CNY'),
    [quantity, setQuantity] = useState(record?.quantity ?? ''),
    [cost, setCost] = useState(record?.cost ?? ''),
    [location, setLocation] = useState(record?.location ?? '支付宝'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
          if (kind === 'fund' && !/^\d{6}$/.test(symbol))
            throw new Error('基金代码需要 6 位数字，请核对份额类别');
          const h: Holding = {
            ...record,
            id: record?.id ?? uid(),
            name,
            kind,
            symbol,
            quantity,
            cost: cost === '' ? null : cost,
            currency,
            location,
            source: 'manual',
            price: record?.price ?? null,
          };
          await onSave((l) => {
            if (
              record &&
              (l.investments.some((e) => e.holdingId === record.id) ||
                l.planRuns.some(
                  (r) =>
                    r.targetId === record.id ||
                    (r.sourceType === 'holding' && r.sourceId === record.id),
                )) &&
              (currency !== record.currency ||
                quantity !== record.quantity ||
                cost !== (record.cost ?? ''))
            )
              throw new Error('已有投资记录，请通过份额调整维护数量，或先移除相关交易后更正期初值');
            return { ...l, holdings: [...l.holdings.filter((x) => x.id !== h.id), h] };
          });
          onClose();
        } catch (e) {
          setError(humanError(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      {!record && (
        <div className="suggestions">
          <span>已核实的基金</span>
          <button
            type="button"
            onClick={() => {
              setName('国泰黄金 ETF 联接 A');
              setSymbol('000218');
              setKind('fund');
              setCurrency('CNY');
            }}
          >
            国泰黄金 A · 000218
          </button>
          <button
            type="button"
            onClick={() => {
              setName('易方达沪深 300 ETF 联接 A');
              setSymbol('110020');
              setKind('fund');
              setCurrency('CNY');
            }}
          >
            易方达沪深 300 A · 110020
          </button>
        </div>
      )}
      <Field label="持仓名称">
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
      </Field>
      <div className="form-grid">
        <Field label="资产类型">
          <select value={kind} onChange={(e) => setKind(e.target.value as Holding['kind'])}>
            <option value="fund">基金</option>
            <option value="crypto">加密资产 / xStock</option>
            <option value="earn">简单赚币</option>
            <option value="other">其他投资资产</option>
          </select>
        </Field>
        <Field label={kind === 'fund' ? '准确基金代码' : '准确产品标识 / 币种'}>
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.trim().toUpperCase())}
            required
            placeholder={kind === 'fund' ? '000218' : 'BTC / 准确产品标识'}
          />
        </Field>
        <Field label="精确期初份额 / 数量">
          <input
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            required
          />
        </Field>
        <Field label="期初持仓总成本（选填）">
          <input
            inputMode="decimal"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            placeholder="未知则留空"
          />
        </Field>
        <Field label="价格及成本计价币种">
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value as Holding['currency'])}
          >
            {currencies.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="持有位置">
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            maxLength={80}
            placeholder="支付宝 / OKX 手动维护"
          />
        </Field>
      </div>
      <Notice>
        这里录入已有持仓，不扣减现金。新申购请进入资产详情操作。不要将同一份持仓同时录入现金余额；请从官方交易确认记录核对精确份额。
      </Notice>
      <ErrorText error={error} />
      <div className="form-actions">
        <Button onClick={onClose}>取消</Button>
        <Button type="submit" variant="primary" disabled={busy}>
          保存持仓
        </Button>
      </div>
    </form>
  );
}
export function PriceForm({
  holding: h,
  onSave,
  onClose,
}: {
  holding: Holding;
  onSave: Commit;
  onClose: () => void;
}) {
  const [value, setValue] = useState(h.price?.value ?? ''),
    [date, setDate] = useState(h.price?.asOf.slice(0, 10) ?? new Date().toISOString().slice(0, 10)),
    [source, setSource] = useState(h.price?.mode === 'market' ? '' : (h.price?.source ?? '')),
    [error, setError] = useState('');
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        setError('');
        try {
          const asOf = new Date(date + 'T15:00:00+08:00').toISOString();
          if (Date.parse(date) > Date.now() + 86400000) throw new Error('数据日期不能是未来日期');
          await onSave((l) => ({
            ...l,
            holdings: l.holdings.map((x) =>
              x.id === h.id
                ? {
                    ...x,
                    price: {
                      value,
                      currency: h.currency,
                      asOf,
                      fetchedAt: new Date().toISOString(),
                      source,
                      mode: 'manual',
                    },
                  }
                : x,
            ),
          }));
          onClose();
        } catch (e) {
          setError(humanError(e));
        }
      }}
    >
      <Notice>
        {h.kind === 'fund'
          ? '请核对基金公司公布的正式单位净值。手动录入会明确标注，不作为已自动验证的正式行情。'
          : '按实际计价币种填写价格。USDT、USDC 不自动等于 1 美元。'}
      </Notice>
      <Field label={`单位价格（${h.currency}）`}>
        <input
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          required
        />
      </Field>
      <Field label="净值 / 价格日期">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      </Field>
      <Field label="来源（名称或链接）">
        <input
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="例如：基金公司官网正式净值"
          maxLength={200}
          required
        />
      </Field>
      <ErrorText error={error} />
      <div className="form-actions">
        <Button onClick={onClose}>取消</Button>
        <Button variant="primary" type="submit">
          保存价格
        </Button>
      </div>
    </form>
  );
}
export function InvestmentForm({
  ledger: l,
  holding: h,
  onSave,
  onClose,
}: {
  ledger: Ledger;
  holding: Holding;
  onSave: Commit;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<Investment['kind']>('buy'),
    [status, setStatus] = useState<Investment['status']>('confirmed'),
    [quantity, setQuantity] = useState(''),
    [cash, setCash] = useState(''),
    [fee, setFee] = useState('0'),
    [at, setAt] = useState(localTime()),
    [accountId, setAccount] = useState(
      l.accounts.find((a) => a.currency === h.currency && a.source === 'manual')?.id ?? '',
    ),
    [note, setNote] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const cashKind = ['buy', 'sell', 'dividend'].includes(kind);
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        setError('');
        setBusy(true);
        try {
          const event: Investment = {
            id: uid(),
            holdingId: h.id,
            kind,
            status: ['buy', 'sell'].includes(kind) ? status : 'confirmed',
            quantity: kind === 'dividend' ? '0' : quantity,
            cash: cashKind ? cash : '0',
            fee: cashKind ? fee : '0',
            accountId: cashKind ? accountId : undefined,
            occurredAt: new Date(at).toISOString(),
            note,
          };
          await onSave((l) => ({ ...l, investments: [...l.investments, event] }));
          onClose();
        } catch (e) {
          setError(humanError(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Notice>
        移动加权平均成本法。申购从结算账户扣本金与手续费，赎回入账净额；不计入生活收支。当前精确份额{' '}
        {exact(holdingPosition(l, h).quantity)}。
      </Notice>
      <div className="form-grid">
        <Field label="操作">
          <select value={kind} onChange={(e) => setKind(e.target.value as Investment['kind'])}>
            <option value="buy">申购 / 买入</option>
            <option value="sell">赎回 / 卖出</option>
            <option value="dividend">现金分红</option>
            <option value="adjust">份额调整（成本不变）</option>
            <option value="interest">赚币利息（新增数量）</option>
          </select>
        </Field>
        {['buy', 'sell'].includes(kind) && (
          <Field label="确认状态">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as Investment['status'])}
            >
              <option value="confirmed">已确认</option>
              <option value="pending">待确认</option>
            </select>
          </Field>
        )}
        {kind !== 'dividend' && (
          <Field label={kind === 'adjust' ? '增减份额（可为负数）' : '精确份额 / 数量'}>
            <input
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              inputMode={kind === 'adjust' ? 'text' : 'decimal'}
              required
            />
          </Field>
        )}
        {cashKind && (
          <>
            <Field label={`成交总金额（${h.currency}，不含手续费）`}>
              <input
                inputMode="decimal"
                value={cash}
                onChange={(e) => setCash(e.target.value)}
                required
              />
            </Field>
            <Field label={`手续费（${h.currency}）`}>
              <input
                inputMode="decimal"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
                required
              />
            </Field>
            <Field label="结算账户">
              <select value={accountId} onChange={(e) => setAccount(e.target.value)} required>
                <option value="" disabled>
                  请选择同币种手动账户
                </option>
                {l.accounts
                  .filter((a) => a.currency === h.currency && a.source === 'manual')
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </Field>
          </>
        )}
        <Field label="发生时间">
          <input
            type="datetime-local"
            value={at}
            onChange={(e) => setAt(e.target.value)}
            required
          />
        </Field>
      </div>
      <Field label="备注">
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </Field>
      {status === 'pending' && kind === 'buy' && (
        <Notice>
          待确认申购先扣现金，本金以待确认资产计入，确认后才增加份额。请用预计份额建立草稿，确认时核对并填写正式份额。
        </Notice>
      )}
      {status === 'pending' && kind === 'sell' && (
        <Notice>
          待确认赎回份额仍计入持仓，资金尚未入账。确认时按实际到账金额与份额结算，避免重复统计。
        </Notice>
      )}
      <ErrorText error={error} />
      <div className="form-actions">
        <Button onClick={onClose}>取消</Button>
        <Button variant="primary" type="submit" disabled={busy}>
          记录投资操作
        </Button>
      </div>
    </form>
  );
}
