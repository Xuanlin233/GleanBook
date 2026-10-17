// Multi-device sync, shared by the browser and the Node master store.
// A ledger is a set of keyed records ("transactions:<id>", "rates:USD", "settings:" …).
// Devices send record-level puts / deletes; the master applies them last-writer-wins per
// record, deletions win over edits, and every result must still pass validateLedger.
// Not synced: `intraday` (each device's own observations), `settings.theme` (per device)
// and `revision` (local optimistic-lock counter).
import { emptyLedger, validateLedger, type Ledger } from './domain';
import { tr } from './i18n';

export type SyncOp =
  | { kind: 'put'; key: string; at: string; value: unknown }
  | { kind: 'delete'; key: string; at: string };
export type Rejected = { key: string; reason: string };

const idCollections = [
  'accounts',
  'categories',
  'transactions',
  'holdings',
  'investments',
  'plans',
  'subscriptions',
  'planRuns',
  'snapshots',
] as const;
type IdCollection = (typeof idCollections)[number];
type Collection = IdCollection | 'rates' | 'budgets' | 'settings';
type Budget = Ledger['budgets'][number];
type Rate = Ledger['rates'][number];

const budgetKey = (b: Budget) => `${b.month}|${b.categoryId ?? ''}`;
const sharedSettings = (s: Ledger['settings']) => {
  const { theme: _theme, ...rest } = s;
  return rest;
};

export function entries(l: Ledger): Map<string, unknown> {
  const m = new Map<string, unknown>();
  for (const c of idCollections) for (const r of l[c] as { id: string }[]) m.set(`${c}:${r.id}`, r);
  for (const r of l.rates) m.set(`rates:${r.currency}`, r);
  for (const b of l.budgets) m.set(`budgets:${budgetKey(b)}`, b);
  m.set('settings:', sharedSettings(l.settings));
  return m;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// Record-level difference turning `from` into `to`.
export function diffLedgers(from: Ledger, to: Ledger, at: (key: string) => string): SyncOp[] {
  const a = entries(from),
    b = entries(to),
    ops: SyncOp[] = [];
  for (const [key, value] of b)
    if (!a.has(key) || !same(a.get(key), value)) ops.push({ kind: 'put', key, at: at(key), value });
  for (const key of a.keys())
    if (!b.has(key) && key !== 'settings:') ops.push({ kind: 'delete', key, at: at(key) });
  return ops;
}

function split(key: string): [Collection, string] {
  const i = key.indexOf(':');
  const coll = key.slice(0, i) as Collection;
  if (
    i < 0 ||
    !(idCollections as readonly string[]).concat(['rates', 'budgets', 'settings']).includes(coll)
  )
    throw new Error(tr('未知的同步记录类型'));
  return [coll, key.slice(i + 1)];
}
// Pure: returns a new ledger with one record replaced, added or removed. Shapes are checked
// later by validateLedger; here only the key must match the record it carries.
export function applyOp(l: Ledger, op: SyncOp): Ledger {
  const [coll, id] = split(op.key);
  if (coll === 'settings') {
    if (op.kind === 'delete') return l;
    return { ...l, settings: { ...l.settings, ...(op.value as object), theme: l.settings.theme } };
  }
  const keyOf =
    coll === 'rates'
      ? (r: unknown) => (r as Rate).currency
      : coll === 'budgets'
        ? (r: unknown) => budgetKey(r as Budget)
        : (r: unknown) => (r as { id: string }).id;
  const list = l[coll] as unknown[];
  const rest = list.filter((r) => keyOf(r) !== id);
  if (op.kind === 'delete') return rest.length === list.length ? l : { ...l, [coll]: rest };
  if (!op.value || typeof op.value !== 'object' || keyOf(op.value) !== id)
    throw new Error(tr('同步记录与标识不一致'));
  const i = list.findIndex((r) => keyOf(r) === id);
  const next = [...list];
  if (i >= 0) next[i] = op.value;
  else next.push(op.value);
  return { ...l, [coll]: next };
}

// Apply ops, keeping the result valid. The whole batch is tried first; if it fails, ops are
// applied one by one and the ones that would break the ledger are rejected with a reason.
export function applyOps(l: Ledger, ops: SyncOp[]) {
  if (!ops.length) return { ledger: l, applied: [] as SyncOp[], rejected: [] as Rejected[] };
  try {
    return { ledger: validateLedger(ops.reduce(applyOp, l)), applied: ops, rejected: [] };
  } catch {
    let current = l;
    const applied: SyncOp[] = [],
      rejected: Rejected[] = [];
    for (const op of ops) {
      try {
        current = validateLedger(applyOp(current, op));
        applied.push(op);
      } catch (e) {
        const reason = e instanceof Error && e.name !== 'ZodError' ? e.message : tr('数据格式不符');
        rejected.push({ key: op.key, reason: reason.slice(0, 200) });
      }
    }
    return { ledger: current, applied, rejected };
  }
}

// ---------- Master side ----------
export type MasterMeta = Record<string, { at: string; deleted?: true }>;
// Last-writer-wins per record; a deletion is final for that record.
export function mergeIntoMaster(master: Ledger, meta: MasterMeta, ops: SyncOp[]) {
  const fresh = ops.filter((op) => {
    const m = meta[op.key];
    if (m?.deleted) return false;
    return op.kind === 'delete' || !m || op.at >= m.at;
  });
  const result = applyOps(master, fresh);
  const nextMeta = { ...meta };
  for (const op of result.applied)
    nextMeta[op.key] = op.kind === 'delete' ? { at: op.at, deleted: true } : { at: op.at };
  return { ...result, meta: nextMeta };
}

// ---------- Device side ----------
// What the device has changed since its last view of the master. Before the first sync there
// is no base: everything differing from a fresh empty ledger is sent (defaults are equal and
// therefore skipped), which uploads an existing ledger or merges it into the master.
export function pendingOps(
  base: Ledger | null,
  local: Ledger,
  touched: Record<string, string>,
  now: string,
) {
  return diffLedgers(base ?? emptyLedger(), local, (k) => touched[k] ?? now);
}

// Adopt the master's answer. Changes made on this device while the request was in flight
// (sent → current) are replayed on top, so nothing typed during a sync is lost.
export function rebaseOnMaster(
  master: Ledger,
  sent: Ledger,
  current: Ledger,
  touched: Record<string, string>,
  now: string,
) {
  const since = diffLedgers(sent, current, (k) => touched[k] ?? now);
  const shell: Ledger = {
    ...master,
    revision: current.revision,
    intraday: current.intraday,
    settings: { ...master.settings, theme: current.settings.theme },
  };
  const { ledger, applied, rejected } = applyOps(shell, since);
  return {
    ledger,
    touched: Object.fromEntries(applied.map((op) => [op.key, op.at])),
    rejected,
  };
}
