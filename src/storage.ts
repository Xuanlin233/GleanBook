import { openDB } from 'idb';
import { emptyLedger, validateLedger, type Ledger } from './domain';
import { tr } from './i18n';
const db = openDB('shizhang', 1, {
  upgrade(db) {
    db.createObjectStore('data');
  },
});
export async function readLedger(mode = 'real'): Promise<Ledger> {
  const value = await (await db).get('data', mode);
  return value ? validateLedger(value) : emptyLedger();
}
// Device-side sync bookkeeping, stored next to the ledger and written in the same transaction:
// the last master version this device saw, the master revision, and when each record was
// last changed here (used for last-writer-wins on the PC master).
export type SyncState = {
  base: Ledger | null;
  serverRevision: number | null;
  touched: Record<string, string>;
  lastSyncAt: string | null;
  dataFile: string | null;
};
export const emptySyncState = (): SyncState => ({
  base: null,
  serverRevision: null,
  touched: {},
  lastSyncAt: null,
  dataFile: null,
});
export async function readSyncState(mode = 'real'): Promise<SyncState> {
  const value = (await (await db).get('data', `sync:${mode}`)) as SyncState | undefined;
  if (!value) return emptySyncState();
  try {
    return { ...emptySyncState(), ...value, base: value.base ? validateLedger(value.base) : null };
  } catch {
    // An unreadable base only means the next sync re-sends everything; the master dedupes by ID.
    return { ...emptySyncState(), touched: value.touched ?? {} };
  }
}
export async function writeLedger(
  ledger: Ledger,
  mode = 'real',
  expected = ledger.revision,
  sync?: SyncState,
): Promise<Ledger> {
  const clean = validateLedger(ledger),
    d = await db,
    t = d.transaction('data', 'readwrite');
  const previous = (await t.store.get(mode)) as Ledger | undefined;
  if ((previous?.revision ?? 0) !== expected) {
    t.abort();
    await t.done.catch(() => {});
    throw new Error(tr('账本已在其他窗口更新，请刷新后重试。未提交的表单仍保留。'));
  }
  clean.revision = expected + 1;
  await t.store.put(clean, mode);
  if (sync) await t.store.put(sync, `sync:${mode}`);
  await t.done;
  return clean;
}
export async function saveDraft(value: unknown, mode: string) {
  await (await db).put('data', value, `draft:${mode}`);
}
export async function loadDraft(mode: string) {
  return (await db).get('data', `draft:${mode}`);
}
export async function deleteDraft(mode: string) {
  await (await db).delete('data', `draft:${mode}`);
}
export async function requestPersistence() {
  return navigator.storage?.persist ? navigator.storage.persist() : false;
}
