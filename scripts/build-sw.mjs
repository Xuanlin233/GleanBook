import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const assets = await readdir(new URL('../dist/assets/', import.meta.url));
const shell = [
  '/index.html',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  ...assets.filter((s) => /\.(js|css)$/.test(s)).map((s) => '/assets/' + s),
];
const hash = createHash('sha256')
  .update(await readFile(new URL('../dist/index.html', import.meta.url)))
  .digest('hex')
  .slice(0, 12);
const source = `/* Only public application files. API responses and private data are never cached. */
const CACHE='shizhang-shell-${hash}';
const FILES=${JSON.stringify(shell)};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES))));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const key of await caches.keys())if(key.startsWith('shizhang-shell-')&&key!==CACHE)await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('fetch',event=>{
  const req=event.request,url=new URL(req.url);
  if(req.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;
  if(req.mode==='navigate'){
    event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match('/index.html'))||fetch(req)));
    return;
  }
  if(FILES.includes(url.pathname))event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match(url.pathname))||fetch(req)));
});
`;
await writeFile(new URL('../dist/sw.js', import.meta.url), source);
console.log(`Offline shell: ${shell.length} files, version ${hash}`);
