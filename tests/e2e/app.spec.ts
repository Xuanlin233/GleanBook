import { test, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import type { Page } from '@playwright/test';
async function account(page: Page, name = '招商银行', opening = '1000') {
  await page.getByRole('button', { name: '添加账户', exact: true }).first().click();
  await page.getByLabel('账户名称').fill(name);
  await page.getByLabel('期初余额').fill(opening);
  await page.getByRole('button', { name: '保存账户', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function entry(page: Page, note: string, amount: string, kind = '支出') {
  await page.getByRole('button', { name: '记一笔', exact: true }).last().click();
  await page.getByRole('dialog').getByRole('button', { name: kind, exact: true }).click();
  await page.getByLabel('金额', { exact: true }).fill(amount);
  await page.getByLabel('备注（选填）').fill(note);
  await page.getByRole('button', { name: '保存这笔记录' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
test('真实账本初始为空，创建账户、记账、编辑删除均重算', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.net-amount')).toHaveText('¥ 0.00');
  await expect(page.getByText('还没有账单')).toBeVisible();
  await expect(page.locator('.demo-banner')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/real-empty-overview.png', fullPage: true });
  await account(page);
  await expect(page.locator('.net-amount')).toHaveText('¥ 1,000.00');
  await entry(page, '测试午餐', '28.80');
  await expect(page.locator('.net-amount')).toHaveText('¥ 971.20');
  await entry(page, '测试收入', '100', '收入');
  await expect(page.locator('.net-amount')).toHaveText('¥ 1,071.20');
  await page.getByRole('button', { name: /测试午餐/ }).click();
  await page.getByLabel('金额', { exact: true }).fill('30.10');
  await page.getByRole('button', { name: '保存修改' }).click();
  await expect(page.locator('.net-amount')).toHaveText('¥ 1,069.90');
  await page.getByRole('button', { name: /测试午餐/ }).click();
  await page.getByRole('button', { name: '删除这笔记录' }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.locator('.net-amount')).toHaveText('¥ 1,100.00');
});
test('转账 UI 不增加消费', async ({ page }) => {
  await page.goto('/');
  await account(page, '银行卡', '1000');
  await page.locator('.sidebar').getByRole('button', { name: '资产', exact: true }).click();
  await account(page, '微信', '0');
  await page.locator('.sidebar').getByRole('button', { name: '总览', exact: true }).click();
  await page.getByRole('button', { name: '记一笔', exact: true }).last().click();
  await page.getByRole('dialog').getByRole('button', { name: '转账', exact: true }).click();
  await page.getByLabel('转出金额', { exact: true }).fill('200');
  await page.getByLabel('转入账户').selectOption({ label: '微信 · CNY' });
  // Same currency: no second amount box.
  await expect(page.getByLabel('转入金额（CNY）')).toHaveCount(0);
  await page.getByRole('button', { name: '保存这笔记录' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.net-amount')).toHaveText('¥ 1,000.00');
  await expect(page.locator('.stat-card').nth(1).locator(':scope > strong')).toHaveText('¥ 0.00');
});
test('完整备份预览、重复合并和非法导入保护', async ({ page }) => {
  await page.goto('/');
  await account(page);
  await entry(page, '备份验证', '12.34');
  await page.goto('/#settings');
  await page.getByRole('button', { name: '备份与恢复', exact: true }).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '完整 JSON 备份' }).click();
  const download = await downloadEvent;
  const filename = await download.path();
  const data = JSON.parse(await readFile(filename!, 'utf-8'));
  expect(data.ledger.transactions).toHaveLength(1);
  expect(data.ledger.accounts[0].opening).toBe('1000');
  await page.getByLabel('选择 JSON 备份').setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(data)),
  });
  await expect(page.getByRole('dialog')).toContainText('新增 0 项');
  await expect(page.getByRole('dialog')).toContainText('跳过');
  await page.getByRole('button', { name: '确认恢复', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '清空当前真实账本' }).click();
  await page.getByLabel('输入“清空”确认').fill('清空');
  await page.getByRole('button', { name: '确认清空账本' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('选择 JSON 备份').setInputFiles({
    name: 'restore.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(data)),
  });
  await page.getByLabel('恢复方式').selectOption('replace');
  await page.getByLabel('输入“恢复”以确认覆盖当前账本').fill('恢复');
  await page.getByRole('button', { name: '确认恢复', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('选择 JSON 备份').setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"format":"invalid"}'),
  });
  await expect(page.getByRole('alert')).toBeVisible();
  await page.goto('/#overview');
  await expect(page.locator('.net-amount')).toHaveText('¥ 987.66');
});
test('投资申购联动现金与持仓，不重复增加净资产，预算超支可见', async ({ page }) => {
  await page.goto('/');
  await account(page, '投资结算卡', '1000');
  await page.goto('/#assets');
  await page.getByRole('button', { name: '添加持仓', exact: true }).click();
  await page.getByRole('button', { name: '国泰黄金 A · 000218' }).click();
  await page.getByLabel('精确期初份额 / 数量').fill('0');
  await page.getByLabel('期初持仓总成本').fill('0');
  await page.getByRole('button', { name: '保存持仓', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: /国泰黄金 ETF 联接 A.*000218/ }).click();
  await page.getByRole('button', { name: '更新价格', exact: true }).click();
  await page.getByLabel('单位价格').fill('1');
  await page.getByLabel('来源（名称或链接）').fill('测试确认净值');
  await page.getByRole('button', { name: '保存价格' }).click();
  await page.getByRole('button', { name: '投资操作', exact: true }).click();
  await page.getByLabel('精确份额 / 数量').fill('100');
  await page.getByLabel('成交总金额').fill('100');
  await page.getByRole('button', { name: '记录投资操作', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('¥ 100.00');
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  await page.goto('/#overview');
  await expect(page.locator('.net-amount')).toHaveText('¥ 1,000.00');
  await entry(page, '预算验证消费', '30');
  await page.goto('/#settings');
  await page.getByRole('button', { name: '月度预算', exact: true }).click();
  await page.getByLabel('月度总预算（人民币）').fill('20');
  await page.getByRole('button', { name: '保存预算' }).click();
  await expect(page.getByText('本月预算已保存。')).toBeVisible();
  await page.goto('/#overview');
  await expect(page.getByText('已超预算 ¥ 10.00')).toBeVisible();
});
test('生产 PWA 首次缓存后可离线打开和记账，草稿跨刷新保留', async ({ page, context }) => {
  await page.goto('/');
  await account(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(page.locator('.net-amount')).toHaveText('¥ 1,000.00');
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.net-amount')).toHaveText('¥ 1,000.00');
  await entry(page, '离线午餐', '18.70');
  await expect(page.locator('.net-amount')).toHaveText('¥ 981.30');
  await page.getByRole('button', { name: '记一笔', exact: true }).last().click();
  await page.getByLabel('金额', { exact: true }).fill('35.60');
  await page.getByLabel('备注（选填）').fill('未提交草稿');
  await page.waitForTimeout(300);
  await page.reload();
  await page.getByRole('button', { name: '记一笔', exact: true }).last().click();
  await expect(page.getByLabel('金额', { exact: true })).toHaveValue('35.60');
  await expect(page.getByLabel('备注（选填）')).toHaveValue('未提交草稿');
  await context.setOffline(false);
});
test('演示隔离、手机适配、金额隐藏和深色模式', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.bottom-nav')).toBeVisible();
  await expect(page.locator('.net-amount')).toHaveText('¥ 0.00');
  await page.locator('.bottom-nav').getByRole('button', { name: '设置' }).click();
  await page.getByRole('button', { name: '打开独立演示账本' }).click();
  await page.locator('.bottom-nav').getByRole('button', { name: '总览' }).click();
  await expect(page.locator('.demo-banner')).toBeVisible();
  await expect(page.locator('.net-amount')).not.toHaveText('¥ 0.00');
  await page.getByRole('button', { name: '隐藏金额', exact: true }).click();
  await expect(page.locator('.net-amount')).toHaveText('••••••');
  await page.getByRole('button', { name: '显示金额', exact: true }).click();
  await page.locator('.bottom-nav').getByRole('button', { name: '设置' }).click();
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('.bottom-nav').getByRole('button', { name: '总览' }).click();
  await page.screenshot({ path: 'test-results/mobile-dark.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '返回真实账本', exact: true }).click();
  await expect(page.locator('.net-amount')).toHaveText('¥ 0.00');
  await expect(page.getByText('还没有账单')).toBeVisible();
});
test('无凭证不显示假连接，未鉴权私人接口不可访问', async ({ page, request }) => {
  const privateRes = await request.get('/api/okx/status');
  expect(privateRes.status()).toBe(401);
  expect(privateRes.headers()['cache-control']).toBe('no-store');
  const forbidden = await request.post('/api/okx/sync', {
    headers: { Origin: 'https://untrusted.example' },
  });
  expect(forbidden.status()).toBe(403);
  expect((await request.get('/.env')).status()).toBe(404);
  await page.goto('/#settings');
  await page.getByRole('button', { name: '数据连接', exact: true }).click();
  await expect(page.getByText('未连接', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '读取持仓并预览' })).toHaveCount(0);
  const caches = await page.evaluate(async () => {
    const urls = [];
    for (const key of await window.caches.keys()) {
      const c = await window.caches.open(key);
      urls.push(...(await c.keys()).map((r) => r.url));
    }
    return urls;
  });
  expect(caches.some((u) => u.includes('/api/'))).toBe(false);
});
test('桌面与平板布局没有溢出或控制台异常', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: '体验演示账本' }).click();
  await expect(page.locator('.demo-banner')).toBeVisible();
  await page.screenshot({ path: 'test-results/desktop-overview.png', fullPage: true });
  for (const size of [
    { width: 1440, height: 1000 },
    { width: 820, height: 1180 },
    { width: 375, height: 812 },
    { width: 812, height: 375 },
  ]) {
    await page.setViewportSize(size);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  expect(errors).toEqual([]);
});
test('未知价格不会显示完整零值，行情失败保留原价格', async ({ page }) => {
  await page.goto('/#assets');
  await page.getByRole('button', { name: '添加持仓', exact: true }).click();
  await page.getByLabel('持仓名称').fill('测试 Bitcoin');
  await page.getByLabel('资产类型').selectOption('crypto');
  await page.getByLabel('准确产品标识 / 币种').fill('BTC');
  await page.getByLabel('精确期初份额 / 数量').fill('0.01');
  await page.getByLabel('期初持仓总成本').fill('500');
  await page.getByLabel('价格及成本计价币种').selectOption('USDT');
  await page.getByRole('button', { name: '保存持仓', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('以上是已知部分', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: /测试 Bitcoin.*估值待补充/ }).click();
  await page.getByRole('button', { name: '更新价格', exact: true }).click();
  await page.getByLabel('单位价格').fill('80000');
  await page.getByLabel('来源（名称或链接）').fill('测试手动行情');
  await page.getByRole('button', { name: '保存价格' }).click();
  await expect(page.getByRole('dialog')).toContainText('80000 USDT');
  await page.route('**/api/market?**', (route) =>
    route.fulfill({ status: 503, json: { error: 'test unavailable' } }),
  );
  await page.getByRole('button', { name: '获取行情', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('失败');
  await expect(page.getByRole('dialog')).toContainText('80000 USDT');
});
