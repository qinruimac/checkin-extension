/**
 * Copyright (c) 2026 qin_rui (https://github.com/qinruimac)
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 签到助手 - 弹窗脚本
 * 责责任务列表的加载/渲染/删除、选取签到按钮、手工添加、执行所有签到及倒计时逻辑
 *
 * v1.1.0 变更：
 *  - 存储层切换到 TaskStorage（chrome.storage.sync，跟随浏览器账号）
 *  - 新增同步状态角落图标（三态中性色）+ 可展开面板
 *  - 新增导出/导入功能（用户侧手动跨设备搬运 / 备份）
 */

// ===== i18n 系统（共享模块 CheckinI18n，见 i18n.js）=====
async function loadCustomLanguage(lang) {
  await CheckinI18n.init(lang);
}

const i18n = (key, substitutions) => CheckinI18n.getMsg(key, substitutions);

// ===== i18n HTML 占位符替换 =====
const _i18nTextNodes = [];
const _i18nAttrs = [];

function applyI18nToHTML() {
  if (_i18nTextNodes.length === 0) {
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
    let node;
    while (node = walker.nextNode()) {
      if (node.textContent.includes('__MSG_')) {
        _i18nTextNodes.push({ node, original: node.textContent });
      }
    }
    document.querySelectorAll('*').forEach(el => {
      for (const attr of [...el.attributes]) {
        if (attr.value.includes('__MSG_')) {
          _i18nAttrs.push({ el, name: attr.name, original: attr.value });
        }
      }
    });
  }
  _i18nTextNodes.forEach(({ node, original }) => {
    node.textContent = original.replace(/__MSG_(\w+)__/g, (_, key) => i18n(key) || _);
  });
  _i18nAttrs.forEach(({ el, name, original }) => {
    el.setAttribute(name, original.replace(/__MSG_(\w+)__/g, (_, key) => i18n(key) || _));
  });
}

// ===== 常量定义 =====
const PAGE_SIZE = 10;
let currentPage = 1;

// ===== DOM 元素引用 =====
const btnPick = document.getElementById('btn-pick');
const langSelect = document.getElementById('lang-select');
const btnToggleForm = document.getElementById('btn-toggle-form');
const btnExecute = document.getElementById('btn-execute');
const manualForm = document.getElementById('manual-form');
const taskNameInput = document.getElementById('task-name');
const taskUrlInput = document.getElementById('task-url');
const taskTypeSelect = document.getElementById('task-type');
const taskSelectorInput = document.getElementById('task-selector');
const selectorGroup = document.getElementById('selector-group');
const btnSaveTask = document.getElementById('btn-save-task');
const btnCancelForm = document.getElementById('btn-cancel-form');
const taskList = document.getElementById('task-list');
const taskCount = document.getElementById('task-count');
const emptyState = document.getElementById('empty-state');
const executePanel = document.getElementById('execute-panel');
const countdownPanel = document.getElementById('countdown-panel');
const countdownNumber = document.getElementById('countdown-number');
const btnCancelexecute = document.getElementById('btn-cancel-execute');
const executingPanel = document.getElementById('executing-panel');
const executingText = document.getElementById('executing-text');
const executingProgress = document.getElementById('executing-progress');
const resultPanel = document.getElementById('result-panel');
const resultSuccess = document.getElementById('result-success');
const resultFail = document.getElementById('result-fail');
const resultDetails = document.getElementById('result-details');
const btnCloseResult = document.getElementById('btn-close-result');
const footerStats = document.getElementById('footer-stats');
const pagination = document.getElementById('pagination');
const pageInfo = document.getElementById('page-info');
const btnPrevPage = document.getElementById('btn-prev-page');
const btnNextPage = document.getElementById('btn-next-page');
const toast = document.getElementById('toast');
const syncCorner = document.getElementById('sync-corner');
const syncPanel = document.getElementById('sync-panel');
const syncPanelClose = document.getElementById('sync-panel-close');
const btnExport = document.getElementById('btn-export');
const btnImport = document.getElementById('btn-import');
const importFile = document.getElementById('import-file');
const btnSchedule = document.getElementById('btn-schedule');
const schedulePanel = document.getElementById('schedule-panel');
const scheduleEnabled = document.getElementById('schedule-enabled');
const scheduleTime = document.getElementById('schedule-time');
const scheduleNext = document.getElementById('schedule-next');
const scheduleLast = document.getElementById('schedule-last');

