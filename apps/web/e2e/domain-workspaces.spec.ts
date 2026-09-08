import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const owner = {
  username: 'task16-e2e-owner',
  password: 'task16-e2e-password',
};

async function authenticate(page: Page): Promise<void> {
  await page.goto('/');
  const setup = page.getByRole('heading', { name: '建立本地身份' });
  await expect(setup.or(page.getByRole('heading', { name: '返回你的控制台' }))).toBeVisible();
  await page.getByLabel('用户名').fill(owner.username);
  await page.getByLabel('密码').fill(owner.password);
  await page.getByRole('button', { name: (await setup.isVisible()) ? '创建本地账号' : '登录' }).click();
  await expect(page).toHaveURL(/\/today$/);
}

function collectBrowserProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') problems.push(`[console:${message.type()}] ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`[pageerror] ${error.message}`));
  return problems;
}

test('local domain workspaces keep day actions concrete and persist only reviewed records', async ({ page }) => {
  const problems = collectBrowserProblems(page);
  const suffix = randomUUID().slice(0, 8);
  await authenticate(page);

  await expect(page.getByRole('region', { name: '按领域处理今天' })).toBeVisible();
  await page.getByRole('link', { name: '打开日程与课表模块' }).click();
  await expect(page).toHaveURL(/\/schedule$/);
  await page.getByLabel('学期名称').fill(`秋季学期-${suffix}`);
  await page.getByLabel('第一教学周的周一').fill('2026-08-17');
  await page.getByRole('button', { name: '建立本地学期' }).click();
  await expect(page.locator('.term-list strong', { hasText: `秋季学期-${suffix}` })).toBeVisible();

  await page.goto('/learning');
  await expect(page.getByRole('heading', { name: '学习与课程' })).toBeVisible();
  await page.getByLabel('课程名称').fill(`深度学习-${suffix}`);
  await page.getByLabel('课程官网或课程平台链接').fill('https://example.test/course');
  await page.getByRole('button', { name: '建立课程档案' }).click();
  await expect(page.getByRole('button', { name: `选择课程：深度学习-${suffix}` })).toBeVisible();
  await page.getByLabel('课程资料标题').fill('第一周讲义');
  await page.getByLabel('课程资料链接').fill('https://example.test/week-1');
  await page.getByRole('button', { name: '添加到本课程' }).click();
  await expect(page.getByRole('link', { name: '第一周讲义' })).toBeVisible();

  await page.goto('/fitness');
  await expect(page.getByRole('heading', { name: '训练与恢复' })).toBeVisible();
  await page.getByLabel('睡眠时长（小时）').fill('8');
  await page.getByLabel('主观精力（1–5）').selectOption('4');
  await page.getByLabel('不适程度（0–5）').selectOption('0');
  await page.getByRole('button', { name: '保存本地打卡' }).click();
  await expect(page.getByText('恢复良好', { exact: true })).toBeVisible();

  await page.goto('/nutrition');
  await expect(page.getByRole('heading', { name: '饮食记录' })).toBeVisible();
  await page.getByLabel('食物名称').fill('燕麦');
  await page.getByLabel('重量（克）').fill('80');
  await page.getByLabel('热量（千卡）').fill('300');
  await page.getByLabel('蛋白质（克）').fill('10');
  await page.getByLabel('碳水（克）').fill('50');
  await page.getByLabel('脂肪（克）').fill('5');
  await page.getByRole('button', { name: '确认并保存这餐' }).click();
  await expect(page.getByText('本餐已确认', { exact: true })).toBeVisible();

  await page.goto('/memory');
  await expect(page.getByRole('heading', { name: 'Agent 本地记忆' })).toBeVisible();
  const memoryContent = page.getByLabel('GENERAL 记忆内容');
  const saveMemory = page.getByRole('button', { name: '保存新版本' });
  await expect(memoryContent).toBeEditable();
  await memoryContent.fill('# 稳定偏好\n\n晚间安排优先复盘。');
  await expect(saveMemory).toBeEnabled();
  await saveMemory.click();
  await expect(page.getByRole('heading', { name: 'GENERAL · v1' })).toBeVisible();
  await page.getByRole('button', { name: '查看历史版本' }).click();
  await expect(page.getByRole('heading', { name: '历史版本' })).toBeVisible();

  await page.goto('/projects');
  await expect(page.getByRole('heading', { name: '项目与工作流' })).toBeVisible();
  await page.getByLabel('项目名称').fill(`受限项目-${suffix}`);
  await page.getByLabel('本机项目目录').fill(process.cwd());
  await page.getByRole('button', { name: '登记只读项目范围' }).click();
  await expect(page.getByRole('button', { name: `选择项目：受限项目-${suffix}` })).toBeVisible();
  await page.getByRole('button', { name: '读取只读规划快照' }).click();
  await expect(page.getByText('本页不会执行命令、修改文件、提交 Git 或读取 .env。')).toBeVisible();

  await page.goto('/today');
  await expect(page.getByText('恢复状态', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [path, heading] of [
    ['/schedule', '日程与课表'], ['/learning', '学习与课程'], ['/fitness', '训练与恢复'],
    ['/nutrition', '饮食记录'], ['/memory', 'Agent 本地记忆'], ['/projects', '项目与工作流'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  }
  expect(problems).toEqual([]);
});
