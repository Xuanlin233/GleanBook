import { useState } from 'react';
import type { SyncState } from './storage';
import type { SyncStatus } from './sync-client';
import { Button, ErrorText, Field, Icon, Notice, Panel, humanError } from './ui';

const time = (at: string) =>
  new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(at));

// Changes the user made here and has not synced yet. Automatic daily snapshots are left out
// of the count: they sync too, but are not something the user typed.
export const pendingCount = (info: SyncState) =>
  Object.keys(info.touched).filter((k) => !k.startsWith('snapshots:')).length;

// Short label for the top bar chip.
export function syncLabel(status: SyncStatus, info: SyncState, mode: string) {
  if (mode === 'demo') return { text: '演示账本', tone: '' };
  const pending = pendingCount(info);
  switch (status.kind) {
    case 'synced':
      return { text: '已同步', tone: 'ok' };
    case 'syncing':
      return { text: '同步中…', tone: '' };
    case 'login':
      return { text: '登录后同步', tone: 'warn' };
    case 'offline':
      return { text: pending ? `离线 · ${pending} 条待同步` : '离线可记账', tone: 'warn' };
    case 'unreachable':
      return { text: pending ? `未连电脑 · ${pending} 条待同步` : '未连接电脑', tone: 'warn' };
    case 'error':
      return { text: '同步失败', tone: 'warn' };
    default:
      return { text: '仅本机', tone: '' };
  }
}

export function SyncPanel({
  status,
  info,
  mode,
  onSyncNow,
}: {
  status: SyncStatus;
  info: SyncState;
  mode: string;
  onSyncNow: () => Promise<void>;
}) {
  const [token, setToken] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const pending = pendingCount(info);
  if (mode === 'demo')
    return (
      <Panel title="多设备同步">
        <Notice>演示账本只保存在本机，不会同步到电脑主库。</Notice>
      </Panel>
    );
  const line =
    status.kind === 'synced'
      ? `已与电脑主库同步 · ${time(status.at)}`
      : status.kind === 'syncing'
        ? '正在与电脑主库同步…'
        : status.kind === 'login'
          ? '这台设备还没有登录网站后端，登录后自动同步'
          : status.kind === 'offline'
            ? pending
              ? `离线：${pending} 条修改已暂存在这台设备，联网后自动同步`
              : '离线：可照常记账，联网后自动同步'
            : status.kind === 'unreachable'
              ? `连不上电脑：请确认电脑正在运行网站，手机已打开 Tailscale。${pending ? `${pending} 条修改已暂存在这台设备，` : '可照常记账，'}连上后自动同步`
              : status.kind === 'error'
                ? `同步失败：${status.message}`
                : '当前后端未开启同步。请用 npm run start:private 启动网站';
  return (
    <Panel title="多设备同步">
      <div className="connection-status">
        <span className={`status-dot ${status.kind === 'synced' ? 'configured' : ''}`} />
        <strong>{line}</strong>
      </div>
      <div className="setting-description long-copy">
        电脑上的主库是唯一的账本：电脑和手机记的账都会存到电脑上，两边打开看到的是同一本。离线时修改先存在本机，联网后自动合并。
        同一条记录两边都改过时，以后修改的为准；一边删除一边修改时，删除优先；合并后会让数据出错的修改不会写入，并会提示原因。
        外观主题与“今日”分时曲线各设备独立。
      </div>
      <div className="detail-grid sync-grid">
        <div>
          <span>主库位置（电脑）</span>
          <strong>{info.dataFile ?? '首次同步后显示'}</strong>
        </div>
        <div>
          <span>上次同步</span>
          <strong>{info.lastSyncAt ? time(info.lastSyncAt) : '尚未同步'}</strong>
        </div>
        <div>
          <span>本机待同步</span>
          <strong>{info.base ? `${pending} 条` : '首次同步时上传全部'}</strong>
        </div>
      </div>
      {status.kind === 'login' && (
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              const res = await fetch('/api/session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ token }),
              });
              const raw = await res.json().catch(() => null);
              if (!res.ok) throw new Error(raw?.error ?? '登录失败');
              setToken('');
              await onSyncNow();
            } catch (e) {
              setError(humanError(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field
            label="后端访问口令"
            hint="启动 npm run start:private 时设置的口令，登录后 30 天有效"
          >
            <input
              type="password"
              autoComplete="current-password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
            />
          </Field>
          <Button variant="primary" type="submit" disabled={busy}>
            登录并同步
          </Button>
        </form>
      )}
      <ErrorText error={error} />
      {status.kind !== 'login' && (
        <div className="button-group wrap">
          <Button
            onClick={() => {
              setBusy(true);
              onSyncNow().finally(() => setBusy(false));
            }}
            disabled={busy || status.kind === 'syncing'}
          >
            <Icon name="refresh" />
            立即同步
          </Button>
        </div>
      )}
    </Panel>
  );
}
