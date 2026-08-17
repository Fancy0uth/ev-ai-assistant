import { expect, test, type Page, type TestInfo } from '@playwright/test';

const viewports = [
  { name: 'desktop', width: 1440, height: 900, hasTouch: false },
  { name: 'touch-large', width: 390, height: 844, hasTouch: true },
  { name: 'touch-small', width: 320, height: 800, hasTouch: true },
] as const;

const owner = {
  username: 'task16-e2e-owner',
  password: 'task16-e2e-password',
};

function collectBrowserProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') {
      problems.push(`[console:${message.type()}] ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => problems.push(`[pageerror] ${error.message}`));
  return problems;
}

async function attachBrowserProblems(testInfo: TestInfo, viewportName: string, problems: string[]): Promise<void> {
  await testInfo.attach(`browser-${viewportName}`, {
    body: Buffer.from(problems.join('\n') || 'No browser warnings or errors captured.'),
    contentType: 'text/plain',
  });
}

async function authenticate(page: Page): Promise<void> {
  await page.goto('/');
  const setup = page.getByRole('heading', { name: '建立本地身份' });
  const login = page.getByRole('heading', { name: '返回你的控制台' });
  await expect(setup.or(login)).toBeVisible();

  await page.getByLabel('用户名').fill(owner.username);
  await page.getByLabel('密码').fill(owner.password);
  await page.getByRole('button', { name: (await setup.isVisible()) ? '创建本地账号' : '登录' }).click();
  await expect(page).toHaveURL(/\/today$/);
}

test('provider settings keep an unconfigured DeepSeek credential local in isolated desktop and touch contexts', async ({ browser }, testInfo) => {
  const contextIds = new Set<object>();
  let storageState: Awaited<ReturnType<import('@playwright/test').BrowserContext['storageState']>> | undefined;

  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: viewport.hasTouch,
      ...(storageState ? { storageState } : {}),
    });
    contextIds.add(context);
    const page = await context.newPage();
    const browserProblems = collectBrowserProblems(page);

    try {
      if (storageState) {
        await page.goto('/today');
        await expect(page.getByRole('heading', { name: '今天，从最重要的事开始。' })).toBeVisible();
      } else {
        await authenticate(page);
        storageState = await context.storageState();
      }
      await page.goto('/settings/providers');
      await expect(page).toHaveURL(/\/settings\/providers$/);
      await expect(page.getByText('密钥只保留在这台设备上。保存后浏览器不会显示或保留该密钥。', { exact: true })).toBeVisible();

      const keyInput = page.getByLabel('DeepSeek API Key');
      const saveButton = page.getByRole('button', { name: '保存密钥' });
      const testConnectionButton = page.getByRole('button', { name: '测试连接' });
      await expect(keyInput).toBeVisible();
      await expect(keyInput).toHaveAttribute('type', 'password');
      await expect(page.locator('.provider-status')).toHaveText('未配置');
      await expect(testConnectionButton).toBeDisabled();

      await keyInput.focus();
      await expect(keyInput).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(saveButton).not.toBeFocused();
      await expect(testConnectionButton).not.toBeFocused();

      if (viewport.hasTouch) {
        const metrics = await page.evaluate(() => {
          const height = (element: Element | null) => element?.getBoundingClientRect().height ?? 0;
          const root = document.documentElement;
          return {
            hasHorizontalOverflow: root.scrollWidth > root.clientWidth,
            keyInputHeight: height(document.querySelector('#deepseek-api-key')),
            testConnectionButtonHeight: height(document.querySelector('.provider-credential-actions button:nth-child(2)')),
          };
        });

        expect(metrics.hasHorizontalOverflow).toBe(false);
        expect(metrics.keyInputHeight).toBeGreaterThanOrEqual(44);
        expect(metrics.testConnectionButtonHeight).toBeGreaterThanOrEqual(44);
      }
    } finally {
      await attachBrowserProblems(testInfo, viewport.name, browserProblems);
      await context.close();
      expect(browserProblems).toEqual([]);
    }
  }

  expect(contextIds.size).toBe(3);
});