// ===== 倒计时状态 =====
let countdownTimer = null;
let countdownCancelled = false;
let isExecuting = false;  // 执行中标志：防止倒计时期间重复点击导致并发执行

// ===== 工具函数 =====
function showToast(message, duration = 2000) {
  toast.textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => { toast.classList.add('hidden'); }, duration);
}
function generateTaskId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}
function truncateUrl(url, maxLength = 40) {
  if (url.length <= maxLength) return url;
  return url.substr(0, maxLength) + '...';
}
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ===== 存储层（v1.1.0 统一走 TaskStorage / chrome.storage.sync）=====
async function loadTasks() {
  return TaskStorage.getTasks();
}

// ===== 任务列表渲染 =====
async function renderTaskList() {
  const tasks = await loadTasks();
  taskCount.textContent = i18n('taskCount', [String(tasks.length)]);
  const clickCount = tasks.filter(t => t.type === 'click').length;
  const openCount = tasks.filter(t => t.type === 'open').length;
  footerStats.textContent = i18n('footerStats', [String(tasks.length), String(clickCount), String(openCount)]);

  if (tasks.length === 0) {
    taskList.innerHTML = '';
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');

  const totalPages = Math.ceil(tasks.length / PAGE_SIZE);
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageTasks = tasks.slice(start, start + PAGE_SIZE);

  if (totalPages > 1) {
    pagination.classList.remove('hidden');
    pageInfo.textContent = `${currentPage} / ${totalPages}`;
    btnPrevPage.disabled = currentPage <= 1;
    btnNextPage.disabled = currentPage >= totalPages;
  } else { pagination.classList.add('hidden'); }

  const deleteTitle = i18n('btnDeleteTask');
  taskList.innerHTML = pageTasks.map(task => {
    const fallbackIcon = task.type === 'click' ? '🎯' : '🔗';
    let domain = '';
    try { domain = new URL(task.url).hostname; } catch (e) { domain = ''; }
    const iconHtml = domain
      ? `<img src="https://${domain}/favicon.ico" class="task-favicon" alt="${escapeHtml(task.name)}" data-domain="${domain}">
         <span class="task-icon" style="display:none">${fallbackIcon}</span>`
      : `<span class="task-icon">${fallbackIcon}</span>`;
    return `<div class="task-card" data-id="${escapeHtml(String(task.id))}">
        <span class="task-icon">${iconHtml}</span>
        <div class="task-info">
          <div class="task-name">${escapeHtml(task.name)}</div>
          <div class="task-url" title="${escapeHtml(task.url)}">${escapeHtml(truncateUrl(task.url))}</div>
        </div>
        <button class="task-delete" data-id="${escapeHtml(String(task.id))}" title="${deleteTitle}">✕</button>
      </div>`;
  }).join('');

  taskList.querySelectorAll('.task-favicon').forEach(img => {
    const domain = img.dataset.domain;
    img.addEventListener('error', function onErr() {
      if (img.dataset.fallback === 'done') return;
      img.dataset.fallback = 'done';
      img.removeEventListener('error', onErr);
      img.addEventListener('error', function finalErr() {
        img.style.display = 'none';
        const fb = img.nextElementSibling;
        if (fb) fb.style.display = 'flex';
      });
      img.src = `https://icons.duckduckgo.com/ip3/${domain}.ico`;
    });
  });

  document.querySelectorAll('.task-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await deleteTask(btn.getAttribute('data-id'));
    });
  });
}

btnPrevPage.addEventListener('click', () => { if (currentPage > 1) { currentPage--; renderTaskList(); } });
btnNextPage.addEventListener('click', () => { currentPage++; renderTaskList(); });

async function deleteTask(id) {
  await TaskStorage.deleteTask(id);
  const tasks = await loadTasks();
  const totalPages = Math.ceil(tasks.length / PAGE_SIZE);
  if (currentPage > totalPages) currentPage = Math.max(1, totalPages);
  await renderTaskList();
  showToast(i18n('toastTaskDeleted'));
}

// ===== 选取签到按钮 =====
/** 向标签页发送 startSelector 并等待内容脚本确认（握手探测内容脚本是否在页面里） */
function startSelectorOnTab(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { action: 'startSelector' }, (resp) => {
      if (chrome.runtime.lastError || !resp || !resp.success) { resolve(false); return; }
      resolve(true);
    });
  });
}

