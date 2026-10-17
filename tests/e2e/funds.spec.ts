import { test, expect } from '@playwright/test';

test('基金正式净值按披露日显示，失败保留份额和已保存价格', async ({ page }) => {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const navDate = new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10);
  let fail = false;
  await page.route('**/api/funds/nav?code=000218', async (route) => {
    await route.fulfill({
      status: fail ? 502 : 200,
      contentType: 'application/json',
      body: JSON.stringify(
        fail
          ? { error: '模拟上游故障' }
          : {
              code: '000218',
              name: '国泰黄金 ETF 联接 A',
              value: '3.2186',
              currency: 'CNY',
              navDate,
              fetchedAt: new Date().toISOString(),
              source: '国泰基金官网正式净值（实验接入）',
              experimental: true,
            },
      ),
    });
  });
  await page.goto('/#assets');
  await page.getByRole('button', { name: '添加持仓', exact: true }).click();
  await page.getByRole('button', { name: '国泰黄金 A · 000218', exact: true }).click();
  await page.getByLabel('精确期初份额 / 数量').fill('100');
  await page.getByLabel('期初持仓总成本（选填）').fill('300');
  await page.getByRole('button', { name: '保存持仓', exact: true }).click();
  await page.locator('.holding-row').click();
  await page.getByRole('button', { name: '获取正式净值', exact: true }).click();
  await expect(page.locator('.source-box')).toContainText(`正式净值日 ${navDate}（上海日期）`);
  await expect(page.locator('.detail-hero strong')).toHaveText('¥ 321.86');
  await expect(page.locator('.detail-hero p')).toContainText('100 份');
  fail = true;
  await page.getByRole('button', { name: '获取正式净值', exact: true }).click();
  // The backend reason (which source failed and why) is shown instead of a generic message.
  await expect(page.getByText('模拟上游故障')).toBeVisible();
  await expect(page.locator('.detail-hero strong')).toHaveText('¥ 321.86');
  await expect(page.locator('.source-box')).toContainText(`正式净值日 ${navDate}`);
  await expect(page.getByText('尚无投资交易记录，期初持仓不会生成虚假交易。')).toBeVisible();
});
