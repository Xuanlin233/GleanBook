// Saved OKX read-only credentials for the local launcher, encrypted with Windows DPAPI
// (CurrentUser scope): only this Windows account on this machine can decrypt the file.
// The file lives in %APPDATA%\gleanbook, outside the project, so it is never packaged.
// Secrets travel to PowerShell through stdin as base64, never as command-line arguments.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

export const credentialSchema = z.object({
  key: z.string().min(1).max(200),
  secret: z.string().min(1).max(200),
  passphrase: z.string().min(1).max(200),
  accessToken: z.string().min(32).max(500),
});
export type SavedCredentials = z.infer<typeof credentialSchema>;
const fileSchema = z.object({
  format: z.literal('shizhang-okx-dpapi'),
  version: z.literal(1),
  savedAt: z.string(),
  data: z.string().regex(/^[A-Za-z0-9+/=]+$/),
});

export const credentialFile = () =>
  path.join(
    process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
    'gleanbook',
    'okx-credentials.dpapi',
  );
export const canSaveCredentials = () => process.platform === 'win32';

// Fixed, app-specific entropy: another program using DPAPI for the same user cannot
// decrypt this blob by accident without also knowing it.
const ENTROPY = 'c2hpemhhbmctb2t4LXYx';
function dpapi(mode: 'Protect' | 'Unprotect', base64: string): string {
  const script = [
    '$ErrorActionPreference = "Stop"',
    'Add-Type -AssemblyName System.Security',
    '$in = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())',
    `$entropy = [Convert]::FromBase64String("${ENTROPY}")`,
    `$out = [Security.Cryptography.ProtectedData]::${mode}($in, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)`,
    '[Console]::Out.Write([Convert]::ToBase64String($out))',
  ].join('; ');
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    input: base64,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20000,
    stdio: ['pipe', 'pipe', 'ignore'],
  }).trim();
}

export function saveCredentials(c: SavedCredentials) {
  if (!canSaveCredentials()) throw new Error('仅 Windows 支持加密保存凭证');
  const data = dpapi(
    'Protect',
    Buffer.from(JSON.stringify(credentialSchema.parse(c))).toString('base64'),
  );
  const file = credentialFile();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({
      format: 'shizhang-okx-dpapi',
      version: 1,
      savedAt: new Date().toISOString(),
      data,
    }),
    { encoding: 'utf8', mode: 0o600 },
  );
  return file;
}

// null when nothing is saved; throws when a file exists but cannot be decrypted
// (another Windows user, another machine, or a damaged file).
export function loadCredentials(): SavedCredentials | null {
  if (!canSaveCredentials()) return null;
  let text: string;
  try {
    text = readFileSync(credentialFile(), 'utf8');
  } catch {
    return null;
  }
  const file = fileSchema.parse(JSON.parse(text));
  return credentialSchema.parse(
    JSON.parse(Buffer.from(dpapi('Unprotect', file.data), 'base64').toString('utf8')),
  );
}

export function forgetCredentials() {
  rmSync(credentialFile(), { force: true });
}
