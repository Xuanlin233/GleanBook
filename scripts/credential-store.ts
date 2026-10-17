// Saved OKX read-only credentials for the local launcher, kept in the operating system's own
// secret store so only the current user can read them:
//   Windows  DPAPI (CurrentUser scope), file in %APPDATA%\gleanbook, outside the project
//   macOS    login Keychain, generic password with service "gleanbook-okx"
//   Linux    Secret Service through libsecret's secret-tool (GNOME Keyring, KWallet …)
// Secrets always reach the helper program through stdin, never as command-line arguments,
// so other processes cannot read them from the process list.
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

// Runs a helper program and returns its stdout; a failure throws with `status` (exit code).
export type Runner = (cmd: string, args: string[], input?: string) => string;
const run: Runner = (cmd, args, input) =>
  execFileSync(cmd, args, {
    input,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20000,
    stdio: ['pipe', 'pipe', 'ignore'],
  });
const exitStatus = (error: unknown) =>
  typeof error === 'object' && error && 'status' in error ? error.status : null;

export interface CredentialBackend {
  available(): boolean;
  // Where the credentials are kept, shown to the user.
  location(): string;
  // The saved base64 payload; null when nothing is saved; throws when it cannot be read.
  read(): string | null;
  write(base64: string): void;
  remove(): void;
}

// Fixed, app-specific entropy: another program using DPAPI for the same user cannot
// decrypt this blob by accident without also knowing it.
const ENTROPY = 'c2hpemhhbmctb2t4LXYx';
export const credentialFile = () =>
  path.join(
    process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
    'gleanbook',
    'okx-credentials.dpapi',
  );
function windowsBackend(exec: Runner): CredentialBackend {
  const dpapi = (mode: 'Protect' | 'Unprotect', base64: string) => {
    const script = [
      '$ErrorActionPreference = "Stop"',
      'Add-Type -AssemblyName System.Security',
      '$in = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())',
      `$entropy = [Convert]::FromBase64String("${ENTROPY}")`,
      `$out = [Security.Cryptography.ProtectedData]::${mode}($in, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)`,
      '[Console]::Out.Write([Convert]::ToBase64String($out))',
    ].join('; ');
    return exec(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      base64,
    ).trim();
  };
  return {
    available: () => true,
    location: credentialFile,
    read() {
      let text: string;
      try {
        text = readFileSync(credentialFile(), 'utf8');
      } catch {
        return null;
      }
      return dpapi('Unprotect', fileSchema.parse(JSON.parse(text)).data);
    },
    write(base64) {
      const file = credentialFile();
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(
        file,
        JSON.stringify({
          format: 'shizhang-okx-dpapi',
          version: 1,
          savedAt: new Date().toISOString(),
          data: dpapi('Protect', base64),
        }),
        { encoding: 'utf8', mode: 0o600 },
      );
    },
    remove: () => rmSync(credentialFile(), { force: true }),
  };
}

const SERVICE = 'gleanbook-okx',
  ACCOUNT = 'okx-read-only';
function macBackend(exec: Runner): CredentialBackend {
  const security = '/usr/bin/security',
    id = ['-s', SERVICE, '-a', ACCOUNT];
  return {
    available() {
      try {
        exec(security, ['list-keychains']);
        return true;
      } catch {
        return false;
      }
    },
    location: () => `macOS 钥匙串（登录钥匙串中的“${SERVICE}”）`,
    read() {
      try {
        return exec(security, ['find-generic-password', ...id, '-w']).trim() || null;
      } catch (error) {
        if (exitStatus(error) === 44) return null; // errSecItemNotFound
        throw error;
      }
    },
    // `security -i` reads the command from stdin, which keeps the secret out of argv.
    // The payload is base64, so it never needs quoting.
    write(base64) {
      exec(security, ['-i'], `add-generic-password -U ${id.join(' ')} -l Gleanbook -w ${base64}\n`);
    },
    remove() {
      try {
        exec(security, ['delete-generic-password', ...id]);
      } catch {
        /* nothing saved */
      }
    },
  };
}

function linuxBackend(exec: Runner): CredentialBackend {
  const attrs = ['service', SERVICE, 'account', ACCOUNT];
  return {
    available() {
      try {
        exec('sh', ['-c', 'command -v secret-tool']);
        return true;
      } catch {
        return false;
      }
    },
    location: () => `系统密钥环（Secret Service，service=${SERVICE}）`,
    read() {
      try {
        return exec('secret-tool', ['lookup', ...attrs]).trim() || null;
      } catch (error) {
        if (exitStatus(error) === 1) return null; // no matching item
        throw error;
      }
    },
    // secret-tool store reads the secret from stdin.
    write(base64) {
      exec('secret-tool', ['store', '--label=Gleanbook OKX read-only', ...attrs], base64);
    },
    remove() {
      try {
        exec('secret-tool', ['clear', ...attrs]);
      } catch {
        /* nothing saved */
      }
    },
  };
}

export function credentialBackend(
  platform: NodeJS.Platform = process.platform,
  exec: Runner = run,
): CredentialBackend | null {
  if (platform === 'win32') return windowsBackend(exec);
  if (platform === 'darwin') return macBackend(exec);
  if (platform === 'linux') return linuxBackend(exec);
  return null;
}

const decode = (base64: string) =>
  credentialSchema.parse(JSON.parse(Buffer.from(base64, 'base64').toString('utf8')));

export function createCredentialStore(backend = credentialBackend()) {
  const ok = () => !!backend && backend.available();
  return {
    canSave: ok,
    location: () => backend?.location() ?? '当前系统不支持加密保存',
    save(c: SavedCredentials) {
      if (!backend || !ok())
        throw new Error(
          process.platform === 'linux'
            ? '未找到 secret-tool：请安装 libsecret-tools（Debian / Ubuntu）或 libsecret（Fedora / Arch）'
            : '当前系统不支持加密保存凭证',
        );
      const base64 = Buffer.from(JSON.stringify(credentialSchema.parse(c))).toString('base64');
      backend.write(base64);
      // Read it back: some helpers report success without saving (e.g. a locked keyring).
      if (backend.read() !== base64) throw new Error('凭证未能写入系统密钥存储');
      return backend.location();
    },
    // null when nothing is saved; throws when something is saved but cannot be read
    // (another user or machine, a damaged entry, or access denied).
    load(): SavedCredentials | null {
      if (!backend || !ok()) return null;
      const base64 = backend.read();
      return base64 ? decode(base64) : null;
    },
    forget() {
      if (backend && ok()) backend.remove();
    },
  };
}

const store = createCredentialStore();
export const canSaveCredentials = store.canSave;
export const credentialLocation = store.location;
export const saveCredentials = store.save;
export const loadCredentials = store.load;
export const forgetCredentials = store.forget;
