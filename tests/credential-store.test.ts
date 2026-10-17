import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  canSaveCredentials,
  createCredentialStore,
  credentialBackend,
  credentialFile,
  type Runner,
  forgetCredentials,
  loadCredentials,
  saveCredentials,
} from '../scripts/credential-store';

const dir = mkdtempSync(path.join(os.tmpdir(), 'shizhang-cred-'));
const original = process.env.APPDATA;
beforeAll(() => {
  process.env.APPDATA = dir;
});
afterAll(() => {
  process.env.APPDATA = original;
  rmSync(dir, { recursive: true, force: true });
});

describe.runIf(canSaveCredentials())('Windows 加密保存凭证', () => {
  const c = {
    key: 'dummy-key-not-real',
    secret: 'dummy-secret-not-real',
    passphrase: 'dummy pass!',
    accessToken: 'x'.repeat(40),
  };
  it('文件中没有明文，能解密还原，删除后读不到', () => {
    const file = saveCredentials(c);
    expect(file).toBe(credentialFile());
    expect(file.startsWith(dir)).toBe(true);
    const raw = readFileSync(file, 'utf8');
    for (const v of Object.values(c)) expect(raw).not.toContain(v);
    expect(loadCredentials()).toEqual(c);
    forgetCredentials();
    expect(loadCredentials()).toBeNull();
  });
  it('文件被篡改时报错而不是返回错误凭证', () => {
    const file = saveCredentials(c);
    const json = JSON.parse(readFileSync(file, 'utf8'));
    json.data = json.data.slice(0, -8) + 'AAAAAAA=';
    writeFileSync(file, JSON.stringify(json));
    expect(() => loadCredentials()).toThrow();
    forgetCredentials();
  });
});

// A fake helper program that keeps one secret in memory, like the Keychain or a keyring.
function fakeSystem(platform: 'darwin' | 'linux') {
  let saved: string | null = null;
  const calls: { cmd: string; args: string[]; input?: string }[] = [];
  const fail = (status: number) => Object.assign(new Error('exit ' + status), { status });
  const exec: Runner = (cmd, args, input) => {
    calls.push({ cmd, args, input });
    if (platform === 'darwin') {
      if (args[0] === 'list-keychains') return '"login.keychain-db"';
      if (args[0] === '-i') {
        saved = /-w (\S+)\n$/.exec(input ?? '')![1];
        return '';
      }
      if (args[0] === 'find-generic-password') {
        if (saved === null) throw fail(44);
        return saved + '\n';
      }
      if (args[0] === 'delete-generic-password') {
        if (saved === null) throw fail(44);
        saved = null;
        return '';
      }
    } else {
      if (cmd === 'sh') return '/usr/bin/secret-tool\n';
      if (args[0] === 'store') {
        saved = input ?? '';
        return '';
      }
      if (args[0] === 'lookup') {
        if (saved === null) throw fail(1);
        return saved;
      }
      if (args[0] === 'clear') {
        saved = null;
        return '';
      }
    }
    throw new Error('unexpected ' + cmd + ' ' + args.join(' '));
  };
  return { exec, calls };
}

describe.each(['darwin', 'linux'] as const)('%s 系统密钥存储', (platform) => {
  const c = {
    key: 'dummy-key-not-real',
    secret: 'dummy-secret-not-real',
    passphrase: 'dummy pass!',
    accessToken: 'x'.repeat(40),
  };
  it('密钥只经 stdin 传递，不出现在命令行参数中；能读回、删除', () => {
    const sys = fakeSystem(platform),
      store = createCredentialStore(credentialBackend(platform, sys.exec));
    expect(store.canSave()).toBe(true);
    expect(store.load()).toBeNull();
    store.save(c);
    for (const call of sys.calls)
      for (const v of Object.values(c)) expect(call.args.join(' ')).not.toContain(v);
    expect(store.load()).toEqual(c);
    store.forget();
    expect(store.load()).toBeNull();
  });
  it('密钥工具不可用时不保存', () => {
    const store = createCredentialStore(
      credentialBackend(platform, () => {
        throw Object.assign(new Error('missing'), { status: 127 });
      }),
    );
    expect(store.canSave()).toBe(false);
    expect(store.load()).toBeNull();
    expect(() => store.save(c)).toThrow();
  });
  it('读取失败（如拒绝访问）时报错而不是当作未保存', () => {
    const sys = fakeSystem(platform),
      backend = credentialBackend(platform, (cmd, args, input) => {
        if (args[0] === 'find-generic-password' || args[0] === 'lookup')
          throw Object.assign(new Error('denied'), { status: 51 });
        return sys.exec(cmd, args, input);
      });
    expect(() => createCredentialStore(backend).load()).toThrow();
  });
});
