import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: 'http://127.0.0.1:8788',
    headless: true,
    // The tests read the Chinese interface; the app picks English for other browser languages.
    locale: 'zh-CN',
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
        (process.platform === 'win32'
          ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
          : undefined),
    },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm start',
    url: 'http://127.0.0.1:8788',
    env: {
      PORT: '8788',
      HOST: '127.0.0.1',
      APP_ORIGIN: 'http://127.0.0.1:8788',
      // Never touch the real master ledger on D: during tests.
      GLEANBOOK_DATA_DIR: 'test-results/master-ledger',
    },
    reuseExistingServer: process.env.GLEANBOOK_E2E_REUSE_SERVER === '1',
    timeout: 30000,
  },
});
