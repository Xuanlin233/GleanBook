import { afterEach, describe, expect, it, vi } from 'vitest';
import { safeNetworkError } from '../server/network-error';
import { checkOKXNetwork, publicTicker, syncOKX } from '../server/okx';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('OKX 网络错误诊断与凭证保护', () => {
  it('区分超时、DNS、证书和未知失败，只输出允许列表内的错误码', () => {
    const cases = [
      [new DOMException('private test text', 'TimeoutError'), 'TIMEOUT'],
      [new TypeError('private proxy url', { cause: { code: 'ENOTFOUND' } }), 'ENOTFOUND'],
      [
        new TypeError('private headers', {
          cause: new AggregateError([{ code: 'SELF_SIGNED_CERT_IN_CHAIN' }]),
        }),
        'SELF_SIGNED_CERT_IN_CHAIN',
      ],
      [{ code: 'secret-value-must-not-appear', message: 'private token' }, 'REQUEST_FAILED'],
      // An unknown system code is kept (code name only) so the user can report it.
      [
        new TypeError('fetch failed', { cause: { code: 'ENOBUFS', message: 'private' } }),
        'REQUEST_FAILED:ENOBUFS',
      ],
      [new TypeError('fetch failed', { cause: { code: 'ECONNABORTED' } }), 'ECONNABORTED'],
    ] as const;
    for (const [error, code] of cases) {
      const safe = safeNetworkError(error);
      expect(safe.code).toBe(code);
      expect(JSON.stringify(safe)).not.toMatch(/private|secret-value|token|headers/);
    }
  });
  it('循环错误 cause 不会无限递归或泄漏错误原文', () => {
    const e: { cause?: unknown; message: string } = { message: 'secret' };
    e.cause = e;
    expect(safeNetworkError(e).code).toBe('REQUEST_FAILED');
    expect(safeNetworkError(e).retryable).toBe(true);
  });
  it('公共预检即使存在环境凭证也绝不发送认证头', async () => {
    vi.stubEnv('OKX_API_KEY', 'not-a-real-key');
    vi.stubEnv('OKX_API_SECRET', 'not-a-real-secret');
    vi.stubEnv('OKX_API_PASSPHRASE', 'not-a-real-passphrase');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, init) => {
        expect(url).toBe('https://openapi.okx.com/api/v5/public/time');
        expect(init.headers).toEqual({ Accept: 'application/json' });
        expect(init.redirect).toBe('error');
        return new Response(JSON.stringify({ code: '0', data: [{ ts: '1792153318372' }] }));
      }),
    );
    expect((await checkOKXNetwork()).reachable).toBe(true);
  });
  it('TLS 校验失败不重试，不吞掉证书原因，不回传原错误消息', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('secret must remain private', {
        cause: { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' },
      });
    });
    vi.stubGlobal('fetch', f);
    await expect(publicTicker('BTC-USDT')).rejects.toThrow('TLS 证书链无法验证');
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('临时连接超时只重试一次，保留安全错误码', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('private', { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } });
    });
    vi.stubGlobal('fetch', f);
    await expect(publicTicker('BTC-USDT')).rejects.toThrow('[UND_ERR_CONNECT_TIMEOUT]');
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('非 ASCII 请求头凭证在发出请求前被拒绝，不误报网络超时', async () => {
    vi.stubEnv('OKX_API_KEY', 'API Key：误粘贴标签');
    vi.stubEnv('OKX_API_SECRET', 'test-secret');
    vi.stubEnv('OKX_API_PASSPHRASE', 'test-pass');
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    await expect(syncOKX()).rejects.toThrow('这不是网络超时');
    expect(f).not.toHaveBeenCalled();
  });
});
