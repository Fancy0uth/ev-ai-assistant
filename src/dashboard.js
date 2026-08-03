const initialTasks = [
  {
    id: 'release',
    title: '完成 Dashboard 数据层 PR',
    subtitle: 'ev-assistant · #482 · CI 已通过',
    type: '工作',
    time: '09:30',
    duration: '90 分钟',
    core: true,
    state: 'open',
    icon: '⌘',
    color: 'violet'
  },
  {
    id: 'review',
    title: 'Review 李明的鉴权改动',
    subtitle: 'api-gateway · PR #128 · 需要你的反馈',
    type: '协作',
    time: '14:00',
    duration: '35 分钟',
    core: true,
    state: 'open',
    icon: '↗',
    color: 'blue'
  },
  {
    id: 'study',
    title: '学习 React Server Components',
    subtitle: '本周学习目标 · 第 3 / 5 节',
    type: '学习',
    time: '20:00',
    duration: '45 分钟',
    core: true,
    state: 'open',
    icon: '◒',
    color: 'mint'
  },
  {
    id: 'workout',
    title: '下班后力量训练',
    subtitle: '今日习惯 · 预计 30 分钟',
    type: '生活',
    time: '18:30',
    duration: '30 分钟',
    core: false,
    state: 'open',
    icon: '✦',
    color: 'amber'
  }
];

export function calculateStatus(tasks) {
  const coreTasks = tasks.filter((task) => task.core);
  const completedCore = coreTasks.filter((task) => task.state === 'done').length;
  const completedAll = tasks.filter((task) => task.state === 'done').length;
  const deferred = tasks.filter((task) => task.state === 'deferred').length;
  const score = Math.max(42, Math.min(96, 68 + completedCore * 9 + completedAll * 2 - deferred * 7));

  let level = '节奏良好';
  let detail = '今天的安排可控，适合先完成一段深度工作。';
  if (deferred > 0) {
    level = '建议收缩';
    detail = '有事项被推迟，先守住核心任务，不再塞入新的承诺。';
  }
  if (completedCore === coreTasks.length && coreTasks.length > 0) {
    level = '推进顺畅';
    detail = '核心任务已收束，可以安心处理协作和生活安排。';
  }

  return { score, level, detail, completedCore, totalCore: coreTasks.length, deferred };
}

export function getAdvice(tasks) {
  const status = calculateStatus(tasks);
  if (status.deferred > 0) {
    return {
      eyebrow: 'AI 节奏建议',
      title: '先恢复节奏，再扩张计划',
      text: '你已经推迟了一个事项。今天只保留最重要的三件事，把其余任务留给明天更合适的空档。',
      action: 'compact'
    };
  }
  if (status.completedCore === status.totalCore) {
    return {
      eyebrow: 'AI 节奏建议',
      title: '核心已完成，给生活留出空间',
      text: '今天的关键推进已经完成。现在适合回复协作消息，或准时开始训练。',
      action: 'focus-life'
    };
  }
  return {
    eyebrow: 'AI 节奏建议',
    title: '上午只做一件高认知任务',
    text: '你的日历在 11:00 后开始变碎。建议 09:30–11:00 完成数据层 PR，午后再处理 Review。',
    action: 'focus'
  };
}

export function applyAction(tasks, action, id) {
  return tasks.map((task) => {
    if (task.id !== id) return task;
    if (action === 'complete') return { ...task, state: 'done', focus: false };
    if (action === 'defer') return { ...task, state: 'deferred', focus: false };
    if (action === 'prioritize') return { ...task, core: true };
    if (action === 'focus') return { ...task, focus: true };
    return task;
  });
}

function compactPlan(tasks) {
  const candidate = tasks.find((task) => !task.core && task.state === 'open');
  return candidate ? applyAction(tasks, 'defer', candidate.id) : tasks;
}

function stateLabel(task) {
  if (task.state === 'done') return '已完成';
  if (task.state === 'deferred') return '稍后完成';
  if (task.focus) return '专注中';
  return task.type;
}

