import { z } from 'zod';
import { validateLedger, type Ledger } from './domain';
import type { Rejected, SyncOp } from './sync-core';
import { tr } from './i18n';

export type SyncStatus =
  | { kind: 'local' } // demo ledger or a backend without the sync endpoint
  | { kind: 'login' } // backend reachable, website password not entered on this device yet
  | { kind: 'offline' }
  // Online, but the PC cannot be reached (site not running, or Tailscale off on the phone).
  | { kind: 'unreachable' }
  | { kind: 'syncing' }
  | { kind: 'synced'; at: string }
  | { kind: 'error'; message: string };

const responseSchema = z.object({
  revision: z.number().int().nonnegative(),
  unchanged: z.boolean(),
  ledger: z.unknown().optional(),
  rejected: z.array(z.object({ key: z.string(), reason: z.string() })),
  dataFile: z.string().max(500),
});
export type SyncAnswer =
  | { kind: 'login' }
  | { kind: 'unsupported' }
  | {
      kind: 'ok';
      revision: number;
      ledger: Ledger | null;
      rejected: Rejected[];
      dataFile: string;
    };

export async function postSync(revision: number | null, ops: SyncOp[]): Promise<SyncAnswer> {
  const res = await fetch('/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
    body: JSON.stringify({ revision, ops }),
    signal: AbortSignal.timeout(60000),
  });
  if (res.status === 401) return { kind: 'login' };
  if (res.status === 404) return { kind: 'unsupported' };
  const raw = await res.json().catch(() => null);
  if (!res.ok)
    throw new Error(
      raw && typeof raw.error === 'string' ? raw.error.slice(0, 200) : tr('电脑主库暂时无法同步'),
    );
  const data = responseSchema.parse(raw);
  return {
    kind: 'ok',
    revision: data.revision,
    ledger: data.unchanged ? null : validateLedger(data.ledger),
    rejected: data.rejected,
    dataFile: data.dataFile,
  };
}
