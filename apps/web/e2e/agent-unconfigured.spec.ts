import { expect, test } from '@playwright/test';

test('an unconfigured provider disables the Agent composer and rejects a real message with 503', async ({ page }) => {
  const browserProblems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') {
      browserProblems.push(`[console:${message.type()}] ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => browserProblems.push(`[pageerror] ${error.message}`));

  const owner = {
    username: 'task16-e2e-owner',
    password: 'task16-e2e-password',
  };

  await page.goto('/');
  const setupHeading = page.getByRole('heading', { name: '建立本地身份' });
  const loginHeading = page.getByRole('heading', { name: '返回你的控制台' });
  await expect(setupHeading.or(loginHeading)).toBeVisible();
  await page.getByLabel('用户名').fill(owner.username);
  await page.getByLabel('密码').fill(owner.password);
  await page.getByRole('button', {
    name: (await setupHeading.isVisible()) ? '创建本地账号' : '登录',
  }).click();
  await expect(page).toHaveURL(/\/today$/);

  const createSession = await page.context().request.post('/api/core/agent/sessions', {
    data: {},
  });
  expect(createSession.status()).toBe(201);
  const { data: session } = await createSession.json() as { data: { id: string } };
  expect(session.id).toEqual(expect.any(String));

  await page.goto(`/agent?session=${session.id}`);
  await expect(page.getByText('需要连接 API', { exact: false })).toBeVisible();
  await expect(page.getByRole('textbox')).toBeDisabled();
  await expect(page.getByRole('button', { name: '发送' })).toBeDisabled();

  const sendMessage = await page.context().request.post(`/api/core/agent/sessions/${session.id}/messages`, {
    data: { content: 'Task16 must not synthesize a successful response.' },
  });
  expect(sendMessage.status()).toBe(503);
  expect(sendMessage.status()).not.toBe(201);
  expect(await sendMessage.json()).toMatchObject({
    error: { code: 'AGENT_PROVIDER_NOT_CONFIGURED' },
  });
  expect(browserProblems).toEqual([]);
});