function taskMarkup(task) {
  const isDone = task.state === 'done';
  const isDeferred = task.state === 'deferred';
  return `
    <article class="task ${isDone ? 'is-done' : ''} ${isDeferred ? 'is-deferred' : ''}" data-task-id="${task.id}">
      <button class="task-check" data-action="complete" data-id="${task.id}" aria-label="完成 ${task.title}">${isDone ? '✓' : ''}</button>
      <div class="task-icon ${task.color}">${task.icon}</div>
      <div class="task-copy">
        <div class="task-meta"><span>${stateLabel(task)}</span><span>·</span><span>${task.time}</span><span>·</span><span>${task.duration}</span></div>
        <h3>${task.title}</h3>
        <p>${task.subtitle}</p>
      </div>
      <div class="task-actions">
        ${!isDone && !isDeferred ? `<button class="icon-button" data-action="focus" data-id="${task.id}" title="开始专注">⌁</button><button class="icon-button" data-action="defer" data-id="${task.id}" title="稍后完成">↝</button>` : ''}
        ${task.core ? '<span class="core-badge">核心</span>' : `<button class="soft-button" data-action="prioritize" data-id="${task.id}">设为核心</button>`}
      </div>
    </article>`;
}

function renderTasks(tasks) {
  const primary = tasks.filter((task) => task.core);
  const extra = tasks.filter((task) => !task.core);
  return `${primary.map(taskMarkup).join('')}
    <div class="task-separator"><span>生活与弹性事项</span></div>
    ${extra.map(taskMarkup).join('')}`;
}

function renderStatus(status) {
  const arc = status.score * 2.51;
  return `
    <div class="status-overline"><span class="pulse"></span> 今日执行状态</div>
    <div class="status-main">
      <div class="score-ring" style="--score:${arc}px"><div><strong>${status.score}</strong><span>/ 100</span></div></div>
      <div class="status-copy">
        <div class="level-row"><h1>${status.level}</h1><span class="up-pill">↗ 6</span></div>
        <p>${status.detail}</p>
        <div class="status-tags"><span>核心任务 ${status.completedCore}/${status.totalCore}</span><span>日历占用 4h 15m</span></div>
      </div>
    </div>`;
}

function renderAdvice(advice) {
  const actionText = advice.action === 'compact' ? '收缩今天计划' : advice.action === 'focus-life' ? '查看生活安排' : '开始 90 分钟专注';
  return `<div class="ai-orb">✦</div><div class="advice-copy"><span>${advice.eyebrow}</span><h2>${advice.title}</h2><p>${advice.text}</p><button class="advice-action" data-action="${advice.action}">${actionText} <b>→</b></button></div>`;
}

function showToast(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 2600);
}

function updateDashboard(tasks) {
  const status = calculateStatus(tasks);
  const advice = getAdvice(tasks);
  document.querySelector('#status-card').innerHTML = renderStatus(status);
  document.querySelector('#task-list').innerHTML = renderTasks(tasks);
  document.querySelector('#ai-advice').innerHTML = renderAdvice(advice);
  document.querySelector('#today-progress').textContent = `${tasks.filter((task) => task.state === 'done').length} / ${tasks.length}`;
  document.querySelector('#score-mini').textContent = `${status.score}`;
}

function boot() {
  let tasks = initialTasks.map((task) => ({ ...task }));
  updateDashboard(tasks);

  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const { action, id } = target.dataset;

    if (action === 'compact') {
      tasks = compactPlan(tasks);
      updateDashboard(tasks);
      showToast('已把训练移到明天，今天只保留核心事项。');
      return;
    }
    if (action === 'focus-life') {
      showToast('18:30 的力量训练已为你保留。');
      return;
    }
    if (action === 'focus') {
      const firstOpenCore = tasks.find((task) => task.core && task.state === 'open');
      if (firstOpenCore) {
        tasks = applyAction(tasks, 'focus', firstOpenCore.id);
        updateDashboard(tasks);
        showToast(`已开始专注：${firstOpenCore.title}`);
      }
      return;
    }
    if (id) {
      tasks = applyAction(tasks, action, id);
      updateDashboard(tasks);
      const messages = { complete: '任务已完成，今天的状态已更新。', defer: '已移至稍后完成，AI 会调整今天的建议。', prioritize: '已设为核心任务。' };
      showToast(messages[action] || '已更新。');
    }
  });
}

if (typeof document !== 'undefined') boot();
