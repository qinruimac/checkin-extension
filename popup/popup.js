/**
 * 签到助手 - 弹窗脚本
 * 责责任务列表的加载/渲染/删除、选取签到按钮、手工添加、执行所有签到及倒计时逻辑
 *
 * v1.1.0 变更：
 *  - 存储层切换到 TaskStorage（chrome.storage.sync，跟随浏览器账号）
 *  - 新增同步状态角落图标（三态中性色）+ 可展开面板
 *  - 新增导出/导入功能（用户侧手动跨设备搬运 / 备份）
 */

// ===== i18n 系统（支持手动语言切换）=====
let customMessages = null;

async function loadCustomLanguage(lang) {
  if (!lang || lang === 'auto') { customMessages = null; return; }
  try {
    const url = chrome.runtime.getURL(`_locales/${lang}/messages.json`);
    const response = await fetch(url);
    customMessages = await response.json();
  } catch (e) { customMessages = null; }
}

function customGetMessage(key, substitutions) {
  if (!customMessages || !customMessages[key]) {
    return chrome.i18n.getMessage(key, substitutions);
  }
  const entry = customMessages[key];
  let msg = entry.message || '';
  if (entry.placeholders && substitutions) {
    const subs = Array.isArray(substitutions) ? substitutions : [substitutions];
    for (const [name, info] of Object.entries(entry.placeholders)) {
      const idx = parseInt(info.content.replace(/\$/g, '')) - 1;
      msg = msg.replace(new RegExp(`\\$${name}\\$`, 'g'), subs[idx] || '');
    }
  }
  return msg;
}

const i18n = (key, substitutions) => customGetMessage(key, substitutions);

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
const syncDot = document.getElementById('sync-dot');
const syncPanel = document.getElementById('sync-panel');
const syncStatusText = document.getElementById('sync-status-text');
const syncPanelClose = document.getElementById('sync-panel-close');
const btnExport = document.getElementById('btn-export');
const btnImport = document.getElementById('btn-import');
const importFile = document.getElementById('import-file');

// ===== 倒计时状态 =====
let countdownTimer = null;
let countdownCancelled = false;

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
    return `<div class="task-card" data-id="${task.id}">
        <span class="task-icon">${iconHtml}</span>
        <div class="task-info">
          <div class="task-name">${escapeHtml(task.name)}</div>
          <div class="task-url" title="${escapeHtml(task.url)}">${escapeHtml(truncateUrl(task.url))}</div>
        </div>
        <button class="task-delete" data-id="${task.id}" title="${deleteTitle}">✕</button>
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
async function startPicker() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) { showToast(i18n('toastNoTab')); return; }
    if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('chrome-extension://'))) {
      showToast(i18n('toastUnsupportedPage')); return;
    }
    chrome.tabs.sendMessage(tab.id, { action: 'startSelector' }, () => {
      if (chrome.runtime.lastError) {
        chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/selector.js'] })
          .then(() => { chrome.tabs.sendMessage(tab.id, { action: 'startSelector' }); showToast(i18n('toastClickToSelect')); })
          .catch(() => { showToast(i18n('toastSelectorFailed')); });
      } else { showToast(i18n('toastClickToSelect')); }
    });
    window.close();
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
  const tasks = await loadTasks();
  if (tasks.length === 0) { showToast(i18n('toastNoTasks')); return; }
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
}

// ===== 同步状态 UI =====
async function updateSyncStatus() {
  if (typeof SyncStatus === 'undefined') return;
  const { state } = await SyncStatus.getState();
  syncDot.classList.remove('sync-dot-synced', 'sync-dot-pending', 'sync-dot-off');
  let labelKey, tooltipKey, dotClass;
  if (state === 'synced') { labelKey = 'syncLabelSynced'; tooltipKey = 'syncTooltipSynced'; dotClass = 'sync-dot-synced'; }
  else if (state === 'pending') { labelKey = 'syncLabelPending'; tooltipKey = 'syncTooltipPending'; dotClass = 'sync-dot-pending'; }
  else { labelKey = 'syncLabelEmpty'; tooltipKey = 'syncTooltipEmpty'; dotClass = 'sync-dot-off'; }
  syncDot.classList.add(dotClass);
  const tip = i18n(tooltipKey);
  syncCorner.title = tip;
  if (syncStatusText) syncStatusText.textContent = tip;
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
    await updateSyncStatus();
  } catch (err) {
    showToast(err.message === 'quotaExceeded' ? i18n('importOverQuota') : i18n('importFailed'), 3000);
  }
  importFile.value = '';
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
btnCloseResult.addEventListener('click', () => { executePanel.classList.add('hidden'); resultPanel.classList.add('hidden'); });
// 同步面板
syncCorner.addEventListener('click', () => { syncPanel.classList.toggle('hidden'); });
syncPanelClose.addEventListener('click', () => { syncPanel.classList.add('hidden'); });
btnExport.addEventListener('click', exportTasks);
btnImport.addEventListener('click', () => { importFile.click(); });
importFile.addEventListener('change', handleImportFile);

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
  updateSyncStatus();

  // 监听存储变化，自动刷新列表 + 同步状态
  if (typeof TaskStorage !== 'undefined') {
    TaskStorage.onChanged(() => { renderTaskList(); updateSyncStatus(); });
  }

  langSelect.addEventListener('change', async () => {
    try {
      const lang = langSelect.value;
      await chrome.storage.local.set({ user_language: lang });
      await loadCustomLanguage(lang);
      applyI18nToHTML();
    } catch (e) { console.error('lang switch error:', e); }
    renderTaskList();
    updateSyncStatus();
  });
})();
