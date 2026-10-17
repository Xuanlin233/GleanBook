import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  canSaveCredentials,
  credentialFile,
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
