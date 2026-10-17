import { useCallback, useEffect, useRef, useState } from 'react';
import {
  accountBalance,
  accountKinds,
  captureSnapshot,
  D,
  emptyLedger,
  exact,
  money,
  uid,
  validateLedger,
  type Account,
  type Holding,
  type Investment,
  type Ledger,
  type Plan,
  type PlanRun,
  type Subscription,
  type Transaction,
} from './domain';
import {
  applyRunUpdates,
  browserPriceDeps,
  cachedCalendar,
  generateRuns,
  holidayYearsNeeded,
  loadHolidays,
  resolveRuns,
  type RunUpdate,
} from './plans';
import { PlanDetail, PlanForm, RunForm } from './plans-ui';
import { loadAutoRates, mergeAutoRates, type AutoRate } from './rates';
import { chargeSubscriptions } from './subscriptions';
import { SubscriptionForm } from './subscriptions-ui';
import {
  readLedger,
  writeLedger,
  deleteDraft,
  readSyncState,
  emptySyncState,
  type SyncState,
} from './storage';
import { diffLedgers, pendingOps, rebaseOnMaster } from './sync-core';
import { postSync, type SyncStatus } from './sync-client';
import { syncLabel } from './sync-ui';
import { demoLedger } from './demo';
import { fetchPrice, canRefreshPrice, priceRefreshInterval } from './market';
import {
  AccountForm,
  HoldingForm,
  InvestmentForm,
  PriceForm,
  TransactionForm,
  type Commit,
} from './forms';
import { Assets, Bills, HoldingDetail, Overview } from './pages';
import { Settings } from './settings';
import { Button, Empty, ErrorText, Field, Icon, IconButton, Modal, Notice, humanError } from './ui';
import { tr } from './i18n';
type ModalState =
  | { type: 'transaction'; record?: Transaction }
  | { type: 'account'; record?: Account }
  | { type: 'holding'; record?: Holding }
  | { type: 'account-detail'; record: Account }
  | { type: 'holding-detail'; record: Holding }
  | { type: 'price' | 'trade'; record: Holding }
  | { type: 'confirm-investment'; record: Investment }
  | { type: 'plan'; record?: Plan; targetId?: string }
  | { type: 'plan-detail'; record: Plan }
  | { type: 'run'; record: PlanRun; back?: Plan }
  | { type: 'subscription'; record?: Subscription }
  | { type: 'clear' }
  | null;
