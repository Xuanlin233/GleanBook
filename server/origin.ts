const loopbackHosts = ['localhost', '127.0.0.1', '[::1]'];
// APP_ORIGIN may list several origins separated by commas. A loopback origin also accepts
// its localhost / 127.0.0.1 / [::1] aliases on the same port: they are the same machine,
// and the startup log or a bookmark can easily use the other spelling.
export function allowedOrigins(configured = process.env.APP_ORIGIN) {
  const result = new Set<string>();
  for (const item of (configured ?? '').split(',')) {
    const text = item.trim();
    if (!text) continue;
    result.add(text);
    try {
      const url = new URL(text);
      if (url.protocol === 'http:' && loopbackHosts.includes(url.hostname))
        for (const alias of loopbackHosts)
          result.add(`http://${alias}${url.port ? ':' + url.port : ''}`);
    } catch {
      /* keep the exact string only */
    }
  }
  return result;
}
