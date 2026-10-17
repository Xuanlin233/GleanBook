import { expect, test } from '@playwright/test';

// A browser in another language gets the English interface; ?demo opens the demo ledger.
test.use({ locale: 'en-US' });
const CJK = /[　-〿一-鿿＀-￯]/;

test('英文浏览器显示英文界面，各页面没有残留中文，可切回中文', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?demo');
  await expect(page).toHaveURL(/\/$|\/#/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
  await expect(page.locator('.demo-banner')).toBeVisible();
  const leftovers: Record<string, string[]> = {};
  for (const tab of ['Overview', 'Bills', 'Assets', 'Settings']) {
    await page.locator('.sidebar').getByRole('button', { name: tab, exact: true }).click();
    const text = await page.locator('body').innerText();
    // The language picker shows its own name, 简体中文, on purpose.
    const lines = text.split('\n').filter((l) => CJK.test(l) && l.trim() !== '简体中文');
    if (lines.length) leftovers[tab] = lines;
    await page.screenshot({
      path: `test-results/english-${tab.toLowerCase()}.png`,
      fullPage: true,
    });
  }
  expect(leftovers).toEqual({});

  await page.getByLabel('Interface language').selectOption('zh-CN');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(
    page.locator('.sidebar').getByRole('button', { name: '设置', exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
