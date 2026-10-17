import { test, expect } from '@playwright/test';
import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
test('更新等待用户操作；未提交表单不刷新，更新后草稿完整', async ({ page }) => {
  let version = 1;
  const server = http.createServer(async (req, res) => {
    try {
      const p = new URL(req.url ?? '/', 'http://localhost').pathname,
        file = path.resolve('dist', p === '/' ? 'index.html' : '.' + p);
      let content = await readFile(file);
      if (p === '/sw.js')
        content = Buffer.from(
          content
            .toString()
            .replace("const CACHE='shizhang-shell-", `const CACHE='shizhang-shell-v${version}-`),
        );
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader(
        'Content-Type',
        p.endsWith('.js')
          ? 'text/javascript'
          : p.endsWith('.css')
            ? 'text/css'
            : p.endsWith('.svg')
              ? 'image/svg+xml'
              : p.endsWith('.png')
                ? 'image/png'
                : p.endsWith('.webmanifest')
                  ? 'application/manifest+json'
                  : 'text/html',
      );
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(8799, '127.0.0.1', resolve));
  try {
    await page.goto('http://127.0.0.1:8799');
    await page.getByRole('button', { name: '添加账户', exact: true }).click();
    await page.getByLabel('账户名称').fill('更新测试账户');
    await page.getByRole('button', { name: '保存账户' }).click();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await page.getByRole('button', { name: '记一笔', exact: true }).last().click();
    await page.getByLabel('金额', { exact: true }).fill('123.45');
    await page.getByLabel('备注（选填）').fill('升级保留的草稿');
    await page.waitForTimeout(300);
    version = 2;
    await page.evaluate(async () => {
      const r = await navigator.serviceWorker.getRegistration();
      await r!.update();
    });
    await expect(page.getByRole('button', { name: '更新应用', exact: true })).toBeDisabled();
    await expect(page.getByLabel('金额', { exact: true })).toHaveValue('123.45');
    await page.getByRole('button', { name: '稍后继续' }).click();
    await expect(page.getByRole('button', { name: '更新应用', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '更新应用', exact: true }).click();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('button', { name: '更新应用', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '记一笔', exact: true }).last().click();
    await expect(page.getByLabel('金额', { exact: true })).toHaveValue('123.45');
    await expect(page.getByLabel('备注（选填）')).toHaveValue('升级保留的草稿');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