async function startPicker() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) { showToast(i18n('toastNoTab')); return; }
    if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('chrome-extension://'))) {
      showToast(i18n('toastUnsupportedPage')); return;
    }
    // 1) 先直接通信：内容脚本已在页面中（绝大多数情况）
    let ok = await startSelectorOnTab(tab.id);
    if (!ok) {
      // 2) 内容脚本不在页面里——扩展安装/更新前就已打开的页面，manifest 不会自动注入。
      //    补注入 storage.js + selector.js（selector.js 依赖前者里的 TaskStorage）。
      //    注意：注入期间弹窗必须保持打开，提前 window.close() 会中断 pending 的
      //    注入和后续消息，表现为"点了选取页面毫无反应"。
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['storage.js', 'content/selector.js'] });
        ok = await startSelectorOnTab(tab.id);
      } catch (e) {
        // 注入被拒绝（受限页面等）
        showToast(i18n('toastSelectorFailed'));
        return;
      }
    }
    if (!ok) {
      // 3) 注入后仍无响应：典型原因是扩展刚安装/更新，明确提示刷新页面。
      //    不关闭弹窗，保证提示可见。
      showToast(i18n('toastNeedRefresh'), 5000);
      return;
    }
    showToast(i18n('toastClickToSelect'));
    setTimeout(() => window.close(), 400);  // 等 toast 渲染出来再关，避免提示来不及显示
  } catch (err) { showToast(i18n('toastSelectorStartFailed')); }
}

// ===== 手工添加表单 =====
function toggleManualForm() {
  manualForm.classList.toggle('hidden');
  if (!manualForm.classList.contains('hidden')) { taskNameInput.focus(); }
}
function onTaskTypeChange() {
  if (taskTypeSelect.value === 'click') { selectorGroup.classList.remove('hidden'); }
  else { selectorGroup.classList.add('hidden'); taskSelectorInput.value = ''; }
}
async function saveManualTask() {
  const name = taskNameInput.value.trim();
  const url = taskUrlInput.value.trim();
  const type = taskTypeSelect.value;
  const selector = taskSelectorInput.value.trim();
  if (!name) { showToast(i18n('toastInputName')); taskNameInput.focus(); return; }
  if (!url) { showToast(i18n('toastInputUrl')); taskUrlInput.focus(); return; }
  try { new URL(url); } catch { showToast(i18n('toastInvalidUrl')); taskUrlInput.focus(); return; }

  const task = { id: generateTaskId(), name, url, type, selector: type === 'click' ? selector : '', createdAt: Date.now() };
  try {
    await TaskStorage.setTask(task);
  } catch (e) {
    showToast(e.message === 'quotaExceeded' ? i18n('quotaExceeded') : e.message, 3000);
    return;
  }
  taskNameInput.value = ''; taskUrlInput.value = ''; taskSelectorInput.value = ''; taskTypeSelect.value = 'click';
  onTaskTypeChange(); manualForm.classList.add('hidden');
  await renderTaskList();
  showToast(i18n('toastTaskAdded'));
}

// ===== 执行所有签到 =====
async function startExecution() {
  if (isExecuting) return;  // 已在倒计时/执行中，忽略重复点击（否则会并发跑多轮，重复开页/重复点击）
  const tasks = await loadTasks();
  if (tasks.length === 0) { showToast(i18n('toastNoTasks')); return; }
  isExecuting = true;
  btnExecute.disabled = true;
  manualForm.classList.add('hidden');  // 执行时收出手工表单，避免与执行面板叠加撑高弹窗
  schedulePanel.classList.add('hidden');  // 同理，定时面板一并收起
  btnSchedule.disabled = true;
  executePanel.classList.remove('hidden');
  countdownPanel.classList.remove('hidden');
  executingPanel.classList.add('hidden');
  resultPanel.classList.add('hidden');
  executePanel.scrollIntoView({ behavior: 'smooth' });
  countdownCancelled = false;
  let count = 10;
  countdownNumber.textContent = count;
  countdownTimer = setInterval(() => {
    count--;
    countdownNumber.textContent = count;
    if (countdownCancelled) { clearInterval(countdownTimer); executePanel.classList.add('hidden'); return; }
    if (count <= 0) { clearInterval(countdownTimer); executeCountdown(); }
  }, 1000);
}
async function executeCountdown() {
  countdownPanel.classList.add('hidden');
  executingPanel.classList.remove('hidden');
  executingText.textContent = i18n('executingText');
  executingProgress.textContent = '';
  try {
    const response = await chrome.runtime.sendMessage({ action: 'executeTasks' });
    showExecutionResult(response);
  } catch (err) {
    showExecutionResult({ success: 0, fail: 0, details: [], error: i18n('msgExecFailed', [err.message]) });
  } finally {
    finishExecution();
  }
}
function showExecutionResult(result) {
  executingPanel.classList.add('hidden');
  resultPanel.classList.remove('hidden');
  resultSuccess.textContent = result.success || 0;
  resultFail.textContent = result.fail || 0;
  if (result.details && result.details.length > 0) {
    resultDetails.innerHTML = result.details.map(d => {
      const statusIcon = d.success ? '✅' : '❌';
      const statusClass = d.success ? 'success' : 'fail';
      return `<div class="result-detail-item ${statusClass}">${statusIcon} ${i18n('resultDetailFormat', [escapeHtml(d.name), escapeHtml(d.message)])}</div>`;
    }).join('');
  } else if (result.error) {
    resultDetails.innerHTML = `<div class="result-detail-item fail">❌ ${escapeHtml(result.error)}</div>`;
  } else { resultDetails.innerHTML = ''; }
}
function cancelExecution() {
  countdownCancelled = true;
  if (countdownTimer) { clearInterval(countdownTimer); }
  executePanel.classList.add('hidden');
  showToast(i18n('toastCancelled'));
  finishExecution();
}
function finishExecution() {
  isExecuting = false;
  btnExecute.disabled = false;
  btnSchedule.disabled = false;
  updateScheduleInfo();  // 执行刚写入 schedule_state，刷新"上次执行"那一行
}

