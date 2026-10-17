import { createHmac, timingSafeEqual } from 'node:crypto';

// Stateless website sessions: `<expiry>.<HMAC(access token, expiry)>`. They survive backend
// restarts (the access token is saved with the OKX credentials) and all become invalid at
// once when the access token changes. Single local user, so there is no server-side list.
export const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 86400000;
const sign = (secret: string, expiry: number) =>
  createHmac('sha256', secret)
    .update('shizhang-session:' + expiry)
    .digest('base64url');
export function issueSession(secret: string, now = Date.now()) {
  const expiry = now + SESSION_MS;
  return `${expiry}.${sign(secret, expiry)}`;
}
export function verifySession(token: string, secret: string | undefined, now = Date.now()) {
  const m = /^(\d{13})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m || !secret || secret.length < 32) return false;
  const expiry = Number(m[1]);
  if (expiry < now || expiry > now + SESSION_MS + 60000) return false;
  const given = Buffer.from(m[2]),
    expected = Buffer.from(sign(secret, expiry));
  return given.length === expected.length && timingSafeEqual(given, expected);
}