const navigation = [
  ['overview', 'overview', tr('总览')],
  ['bills', 'receipt', tr('账单')],
  ['assets', 'wallet', tr('资产')],
  ['settings', 'settings', tr('设置')],
];
export default function App() {
  // http://localhost:8787/?demo opens the built-in demo ledger directly (for a quick look).
  const [mode, setModeState] = useState(() => {
      if (new URLSearchParams(location.search).has('demo')) {
        sessionStorage.setItem('shizhang-mode', 'demo');
        history.replaceState(null, '', location.pathname + location.hash);
      }
      return sessionStorage.getItem('shizhang-mode') === 'demo' ? 'demo' : 'real';
    }),
    [ledger, setLedger] = useState<Ledger | null>(null),
    [page, setPage] = useState(() => location.hash.slice(1) || 'overview'),
    [modal, setModal] = useState<ModalState>(null),
    [fatal, setFatal] = useState(''),
    [toast, setToast] = useState(''),
    [online, setOnline] = useState(navigator.onLine),
    [refreshing, setRefreshing] = useState(false),
    [errors, setErrors] = useState<string[]>([]),
    [waiting, setWaiting] = useState<ServiceWorker | null>(null),
    [syncStatus, setSyncStatus] = useState<SyncStatus>({ kind: 'local' }),
    [syncInfo, setSyncInfo] = useState<SyncState>(emptySyncState()),
    [settingsJump, setSettingsJump] = useState(0);
  const ledgerRef = useRef<Ledger | null>(null),
    queue = useRef<Promise<unknown>>(Promise.resolve()),
    toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    isRefreshing = useRef(false),
    updateRequested = useRef(false),
    loadedMode = useRef(''),
    tabId = useRef(uid()),
    syncRef = useRef<SyncState>(emptySyncState()),
    syncing = useRef(false),
    syncTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    runSyncRef = useRef<() => Promise<void>>(async () => {});
  const notify = useCallback((message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 6500);
  }, []);
  const commit: Commit = useCallback(
    (update) => {
      const result = queue.current
        .catch(() => {})
        .then(async () => {
          const current = ledgerRef.current;
          if (!current) throw new Error(tr('账本尚未加载'));
          const next = captureSnapshot(validateLedger(update(structuredClone(current))));
          // Remember when each record changed on this device; the PC master resolves
          // concurrent edits by these times. Before the first sync everything is sent anyway.
          let sync = syncRef.current;
          if (mode === 'real' && sync.base) {
            const now = new Date().toISOString(),
              touched = { ...sync.touched };
            for (const op of diffLedgers(current, next, () => now)) touched[op.key] = now;
            sync = { ...sync, touched };
          }
          const saved = await writeLedger(
            next,
            mode,
            current.revision,
            mode === 'real' ? sync : undefined,
          );
          ledgerRef.current = saved;
          syncRef.current = sync;
          setLedger(saved);
          setSyncInfo(sync);
          if (mode === 'real') {
            clearTimeout(syncTimer.current);
            syncTimer.current = setTimeout(() => void runSyncRef.current(), 1500);
          }
          const c = new BroadcastChannel('shizhang-changes');
          c.postMessage({ mode, source: tabId.current });
          c.close();
        });
      queue.current = result;
      return result;
    },
    [mode],
  );
  useEffect(() => {
    let alive = true;
    setLedger(null);
    ledgerRef.current = null;
    setFatal('');
    setErrors([]);
    (async () => {
      let data = await readLedger(mode);
      if (mode === 'demo' && !data.accounts.length && !data.holdings.length)
        data = await writeLedger(demoLedger(), 'demo', data.revision);
      const sync = mode === 'real' ? await readSyncState(mode) : emptySyncState();
      if (alive) {
        ledgerRef.current = data;
        syncRef.current = sync;
        setSyncInfo(sync);
        setLedger(data);
        setSyncStatus(mode === 'real' ? { kind: 'syncing' } : { kind: 'local' });
        if (mode === 'real') void runSyncRef.current();
      }
    })().catch((e) => {
      if (alive)
        setFatal(
          tr('无法打开本地账本：{error}。请勿清理浏览器数据，可重新打开应用重试。', {
            error: humanError(e),
          }),
        );
    });
    return () => {
      alive = false;
    };
  }, [mode]);
  useEffect(() => {
    const c = new BroadcastChannel('shizhang-changes');
    c.onmessage = (e) => {
      if (e.data.mode === mode && e.data.source !== tabId.current)
        Promise.all([readLedger(mode), readSyncState(mode)])
          .then(([l, sync]) => {
            ledgerRef.current = l;
            syncRef.current = sync;
            setSyncInfo(sync);
            setLedger(l);
            notify(tr('账本已在其他窗口更新，正在编辑的表单保留'));
          })
          .catch((e) => notify(humanError(e)));
    };
    return () => c.close();
  }, [mode, notify]);
  // ---------- PC master sync ----------
  // Send what changed here since the last master view, adopt the master's merged ledger and
  // replay anything typed meanwhile. Offline or signed out, edits simply wait locally.
  const runSync = useCallback(async () => {
    if (mode !== 'real' || syncing.current || !ledgerRef.current) return;
    if (!navigator.onLine) {
      setSyncStatus({ kind: 'offline' });
      return;
    }
    syncing.current = true;
    setSyncStatus({ kind: 'syncing' });
    try {
      const sent = ledgerRef.current,
        state = syncRef.current,
        now = new Date().toISOString();
      const answer = await postSync(
        state.serverRevision,
        pendingOps(state.base, sent, state.touched, now),
      );
      if (answer.kind === 'login') return setSyncStatus({ kind: 'login' });
      if (answer.kind === 'unsupported') return setSyncStatus({ kind: 'local' });
      let rejectedCount = answer.rejected.length;
      await (queue.current = queue.current
        .catch(() => {})
        .then(async () => {
          const current = ledgerRef.current!,
            cur = syncRef.current,
            at = new Date().toISOString();
          let next = current,
            nextSync: SyncState = {
              ...cur,
              serverRevision: answer.revision,
              lastSyncAt: at,
              dataFile: answer.dataFile,
            };
          if (answer.ledger) {
            const merged = rebaseOnMaster(answer.ledger, sent, current, cur.touched, at);
            rejectedCount += merged.rejected.length;
            next = merged.ledger;
            nextSync = { ...nextSync, base: answer.ledger, touched: merged.touched };
          }
          const saved = await writeLedger(next, mode, current.revision, nextSync);
          ledgerRef.current = saved;
          syncRef.current = nextSync;
          setSyncInfo(nextSync);
          setLedger(saved);
        }));
      setSyncStatus({ kind: 'synced', at: new Date().toISOString() });
      if (rejectedCount)
        notify(
          tr('{count} 条修改与电脑主库的数据冲突，已按主库保留：{reason}', {
            count: rejectedCount,
            reason: answer.rejected[0]?.reason ?? tr('数据校验未通过'),
          }),
        );
      // Something typed during this round is still pending: send it right away.
      if (Object.keys(syncRef.current.touched).length && syncRef.current.base)
        syncTimer.current = setTimeout(() => void runSyncRef.current(), 800);
    } catch (e) {
      // fetch() rejects with a TypeError when nothing answers: the PC is out of reach.
      const unreachable =
        e instanceof TypeError || (e instanceof Error && e.name === 'TimeoutError');
      setSyncStatus(
        !navigator.onLine
          ? { kind: 'offline' }
          : unreachable
            ? { kind: 'unreachable' }
            : { kind: 'error', message: humanError(e) },
      );
    } finally {
      syncing.current = false;
    }
  }, [mode, notify]);
  runSyncRef.current = runSync;
  useEffect(() => {
    if (mode !== 'real') return;
    const tick = () => {
      if (document.visibilityState === 'visible') void runSyncRef.current();
    };
    const timer = setInterval(tick, 30000);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('online', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('online', tick);
      clearTimeout(syncTimer.current);
    };
  }, [mode]);
  const navigate = useCallback((p: string) => {
    setPage(p);
    location.hash = p;
    window.scrollTo({ top: 0 });
  }, []);
  useEffect(() => {
    const handle = () => setPage(location.hash.slice(1) || 'overview');
    window.addEventListener('hashchange', handle);
    return () => window.removeEventListener('hashchange', handle);
  }, []);
  useEffect(() => {
    const on = () => setOnline(true),
      off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  useEffect(() => {
    const setting = ledger?.settings.theme ?? 'system',
      media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme =
        setting === 'system' ? (media.matches ? 'dark' : 'light') : setting;
      document.documentElement.dataset.gain = ledger?.settings.gainColor ?? 'green';
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [ledger?.settings.theme, ledger?.settings.gainColor]);
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
    navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .then((reg) => {
        if (reg.waiting) setWaiting(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const worker = reg.installing;
          worker?.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller)
              setWaiting(worker);
          });
        });
        reg.update().catch(() => {});
      })
      .catch(() => notify(tr('离线缓存未能启用，请检查 HTTPS 和浏览器设置')));
    const changed = () => {
      if (updateRequested.current) location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', changed);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', changed);
  }, [notify]);
  const refresh = useCallback(
    async (force = false, quiet = false) => {
      if (isRefreshing.current || !ledgerRef.current) return;
      isRefreshing.current = true;
      setRefreshing(true);
      const failures: string[] = [];
      try {
        const current = ledgerRef.current;
        const list =
          mode === 'demo'
            ? []
            : current.holdings
                .filter(
                  (h) =>
                    canRefreshPrice(h) &&
                    (force ||
                      !h.price ||
                      Date.now() - Date.parse(h.price.fetchedAt) > priceRefreshInterval(h)),
                )
                .slice(0, 25);
        const prices = new Map<string, Holding['price']>();
        if (navigator.onLine) {
          for (const h of list) {
            try {
              prices.set(h.id, await fetchPrice(h));
            } catch (e) {
              failures.push(tr('{name}：{error}', { name: h.name, error: humanError(e) }));
            }
          }
        } else if (list.length) failures.push(tr('当前离线，未获取新行情'));
        // Automatic CNY rates first, so cross-currency 定投 below can settle in this pass.
        let autoRates: AutoRate[] | null = null;
        if (mode !== 'demo' && navigator.onLine)
          try {
            autoRates = await loadAutoRates(current);
          } catch (e) {
            failures.push(humanError(e));
          }
        const withRates = autoRates ? mergeAutoRates(current, autoRates) : current;
        // 定投: create every period due by now, then price pending ones (real ledger, online).
        let runUpdates: RunUpdate[] = [];
        if (mode !== 'demo' && navigator.onLine && current.plans.length) {
          await loadHolidays(holidayYearsNeeded(current));
          runUpdates = await resolveRuns(
            generateRuns(withRates, Date.now(), cachedCalendar),
            browserPriceDeps,
          );
        }
        let settled = 0,
          subscriptionCharges = 0,
          subscriptionWaiting: string[] = [];
        await commit((l) => {
          const withPrices = {
            ...(autoRates ? mergeAutoRates(l, autoRates) : l),
            holdings: l.holdings.map((h) =>
              prices.has(h.id) ? { ...h, price: prices.get(h.id)! } : h,
            ),
          };
          const generated = generateRuns(withPrices, Date.now(), cachedCalendar);
          // Skip runs the user confirmed or deleted while prices were loading.
          const fresh = runUpdates.filter((u) =>
            generated.planRuns.some((r) => r.id === u.id && r.status === 'pending' && !r.manual),
          );
          const next = applyRunUpdates(generated, fresh);
          settled = next.planRuns.filter(
            (r) => r.status === 'confirmed' && fresh.some((u) => u.id === r.id),
          ).length;
          // 订阅: book every charge that has come due (local only, works offline too).
          const charged = chargeSubscriptions(next);
          subscriptionCharges = charged.charged;
          subscriptionWaiting = charged.blocked;
          return charged.ledger;
        });
        failures.push(...subscriptionWaiting);
        if (subscriptionCharges)
          notify(tr('订阅已到扣款日，自动记账 {count} 笔', { count: subscriptionCharges }));
        if (settled) notify(tr('定投已按当期价格入账 {count} 期', { count: settled }));
        setErrors(failures);
        if (!quiet)
          notify(
            failures.length
              ? tr('部分行情未更新，原有数据已保留')
              : mode === 'demo'
                ? tr('演示快照已更新，未请求真实接口')
                : prices.size
                  ? tr('公共行情与当日快照已更新')
                  : tr('账本与当日快照已更新；汇率及未覆盖的价格需手动维护'),
          );
      } catch (e) {
        if (!quiet) notify(humanError(e));
      } finally {
        isRefreshing.current = false;
        setRefreshing(false);
      }
    },
    [mode, commit, notify],
  );
  useEffect(() => {
    if (ledger && loadedMode.current !== mode) {
      loadedMode.current = mode;
      void refresh(false, true);
    }
  }, [ledger, mode, refresh]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) void refresh(false, true);
    }, 5 * 60000);
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh(false, true);
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [refresh]);
  function setMode(next: string) {
    if (isRefreshing.current) {
      notify(tr('正在刷新，请稍后切换账本'));
      return;
    }
    setModal(null);
    sessionStorage.setItem('shizhang-mode', next);
    setModeState(next);
    loadedMode.current = '';
  }
  function addTransaction() {
    if (!ledger?.accounts.length) {
      setModal({ type: 'account' });
      notify(tr('先添加一个账户，再记第一笔'));
    } else setModal({ type: 'transaction' });
  }
  async function deleteRecord(t: Transaction) {
    await commit((l) => {
      if (l.transactions.some((x) => x.refundOf === t.id))
        throw new Error(tr('此支出有关联退款，请先删除退款记录'));
      return { ...l, transactions: l.transactions.filter((x) => x.id !== t.id) };
    });
    setModal(null);
    notify(tr('账单已删除，余额和统计已重算'));
  }
  function deleteRun(r: PlanRun) {
    if (!confirm(tr('删除这期定投记录？来源和去向会重新计算，计划不会再补生成这一期。'))) return;
    commit((l) => ({ ...l, planRuns: l.planRuns.filter((x) => x.id !== r.id) }))
      .then(() => notify(tr('这期定投记录已删除，余额与持仓已重算')))
      .catch((e) => notify(humanError(e)));
  }
  async function refreshOne(h: Holding) {
    if (mode === 'demo') {
      notify(tr('演示模式不请求真实行情'));
      return;
    }
    try {
      const price = await fetchPrice(h);
      await commit((l) => ({
        ...l,
        holdings: l.holdings.map((x) => (x.id === h.id ? { ...x, price } : x)),
      }));
      notify(tr('官方公共行情已更新'));
    } catch (e) {
      notify(humanError(e));
    }
  }
  if (!ledger)
    return (
      <div className="loading-screen">
        <span className="app-icon">
          <Icon name="book" size={32} />
        </span>
        <h1>{tr('拾账')}</h1>
        {fatal ? (
          <>
            <Notice tone="warning">{fatal}</Notice>
            <Button onClick={() => location.reload()}>{tr('重新打开')}</Button>
          </>
        ) : (
          <p>{tr('正在打开你的本地账本…')}</p>
        )}
      </div>
    );
  const currentPage = navigation.some(([id]) => id === page) ? page : 'overview',
    currentAccount =
      modal && 'record' in modal && modal.record && 'opening' in modal.record
        ? ledger.accounts.find((a) => a.id === modal.record!.id)
        : undefined,
    currentHolding =
      modal && 'record' in modal && modal.record && 'symbol' in modal.record
        ? ledger.holdings.find((h) => h.id === modal.record!.id)
        : undefined,
    currentPlan =
      modal?.type === 'plan-detail'
        ? ledger.plans.find((p) => p.id === modal.record.id)
        : undefined,
    currentRun =
      modal?.type === 'run' ? ledger.planRuns.find((r) => r.id === modal.record.id) : undefined;
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        {tr('跳到主要内容')}
      </a>
      <aside className="sidebar">
        <a href="#overview" className="brand" onClick={() => navigate('overview')}>
          <span className="brand-icon">
            <Icon name="book" size={25} />
          </span>
          <span>
            {tr('拾账')}
            <small>{tr('把生活，理清楚。')}</small>
          </span>
        </a>
        <div className="workspace-label">{tr('我的个人账本')}</div>
        <nav aria-label={tr('主要导航')}>
          {navigation.map(([id, icon, name]) => (
            <button
              key={id}
              onClick={() => navigate(id)}
              className={currentPage === id ? 'selected' : ''}
              aria-current={currentPage === id ? 'page' : undefined}
            >
              <Icon name={icon} size={21} />
              <span>{name}</span>
              {currentPage === id && <i />}
            </button>
          ))}
        </nav>
        <button className="sidebar-add" onClick={addTransaction}>
          <Icon name="plus" size={21} />
          {tr('记一笔')}
        </button>
        <div className="sidebar-bottom">
          <div className="local-private">
            <Icon name="shield" size={21} />
            <div>
              <strong>{tr('私有 · 离线优先')}</strong>
              <span>{tr('仅保存在当前设备')}</span>
            </div>
          </div>
          <button
            onClick={() => setMode(mode === 'real' ? 'demo' : 'real')}
            className="demo-switch"
          >
            {mode === 'real' ? tr('体验演示账本') : tr('返回真实账本')}
            <Icon name="arrow" size={15} />
          </button>
          <p>{tr('拾起每一笔，照顾每一天。')}</p>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span className="mobile-wordmark">
              <Icon name="book" />
              {tr('拾账')}
            </span>
            <span className="desktop-only">{tr('个人财务')}</span>
            <span className="desktop-only">/</span>
            <strong>{navigation.find(([id]) => id === currentPage)![2]}</strong>
          </div>
          <div className="topbar-actions">
            <button
              className={`device-status sync-${syncLabel(syncStatus, syncInfo, mode).tone} ${!online ? 'is-offline' : ''}`}
              onClick={() => {
                navigate('settings');
                setSettingsJump((n) => n + 1);
              }}
              aria-label={tr('同步状态：{text}，打开同步设置', {
                text: syncLabel(syncStatus, syncInfo, mode).text,
              })}
            >
              <Icon
                name={!online ? 'offline' : syncStatus.kind === 'synced' ? 'check' : 'shield'}
                size={15}
              />
              <span>{syncLabel(syncStatus, syncInfo, mode).text}</span>
            </button>
            <span className="topbar-divider" />
            <IconButton
              name={ledger.settings.hideAmounts ? 'eyeoff' : 'eye'}
              label={ledger.settings.hideAmounts ? tr('显示金额') : tr('隐藏金额')}
              onClick={() =>
                commit((l) => ({
                  ...l,
                  settings: { ...l.settings, hideAmounts: !l.settings.hideAmounts },
                })).catch((e) => notify(humanError(e)))
              }
            />
            <button
              className={`icon-button ${refreshing ? 'refreshing' : ''}`}
              aria-label={tr('刷新账本和公共行情')}
              disabled={refreshing}
              onClick={() => refresh(true)}
            >
              <Icon name="refresh" />
            </button>
            <span className="avatar" aria-label={tr('个人账本')}>
              {tr('拾')}
            </span>
          </div>
        </header>
        <main id="main-content" className="main-content">
          {mode === 'demo' && (
            <div className="demo-banner">
              <Icon name="info" size={18} />
              <span>
                <strong>{tr('独立演示账本')}</strong>{' '}
                {tr('· 所有示例持仓与历史行情仅用于演示，不是真实资产。')}
              </span>
              <button onClick={() => setMode('real')}>
                {tr('返回真实账本')}
                <Icon name="arrow" size={16} />
              </button>
            </div>
          )}
          {waiting && (
            <div className="update-banner">
              <Icon name="refresh" size={18} />
              <span>
                {tr('拾账有新版本。')}
                {modal
                  ? tr('请先保存或关闭当前表单，草稿会保留。')
                  : tr('账本已保存在本地，可安全更新。')}
              </span>
              <Button
                disabled={!!modal}
                onClick={() => {
                  updateRequested.current = true;
                  waiting.postMessage({ type: 'SKIP_WAITING' });
                }}
              >
                {tr('更新应用')}
              </Button>
            </div>
          )}
          {currentPage === 'overview' && (
            <Overview
              ledger={ledger}
              onAdd={addTransaction}
              onAccount={() => setModal({ type: 'account' })}
              onNavigate={navigate}
              onEdit={(record) => setModal({ type: 'transaction', record })}
              onSubscription={(record) => setModal({ type: 'subscription', record })}
              errors={errors}
            />
          )}
          {currentPage === 'bills' && (
            <Bills
              ledger={ledger}
              onAdd={addTransaction}
              onEdit={(record) => setModal({ type: 'transaction', record })}
            />
          )}
          {currentPage === 'assets' && (
            <Assets
              ledger={ledger}
              onAccount={() => setModal({ type: 'account' })}
              onHolding={() => setModal({ type: 'holding' })}
              onAccountDetail={(record) => setModal({ type: 'account-detail', record })}
              onHoldingDetail={(record) => setModal({ type: 'holding-detail', record })}
              onPlan={() => setModal({ type: 'plan' })}
              onPlanDetail={(record) => setModal({ type: 'plan-detail', record })}
              onToggleSmall={() =>
                commit((l) => ({
                  ...l,
                  settings: { ...l.settings, hideSmall: !l.settings.hideSmall },
                })).catch((e) => notify(humanError(e)))
              }
            />
          )}
          {currentPage === 'settings' && (
            <Settings
              ledger={ledger}
              onSave={commit}
              onAccount={() => setModal({ type: 'account' })}
              onNavigate={navigate}
              onClear={() => setModal({ type: 'clear' })}
              mode={mode}
              setMode={setMode}
              notify={notify}
              onRefresh={() => void refresh(true, true)}
              syncStatus={syncStatus}
              syncInfo={syncInfo}
              onSyncNow={runSync}
              jumpToConnect={settingsJump}
            />
          )}
        </main>
        <footer className="app-footer">
          <span>{tr('拾账')}</span>
          <span>{tr('让每一笔，都有迹可循。')}</span>
          <span>{tr('本地优先 · 你的数据，由你掌握')}</span>
        </footer>
      </div>
      <nav className="bottom-nav" aria-label={tr('移动端主要导航')}>
        {navigation.map(([id, icon, name]) => (
          <button
            key={id}
            onClick={() => navigate(id)}
            className={currentPage === id ? 'selected' : ''}
            aria-current={currentPage === id ? 'page' : undefined}
          >
            <Icon name={icon} size={23} />
            <span>{name}</span>
          </button>
        ))}
      </nav>
      {toast && (
        <div className="toast" role="status">
          <Icon name="info" size={18} />
          <span>{toast}</span>
          <button aria-label={tr('关闭提示')} onClick={() => setToast('')}>
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
      {modal?.type === 'transaction' && (
        <Modal
          title={modal.record ? tr('账单详情与编辑') : tr('记一笔')}
          onClose={() => setModal(null)}
        >
          <TransactionForm
            ledger={ledger}
            record={modal.record}
            onSave={commit}
            onClose={() => setModal(null)}
            mode={mode}
          />
          {modal.record && <DeleteTransaction record={modal.record} onDelete={deleteRecord} />}
        </Modal>
      )}
      {modal?.type === 'account' && (
        <Modal
          title={modal.record ? tr('编辑账户') : tr('添加账户')}
          onClose={() => setModal(null)}
        >
          <AccountForm record={modal.record} onSave={commit} onClose={() => setModal(null)} />
        </Modal>
      )}
      {modal?.type === 'holding' && (
        <Modal
          title={modal.record ? tr('编辑期初持仓') : tr('添加投资持仓')}
          onClose={() => setModal(null)}
        >
          <HoldingForm record={modal.record} onSave={commit} onClose={() => setModal(null)} />
        </Modal>
      )}
      {modal?.type === 'account-detail' && currentAccount && (
        <Modal title={currentAccount.name} onClose={() => setModal(null)}>
          <div className="detail-body">
            <div className="detail-hero">
              <span>
                {accountKinds[currentAccount.kind]} ·{' '}
                {currentAccount.source === 'manual' ? tr('手动账本') : tr('外部快照')}
              </span>
              <strong>
                {ledger.settings.hideAmounts
                  ? '••••'
                  : `${currentAccount.currency} ${exact(accountBalance(ledger, currentAccount))}`}
              </strong>
              <p>
                {tr('期初余额')} {ledger.settings.hideAmounts ? '••••' : currentAccount.opening}
              </p>
            </div>
            <Notice>
              {currentAccount.source === 'manual'
                ? tr('余额由期初余额与全部账本记录重新计算。历史记录修改或删除后自动更正。')
                : tr('余额仅依据外部最近快照，不再次扣减本地生活账单。')}
            </Notice>
            <div className="button-group wrap">
              {currentAccount.source === 'manual' && (
                <Button onClick={() => setModal({ type: 'account', record: currentAccount })}>
                  <Icon name="edit" />
                  {tr('编辑账户')}
                </Button>
              )}
              <Button
                variant="danger"
                onClick={() =>
                  commit((l) => {
                    if (
                      l.transactions.some(
                        (t) =>
                          t.accountId === currentAccount.id || t.toAccountId === currentAccount.id,
                      ) ||
                      l.investments.some((t) => t.accountId === currentAccount.id)
                    )
                      throw new Error(tr('账户已有账单或投资记录引用，请先删除或迁移这些记录'));
                    if (l.subscriptions.some((s) => s.accountId === currentAccount.id))
                      throw new Error(tr('账户被订阅引用，请先删除或改用其他扣款账户'));
                    if (
                      [...l.plans, ...l.planRuns].some(
                        (p) => p.sourceType === 'account' && p.sourceId === currentAccount.id,
                      )
                    )
                      throw new Error(tr('账户被定投计划或记录引用，请先删除相关定投'));
                    if (!accountBalance(l, currentAccount).eq(0))
                      throw new Error(tr('请先确认期初余额为零，再删除账户'));
                    return { ...l, accounts: l.accounts.filter((a) => a.id !== currentAccount.id) };
                  })
                    .then(() => {
                      setModal(null);
                      notify(tr('空账户已删除'));
                    })
                    .catch((e) => notify(humanError(e)))
                }
              >
                <Icon name="trash" />
                {tr('删除空账户')}
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {modal?.type === 'holding-detail' && currentHolding && (
        <Modal title={currentHolding.name} wide onClose={() => setModal(null)}>
          <HoldingDetail
            ledger={ledger}
            holding={currentHolding}
            onPrice={() => setModal({ type: 'price', record: currentHolding })}
            onEdit={() => setModal({ type: 'holding', record: currentHolding })}
            onTrade={() => setModal({ type: 'trade', record: currentHolding })}
            onRefresh={() => refreshOne(currentHolding)}
            onDelete={() => {
              if (ledger.investments.some((e) => e.holdingId === currentHolding.id)) {
                notify(tr('请先删除此持仓的投资记录，再删除持仓'));
                return;
              }
              if (
                [...ledger.plans, ...ledger.planRuns].some(
                  (p) =>
                    p.targetId === currentHolding.id ||
                    (p.sourceType === 'holding' && p.sourceId === currentHolding.id),
                )
              ) {
                notify(tr('此持仓被定投计划或记录引用，请先删除相关定投'));
                return;
              }
              if (!confirm(tr('删除此持仓？这将改变资产总额。'))) return;
              commit((l) => ({
                ...l,
                holdings: l.holdings.filter((h) => h.id !== currentHolding.id),
              }))
                .then(() => setModal(null))
                .catch((e) => notify(humanError(e)));
            }}
            onDeleteEvent={(e) => {
              if (!confirm(tr('删除此投资记录？持仓数量、成本与结算账户余额会重新计算。'))) return;
              commit((l) => ({ ...l, investments: l.investments.filter((x) => x.id !== e.id) }))
                .then(() => notify(tr('投资记录已删除，余额已重算')))
                .catch((e) => notify(humanError(e)));
            }}
            onConfirm={(record) => setModal({ type: 'confirm-investment', record })}
            onPlan={() => setModal({ type: 'plan', targetId: currentHolding.id })}
            onRun={(record) => setModal({ type: 'run', record })}
            onDeleteRun={deleteRun}
          />
        </Modal>
      )}
      {modal?.type === 'plan' && (
        <Modal
          title={modal.record ? tr('编辑定投计划') : tr('新建定投计划')}
          wide
          onClose={() => setModal(null)}
        >
          <PlanForm
            ledger={ledger}
            record={modal.record}
            targetId={modal.targetId}
            onSave={commit}
            onClose={() => {
              setModal(null);
              void refresh(false, true);
            }}
          />
        </Modal>
      )}
      {modal?.type === 'plan-detail' && currentPlan && (
        <Modal title={currentPlan.name} wide onClose={() => setModal(null)}>
          <PlanDetail
            ledger={ledger}
            plan={currentPlan}
            onEdit={() => setModal({ type: 'plan', record: currentPlan })}
            onSave={commit}
            onClose={() => setModal(null)}
            onRun={(record) => setModal({ type: 'run', record, back: currentPlan })}
            onDeleteRun={deleteRun}
            notify={notify}
          />
        </Modal>
      )}
      {modal?.type === 'run' && currentRun && (
        <Modal title={tr('确认定投成交')} onClose={() => setModal(null)}>
          <RunForm
            ledger={ledger}
            run={currentRun}
            onSave={commit}
            onClose={() =>
              setModal(modal.back ? { type: 'plan-detail', record: modal.back } : null)
            }
          />
        </Modal>
      )}
      {modal?.type === 'price' && currentHolding && (
        <Modal title={tr('更新单位价格')} onClose={() => setModal(null)}>
          <PriceForm
            holding={currentHolding}
            onSave={commit}
            onClose={() => setModal({ type: 'holding-detail', record: currentHolding })}
          />
        </Modal>
      )}
      {modal?.type === 'trade' && currentHolding && (
        <Modal title={tr('记录投资操作')} onClose={() => setModal(null)}>
          <InvestmentForm
            ledger={ledger}
            holding={currentHolding}
            onSave={commit}
            onClose={() => setModal({ type: 'holding-detail', record: currentHolding })}
          />
        </Modal>
      )}
      {modal?.type === 'confirm-investment' && (
        <Modal title={tr('确认实际成交')} onClose={() => setModal(null)}>
          <ConfirmInvestment event={modal.record} onSave={commit} onClose={() => setModal(null)} />
        </Modal>
      )}
      {modal?.type === 'subscription' && (
        <Modal
          title={modal.record ? modal.record.name : tr('添加订阅')}
          wide
          onClose={() => setModal(null)}
        >
          <SubscriptionForm
            ledger={ledger}
            record={modal.record && ledger.subscriptions.find((s) => s.id === modal.record!.id)}
            onSave={commit}
            onClose={() => {
              setModal(null);
              void refresh(false, true);
            }}
            notify={notify}
          />
        </Modal>
      )}
      {modal?.type === 'clear' && (
        <Modal title={tr('清空当前账本')} onClose={() => setModal(null)}>
          <ClearForm
            mode={mode}
            onConfirm={async () => {
              await commit((current) => ({ ...emptyLedger(), revision: current.revision }));
              await deleteDraft(mode);
              setModal(null);
              notify(tr('当前账本已清空'));
            }}
            onClose={() => setModal(null)}
          />
        </Modal>
      )}
    </div>
  );
}
function DeleteTransaction({
  record,
  onDelete,
}: {
  record: Transaction;
  onDelete: (t: Transaction) => Promise<void>;
}) {
  const [confirm, setConfirm] = useState(false),
    [error, setError] = useState('');
  return (
    <div className="delete-transaction">
      {confirm ? (
        <>
          <span>{tr('删除后将重算余额与收支。')}</span>
          <div className="button-group">
            <Button onClick={() => setConfirm(false)}>{tr('取消')}</Button>
            <Button
              variant="danger"
              onClick={() => onDelete(record).catch((e) => setError(humanError(e)))}
            >
              {tr('确认删除')}
            </Button>
          </div>
        </>
      ) : (
        <Button variant="text" onClick={() => setConfirm(true)}>
          <Icon name="trash" size={17} />
          {tr('删除这笔记录')}
        </Button>
      )}
      <ErrorText error={error} />
    </div>
  );
}
function ClearForm({
  mode,
  onConfirm,
  onClose,
}: {
  mode: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState(''),
    [error, setError] = useState(''),
    word = tr('清空');
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        if (text === word) onConfirm().catch((e) => setError(humanError(e)));
      }}
    >
      <Notice tone="warning">
        {mode === 'demo'
          ? tr(
              '将删除当前演示账本中的全部账户、账单、持仓与设置。请先导出 JSON 备份。另一个账本不受影响。',
            )
          : tr(
              '将删除当前真实账本中的全部账户、账单、持仓与设置。请先导出 JSON 备份。另一个账本不受影响。',
            )}
        {mode === 'real' &&
          tr(
            '真实账本已与电脑主库同步：清空会同步到电脑和其他设备（电脑主库每天自动备份，保留 60 天）。',
          )}
      </Notice>
      <Field label={tr('输入“{word}”确认', { word })}>
        <input value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />
      </Field>
      <ErrorText error={error} />
      <div className="form-actions">
        <Button onClick={onClose}>{tr('取消')}</Button>
        <Button variant="danger" type="submit" disabled={text !== word}>
          {tr('确认清空账本')}
        </Button>
      </div>
    </form>
  );
}
function ConfirmInvestment({
  event,
  onSave,
  onClose,
}: {
  event: Investment;
  onSave: Commit;
  onClose: () => void;
}) {
  const [quantity, setQuantity] = useState(event.quantity),
    [cash, setCash] = useState(event.cash),
    [fee, setFee] = useState(event.fee),
    [error, setError] = useState('');
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await onSave((l) => ({
            ...l,
            investments: l.investments.map((x) =>
              x.id === event.id ? { ...x, quantity, cash, fee, status: 'confirmed' } : x,
            ),
          }));
          onClose();
        } catch (e) {
          setError(humanError(e));
        }
      }}
    >
      <Notice>
        {tr(
          '请按正式交易确认单填写精确份额、成交总金额及手续费。确认后以原记录日期结算。如日期需更正，请删除并重新建立该笔记录。',
        )}
      </Notice>
      <Field label={tr('正式确认份额')}>
        <input
          inputMode="decimal"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          required
        />
      </Field>
      <Field label={tr('实际成交总金额（不含手续费）')}>
        <input
          inputMode="decimal"
          value={cash}
          onChange={(e) => setCash(e.target.value)}
          required
        />
      </Field>
      <Field label={tr('实际手续费')}>
        <input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} required />
      </Field>
      <ErrorText error={error} />
      <div className="form-actions">
        <Button onClick={onClose}>{tr('取消')}</Button>
        <Button type="submit" variant="primary">
          {tr('确认并重新结算')}
        </Button>
      </div>
    </form>
  );
}