// ===== 导出 / 导入 =====
async function exportTasks() {
  const tasks = await loadTasks();
  const data = JSON.stringify({ version: 1, tasks }, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `checkin-tasks-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(i18n('exportDone', [String(tasks.length)]));
}
async function handleImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const tasks = Array.isArray(data) ? data : (data.tasks || []);
    if (!Array.isArray(tasks) || tasks.length === 0) { showToast(i18n('importEmpty')); return; }
    const result = await TaskStorage.mergeById(tasks);
    showToast(i18n('importResult', [String(result.added), String(result.updated)]), 3000);
    await renderTaskList();
  } catch (err) {
    showToast(err.message === 'quotaExceeded' ? i18n('importOverQuota') : i18n('importFailed'), 3000);
  }
  importFile.value = '';
}

// ===== 自动签到（定时设置）=====
function pad2(n) { return String(n).padStart(2, '0'); }

/** 把已存的配置填进面板，并同步闹钟按钮的高亮状态 */
async function loadScheduleUI() {
  const cfg = await ScheduleStorage.getScheduleConfig();
  scheduleEnabled.checked = cfg.enabled;
  scheduleTime.value = cfg.time;
  document.querySelectorAll('input[name="tab-policy"]').forEach(r => { r.checked = (r.value === cfg.tabPolicy); });
  btnSchedule.classList.toggle('is-on', cfg.enabled);
  applyScheduleVisualState();
  await updateScheduleInfo();
}

/**
 * 刷新面板的选中态视觉：勾选框本身由浏览器绘制，这里额外给整行加高亮，
 * 让"现在是开还是关 / 选的是哪一项"一眼可辨（不依赖 :has() 支持）
 */
function applyScheduleVisualState() {
  const on = scheduleEnabled.checked;
  schedulePanel.classList.toggle('is-off', !on);
  const row = scheduleEnabled.closest('.schedule-row');
  if (row) row.classList.toggle('is-checked', on);
  document.querySelectorAll('input[name="tab-policy"]').forEach(r => {
    const label = r.closest('.schedule-radio');
    if (label) label.classList.toggle('is-checked', r.checked);
  });
}

/** 面板底部的两行只读信息：下次执行时间、上次执行结果 */
async function updateScheduleInfo() {
  const cfg = await ScheduleStorage.getScheduleConfig();
  const st = await ScheduleStorage.getScheduleState();

  if (cfg.enabled) {
    const d = new Date(ScheduleStorage.nextRunTimestamp(cfg.time));
    const now = new Date();
    const isToday = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    const day = isToday ? i18n('scheduleToday') : i18n('scheduleTomorrow');
    scheduleNext.textContent = i18n('scheduleNextRun', [day + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes())]);
  } else {
    scheduleNext.textContent = i18n('scheduleDisabled');
  }

  if (st.lastRunAt) {
    const d = new Date(st.lastRunAt);
    scheduleLast.textContent = i18n('scheduleLastRun', [
      pad2(d.getHours()) + ':' + pad2(d.getMinutes()),
      String(st.success),
      String(Math.max(0, st.total - st.success))
    ]);
  } else {
    scheduleLast.textContent = i18n('scheduleNever');
  }
}

function toggleSchedulePanel() {
  schedulePanel.classList.toggle('hidden');
  if (!schedulePanel.classList.contains('hidden')) {
    manualForm.classList.add('hidden');  // 与手工添加互斥，避免两块面板叠加撑高弹窗
    updateScheduleInfo();
  }
}

async function saveScheduleConfig(patch) {
  const cfg = await ScheduleStorage.setScheduleConfig(patch);
  btnSchedule.classList.toggle('is-on', cfg.enabled);
  applyScheduleVisualState();
  await updateScheduleInfo();
  // 闹钟由 service worker 进程托管，改完配置必须通知它重建
  try { await chrome.runtime.sendMessage({ action: 'rebuildAlarm' }); } catch (e) { /* 后台不可用时忽略 */ }
  showToast(i18n('scheduleSaved'), 1500);
}

// ===== 监听来自 content script 的消息 =====
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'selectorResult') {
    renderTaskList();
    showToast(i18n('toastTaskAddedSelector'));
    sendResponse({ success: true });
  } else if (message.action === 'executeProgress') {
    executingText.textContent = i18n('executingTask', [message.taskName]);
    executingProgress.textContent = i18n('progressInfo', [String(message.current), String(message.total)]);
  }
  return true;
});

// ===== 事件绑定 =====
btnPick.addEventListener('click', startPicker);
btnToggleForm.addEventListener('click', toggleManualForm);
btnSaveTask.addEventListener('click', saveManualTask);
btnCancelForm.addEventListener('click', () => {
  manualForm.classList.add('hidden');
  taskNameInput.value = ''; taskUrlInput.value = ''; taskSelectorInput.value = '';
});
taskTypeSelect.addEventListener('change', onTaskTypeChange);
btnExecute.addEventListener('click', startExecution);
btnCancelexecute.addEventListener('click', cancelExecution);
btnCloseResult.addEventListener('click', () => { executePanel.classList.add('hidden'); resultPanel.classList.add('hidden'); finishExecution(); });
// 同步面板
syncCorner.addEventListener('click', () => { syncPanel.classList.toggle('hidden'); });
syncPanelClose.addEventListener('click', () => { syncPanel.classList.add('hidden'); });
btnExport.addEventListener('click', exportTasks);
btnImport.addEventListener('click', () => { importFile.click(); });
importFile.addEventListener('change', handleImportFile);
// 定时面板
btnSchedule.addEventListener('click', toggleSchedulePanel);
scheduleEnabled.addEventListener('change', () => saveScheduleConfig({ enabled: scheduleEnabled.checked }));
scheduleTime.addEventListener('change', () => {
  if (!/^\d{2}:\d{2}$/.test(scheduleTime.value)) { loadScheduleUI(); return; }
  saveScheduleConfig({ time: scheduleTime.value });
});
document.querySelectorAll('input[name="tab-policy"]').forEach(r => {
  r.addEventListener('change', () => { if (r.checked) saveScheduleConfig({ tabPolicy: r.value }); });
});

// ===== 初始化 =====
(async () => {
  try {
    const result = await chrome.storage.local.get(['user_language']);
    const savedLang = result.user_language || 'auto';
    langSelect.value = savedLang;
    await loadCustomLanguage(savedLang);
    applyI18nToHTML();
  } catch (e) { console.error('i18n init error:', e); }

  renderTaskList();
  onTaskTypeChange();
  loadScheduleUI();

  // 版本号从 manifest 动态读取，避免与 manifest.json 双处维护漂移
  const headerVersion = document.getElementById('header-version');
  if (headerVersion) headerVersion.textContent = 'v' + chrome.runtime.getManifest().version;

  // 监听存储变化，自动刷新列表 + 同步状态
  if (typeof TaskStorage !== 'undefined') {
    TaskStorage.onChanged(() => { renderTaskList(); });
  }

  langSelect.addEventListener('change', async () => {
    try {
      const lang = langSelect.value;
      await chrome.storage.local.set({ user_language: lang });
      await loadCustomLanguage(lang);
      applyI18nToHTML();
    } catch (e) { console.error('lang switch error:', e); }
    renderTaskList();
    updateScheduleInfo();  // 面板底部两行由 JS 生成，切换语言需重刷
  });
})();
