import { type ReactNode, useEffect, useRef } from 'react';
import {
  BookOpenText,
  SquaresFour,
  Receipt,
  Wallet,
  GearSix,
  Plus,
  X,
  CaretRight,
  Eye,
  EyeSlash,
  ArrowClockwise,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowsLeftRight,
  ForkKnife,
  ShoppingBag,
  Car,
  House,
  GameController,
  Heart,
  DotsThree,
  Gift,
  Bank,
  Coins,
  TrendUp,
  ShieldCheck,
  CloudSlash,
  DownloadSimple,
  UploadSimple,
  MagnifyingGlass,
  CaretLeft,
  Trash,
  PencilSimple,
  Check,
  WarningCircle,
  ChartLineUp,
  Globe,
  DeviceMobile,
  Sun,
  Moon,
  Desktop,
  Info,
  CurrencyBtc,
  ArrowRight,
  SignOut,
  LockKey,
  CalendarBlank,
  ChartDonut,
  FolderOpen,
} from '@phosphor-icons/react';
const icons = {
  book: BookOpenText,
  overview: SquaresFour,
  receipt: Receipt,
  wallet: Wallet,
  settings: GearSix,
  plus: Plus,
  close: X,
  right: CaretRight,
  eye: Eye,
  eyeoff: EyeSlash,
  refresh: ArrowClockwise,
  up: ArrowUpRight,
  down: ArrowDownLeft,
  transfer: ArrowsLeftRight,
  fork: ForkKnife,
  bag: ShoppingBag,
  car: Car,
  house: House,
  game: GameController,
  heart: Heart,
  dots: DotsThree,
  gift: Gift,
  bank: Bank,
  coins: Coins,
  trend: TrendUp,
  shield: ShieldCheck,
  offline: CloudSlash,
  download: DownloadSimple,
  upload: UploadSimple,
  search: MagnifyingGlass,
  left: CaretLeft,
  trash: Trash,
  edit: PencilSimple,
  check: Check,
  warning: WarningCircle,
  chart: ChartLineUp,
  globe: Globe,
  phone: DeviceMobile,
  sun: Sun,
  moon: Moon,
  desktop: Desktop,
  info: Info,
  btc: CurrencyBtc,
  arrow: ArrowRight,
  logout: SignOut,
  lock: LockKey,
  calendar: CalendarBlank,
  donut: ChartDonut,
  folder: FolderOpen,
};
export type IconName = keyof typeof icons;
export function Icon({
  name,
  size = 20,
  className = '',
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const Component = icons[name as IconName] ?? DotsThree;
  return <Component size={size} weight="regular" className={className} aria-hidden="true" />;
}
export function Button({
  children,
  onClick,
  variant = 'secondary',
  type = 'button',
  disabled = false,
  className = '',
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'text' | 'danger';
  type?: 'button' | 'submit';
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`button ${variant} ${className}`}
      title={title}
    >
      {children}
    </button>
  );
}
export function IconButton({
  name,
  label,
  onClick,
  disabled = false,
}: {
  name: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      className="icon-button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon name={name} />
    </button>
  );
}
export function Empty({
  icon = 'folder',
  title,
  description,
  action,
}: {
  icon?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name={icon} size={26} />
      </span>
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Panel({
  title,
  aside,
  children,
  className = '',
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <h2>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
export function Notice({
  children,
  tone = 'info',
}: {
  children: ReactNode;
  tone?: 'info' | 'warning' | 'success';
}) {
  return (
    <div className={`notice ${tone}`}>
      <Icon
        name={tone === 'warning' ? 'warning' : tone === 'success' ? 'check' : 'info'}
        size={18}
      />
      <div>{children}</div>
    </div>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    previous = useRef<Element | null>(null);
  useEffect(() => {
    previous.current = document.activeElement;
    ref.current?.showModal();
    return () => {
      (previous.current as HTMLElement)?.focus?.();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'wide' : ''}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) {
          const b = ref.current.getBoundingClientRect();
          if (
            e.clientX < b.left ||
            e.clientX > b.right ||
            e.clientY < b.top ||
            e.clientY > b.bottom
          )
            onClose();
        }
      }}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <IconButton name="close" label="关闭弹窗" onClick={onClose} />
      </div>
      {children}
    </dialog>
  );
}
export function ErrorText({ error }: { error: string }) {
  return error ? (
    <p className="form-error" role="alert" tabIndex={-1}>
      {error}
    </p>
  ) : null;
}
export function DownloadLink({
  label,
  content,
  name,
  type,
}: {
  label: string;
  content: () => string;
  name: string;
  type: string;
}) {
  return (
    <Button
      onClick={() => {
        const blob = new Blob([content()], { type }),
          url = URL.createObjectURL(blob),
          a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }}
    >
      <Icon name="download" />
      {label}
    </Button>
  );
}
export function humanError(e: unknown): string {
  if (e instanceof Error) {
    if (e.name === 'ZodError') return '数据字段不符合要求，请检查金额、日期和必填项。';
    if (e.name === 'TimeoutError') return '请求超时，已保留原有数据。';
    // fetch() rejects with a bare TypeError when nothing answers. The page itself may still
    // load from the offline cache, so say plainly that the backend is not running.
    if (e.name === 'TypeError' && /fetch|NetworkError|Load failed/i.test(e.message))
      return '连接不到网站后端：后端没有运行或已经退出（当前页面来自浏览器离线缓存）。请查看启动网站的终端，重新运行 npm start 或 npm run start:private。';
    return e.message;
  }
  return '操作失败，请重试';
}
