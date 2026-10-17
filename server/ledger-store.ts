// The master ledger on this PC. Default folder ~/GleanbookData, e.g. C:\Users\<you>\GleanbookData
// (set GLEANBOOK_DATA_DIR in .env to keep it elsewhere, such as another drive):
//   ledger.json        current master
//   ledger.prev.json   the version before the last write
//   backups\ledger-YYYY-MM-DD.json   first state of each day, last 60 days kept
// Writes are serialized and atomic (temp file + rename), so a crash never leaves half a file.
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { emptyLedger, validateLedger, type Ledger } from '../src/domain';
import { mergeIntoMaster, type MasterMeta, type Rejected, type SyncOp } from '../src/sync-core';

export function defaultDataDir() {
  if (process.env.GLEANBOOK_DATA_DIR) return path.resolve(process.env.GLEANBOOK_DATA_DIR);
  return path.join(os.homedir(), 'GleanbookData');
}
const fileSchema = z.object({
  format: z.literal('shizhang-master'),
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  updatedAt: z.string(),
  ledger: z.unknown(),
  meta: z.record(z.string(), z.object({ at: z.string(), deleted: z.literal(true).optional() })),
});
type Master = { revision: number; updatedAt: string; ledger: Ledger; meta: MasterMeta };
export type SyncResult =
  | { revision: number; unchanged: true; rejected: Rejected[]; dataFile: string }
  | { revision: number; unchanged: false; ledger: Ledger; rejected: Rejected[]; dataFile: string };
const KEEP_DAILY = 60;

export function createLedgerStore(dir = defaultDataDir()) {
  const file = path.join(dir, 'ledger.json'),
    prev = path.join(dir, 'ledger.prev.json'),
    backups = path.join(dir, 'backups');
  let cache: Master | null = null,
    chain: Promise<unknown> = Promise.resolve();

  async function load(): Promise<Master> {
    if (cache) return cache;
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch {
      cache = {
        revision: 0,
        updatedAt: new Date(0).toISOString(),
        ledger: emptyLedger(),
        meta: {},
      };
      return cache;
    }
    const raw = fileSchema.parse(JSON.parse(text));
    cache = { ...raw, ledger: validateLedger(raw.ledger) };
    return cache;
  }
  async function backupToday() {
    try {
      await stat(file);
    } catch {
      return; // nothing written yet
    }
    await mkdir(backups, { recursive: true });
    const today = new Date().toISOString().slice(0, 10),
      target = path.join(backups, `ledger-${today}.json`);
    try {
      await stat(target);
    } catch {
      await copyFile(file, target);
      const old = (await readdir(backups))
        .filter((f) => /^ledger-\d{4}-\d{2}-\d{2}\.json$/.test(f))
        .sort();
      for (const f of old.slice(0, Math.max(0, old.length - KEEP_DAILY)))
        await rm(path.join(backups, f));
    }
  }
  async function save(m: Master) {
    await mkdir(dir, { recursive: true });
    await backupToday();
    const tmp = file + '.tmp';
    await writeFile(tmp, JSON.stringify({ format: 'shizhang-master', version: 1, ...m }), {
      encoding: 'utf8',
    });
    try {
      await copyFile(file, prev);
    } catch {
      /* first write */
    }
    await rename(tmp, file);
    cache = m;
  }

  // One request at a time; the master never sees two merges interleave.
  function sync(clientRevision: number | null, ops: SyncOp[]): Promise<SyncResult> {
    const task = chain.then(async (): Promise<SyncResult> => {
      const m = await load();
      if (!ops.length)
        return clientRevision === m.revision
          ? { revision: m.revision, unchanged: true, rejected: [], dataFile: file }
          : {
              revision: m.revision,
              unchanged: false,
              ledger: m.ledger,
              rejected: [],
              dataFile: file,
            };
      const merged = mergeIntoMaster(m.ledger, m.meta, ops);
      if (merged.applied.length) {
        await save({
          revision: m.revision + 1,
          updatedAt: new Date().toISOString(),
          ledger: { ...merged.ledger, revision: 0, intraday: [] },
          meta: merged.meta,
        });
      }
      const now = await load();
      return {
        revision: now.revision,
        unchanged: false,
        ledger: now.ledger,
        rejected: merged.rejected,
        dataFile: file,
      };
    });
    chain = task.catch(() => {});
    return task;
  }
  return { sync, file, dir };
}
