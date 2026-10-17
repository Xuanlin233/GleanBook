// Never serialize raw fetch errors: they can contain headers, proxy URLs or credentials.
const descriptions: Record<string, { message: string; retryable: boolean }> = {
  UND_ERR_CONNECT_TIMEOUT: {
    message: '连接 OKX 超时，请检查此 Node 进程的网络路径',
    retryable: true,
  },
  UND_ERR_HEADERS_TIMEOUT: { message: '等待 OKX 响应超时', retryable: true },
  UND_ERR_BODY_TIMEOUT: { message: '读取 OKX 响应超时', retryable: true },
  ETIMEDOUT: { message: '网络连接超时', retryable: true },
  TIMEOUT: { message: '请求超过等待时间', retryable: true },
  ENOTFOUND: { message: '无法解析 OKX 域名，请检查 DNS', retryable: false },
  EAI_AGAIN: { message: 'DNS 查询暂时失败', retryable: true },
  ECONNREFUSED: { message: '连接被拒绝，请检查网络或已配置代理是否可用', retryable: true },
  ECONNRESET: { message: '连接被远端或网络中断', retryable: true },
  ENETUNREACH: { message: '网络路由不可达，请检查 Node 进程的网络路径', retryable: true },
  EHOSTUNREACH: { message: '目标主机不可达', retryable: true },
  UND_ERR_SOCKET: { message: '网络连接意外关闭', retryable: true },
  CERT_HAS_EXPIRED: { message: 'TLS 证书已过期，请核对系统时间和证书链', retryable: false },
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: {
    message: 'TLS 证书链无法验证，请核对网络证书配置',
    retryable: false,
  },
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: {
    message: 'TLS 签发证书不受信任，请核对网络证书配置',
    retryable: false,
  },
  SELF_SIGNED_CERT_IN_CHAIN: { message: 'TLS 证书链包含不受信任的自签名证书', retryable: false },
  DEPTH_ZERO_SELF_SIGNED_CERT: { message: 'TLS 证书为不受信任的自签名证书', retryable: false },
  ERR_TLS_CERT_ALTNAME_INVALID: { message: 'TLS 证书与目标域名不匹配', retryable: false },
  ERR_INVALID_CHAR: { message: '请求头格式无效，请重新核对凭证输入', retryable: false },
  ECONNABORTED: { message: '连接被中止', retryable: true },
  EPIPE: { message: '连接已断开', retryable: true },
  EPROTO: { message: 'TLS 握手失败，请检查代理或 TUN 是否正常', retryable: true },
  UND_ERR_CLOSED: { message: '连接已关闭', retryable: true },
  UND_ERR_CONNECT: { message: '建立连接失败', retryable: true },
  // Unknown failures are often transient (network or TUN still starting after boot): retry once.
  REQUEST_FAILED: {
    message:
      '请求未能完成，尚未取得有效响应。刚开机时网络或代理可能还未就绪，请稍后重试；持续出现请运行 npm run diagnose:okx',
    retryable: true,
  },
};
export function safeNetworkError(error: unknown) {
  const seen = new Set<object>();
  let raw: string | null = null;
  function find(value: unknown, depth = 0): string | null {
    if (!value || typeof value !== 'object' || depth > 5 || seen.has(value)) return null;
    seen.add(value);
    const e = value as { code?: unknown; name?: unknown; cause?: unknown; errors?: unknown[] };
    if (typeof e.code === 'string' && Object.hasOwn(descriptions, e.code)) return e.code;
    // Remember the first unrecognized system code (only the code name, never the message).
    if (!raw && typeof e.code === 'string' && /^[A-Z][A-Z0-9_]{2,40}$/.test(e.code)) raw = e.code;
    if (e.name === 'TimeoutError' || e.name === 'AbortError') return 'TIMEOUT';
    const nested = find(e.cause, depth + 1);
    if (nested) return nested;
    if (Array.isArray(e.errors))
      for (const child of e.errors.slice(0, 8)) {
        const code = find(child, depth + 1);
        if (code) return code;
      }
    return null;
  }
  const known = find(error);
  const code = known ?? 'REQUEST_FAILED';
  return { code: known ?? (raw ? `REQUEST_FAILED:${raw}` : code), ...descriptions[code] };
}
