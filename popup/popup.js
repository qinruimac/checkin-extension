/**
 * 网页签到助手 - 弹窗脚本
 * 责责任务列表的加载/渲染/删除、选取签到按钮、手工添加、执行所有签到及倒计时逻辑
 */

// ===== i18n 系统（支持手动语言切换）=====
let customMessages = null;

async function loadCustomLanguage(lang) {
  if (!lang || lang === 'auto') {
    customMessages = null;
    return;
  }
  try {
    const url = chrome.runtime.getURL(`_locales/${lang}/messages.json`);
    const response = await fetch(url);
    customMessages = await response.json();
  } catch (e) {
    customMessages = null;
  }
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
function applyI18nToHTML() {
  const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  let node;
  while (node = walker.nextNode()) {
    if (node.textContent.includes('__MSG_')) textNodes.push(node);
  }
  textNodes.forEach(n => {
    n.textContent = n.textContent.replace(/__MSG_(\w+)__/g, (_, key) => i18n(key) || _);
  });
  document.querySelectorAll('*').forEach(el => {
    for (const attr of [...el.attributes]) {
      if (attr.value.includes('__MSG_')) {
        el.setAttribute(attr.name, attr.value.replace(/__MSG_(\w+)__/g, (_, key) => i18n(key) || _));
      }
    }
  });
}

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

// ===== 倒计时状态 =====
let countdownTimer = null;
let countdownCancelled = false;

// ===== 工具函数 =====

/** 显示 Toast 消息提示 */
function showToast(message, duration = 2000) {
  toast.textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => {
    toast.classList.add('hidden');
  }, duration);
}

/** 生成唯一任务ID */
function generateTaskId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

/** 截断URL用于显示 */
function truncateUrl(url, maxLength = 40) {
  if (url.length <= maxLength) return url;
  return url.substr(0, maxLength) + '...';
}

/** 从 chrome.storage.local 读取任务列表 */
async function loadTasks() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      resolve(result[STORAGE_KEY] || []);
    });
  });
}

/** 保存任务列表到 chrome.storage.local */
async function saveTasks(tasks) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: tasks }, () => {
      resolve();
    });
  });
}

// ===== 任务列表渲染 =====

/** 渲染任务列表 */
async function renderTaskList() {
  const tasks = await loadTasks();

  // 更新任务计数
  taskCount.textContent = i18n('taskCount', [String(tasks.length)]);

  // 更新底部统计
  const clickCount = tasks.filter(t => t.type === 'click').length;
  const openCount = tasks.filter(t => t.type === 'open').length;
  footerStats.textContent = i18n('footerStats', [String(tasks.length), String(clickCount), String(openCount)]);

  // 空状态处理
  if (tasks.length === 0) {
    taskList.innerHTML = '';
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');

  // 分页切片
  const totalPages = Math.ceil(tasks.length / PAGE_SIZE);
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageTasks = tasks.slice(start, start + PAGE_SIZE);

  // 渲染分页控件
  if (totalPages > 1) {
    pagination.classList.remove('hidden');
    pageInfo.textContent = `${currentPage} / ${totalPages}`;
    btnPrevPage.disabled = currentPage <= 1;
    btnNextPage.disabled = currentPage >= totalPages;
  } else {
    pagination.classList.add('hidden');
  }

  // 渲染任务卡片
  const deleteTitle = i18n('btnDeleteTask');
  taskList.innerHTML = pageTasks.map(task => {
    const fallbackIcon = task.type === 'click' ? '🎯' : '🔗';
    let domain = '';
    try {
      domain = new URL(task.url).hostname;
    } catch (e) {
      domain = '';
    }
    // 三级回退：网站自身 favicon → DuckDuckGo → emoji
    // 注意：MV3 CSP 禁止内联 onerror，改用 addEventListener 绑定
    const iconHtml = domain
      ? `<img src="https://${domain}/favicon.ico" class="task-favicon" alt="${escapeHtml(task.name)}"
           data-domain="${domain}">
         <span class="task-icon" style="display:none">${fallbackIcon}</span>`
      : `<span class="task-icon">${fallbackIcon}</span>`;
    return `
      <div class="task-card" data-id="${task.id}">
        <span class="task-icon">${iconHtml}</span>
        <div class="task-info">
          <div class="task-name">${escapeHtml(task.name)}</div>
          <div class="task-url" title="${escapeHtml(task.url)}">${escapeHtml(truncateUrl(task.url))}</div>
        </div>
        <button class="task-delete" data-id="${task.id}" title="${deleteTitle}">✕</button>
      </div>
    `;
  }).join('');

  // 绑定 favicon 三级回退（避免内联 onerror 违反 MV3 CSP）
  taskList.querySelectorAll('.task-favicon').forEach(img => {
    const domain = img.dataset.domain;
    img.addEventListener('error', function onErr() {
      if (img.dataset.fallback === 'done') return;
      img.dataset.fallback = 'done';
      // 切到 DuckDuckGo
      img.removeEventListener('error', onErr);
      img.addEventListener('error', function finalErr() {
        img.style.display = 'none';
        const fb = img.nextElementSibling;
        if (fb) fb.style.display = 'flex';
      });
      img.src = `https://icons.duckduckgo.com/ip3/${domain}.ico`;
    });
  });

  // 绑定删除按钮事件
  document.querySelectorAll('.task-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      await deleteTask(id);
    });
  });
}

/** 分页：上一页 / 下一页 */
btnPrevPage.addEventListener('click', () => {
  if (currentPage > 1) { currentPage--; renderTaskList(); }
});
btnNextPage.addEventListener('click', () => {
  currentPage++; renderTaskList();
});

/** HTML 转义，防止 XSS */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/** 删除任务 */
async function deleteTask(id) {
  const tasks = await loadTasks();
  const newTasks = tasks.filter(t => t.id !== id);
  await saveTasks(newTasks);
  // 如果当前页删空了，往前退一页
  const totalPages = Math.ceil(newTasks.length / PAGE_SIZE);
  if (currentPage > totalPages) currentPage = Math.max(1, totalPages);
  await renderTaskList();
  showToast(i18n('toastTaskDeleted'));
}

// ===== 选取签到按钮 =====

/** 启动元素选择器模式 */
async function startPicker() {
  try {
    // 获取当前活动标签页
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      showToast(i18n('toastNoTab'));
      return;
    }

    // 检查是否是特殊页面（chrome://, edge:// 等）
    if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('chrome-extension://'))) {
      showToast(i18n('toastUnsupportedPage'));
      return;
    }

    // 向当前标签页发送启动选择器消息
    chrome.tabs.sendMessage(tab.id, { action: 'startSelector' }, (response) => {
      if (chrome.runtime.lastError) {
        // content script 可能还未注入，尝试手动注入
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content/selector.js']
        }).then(() => {
          // 注入完成后再次发送消息
          chrome.tabs.sendMessage(tab.id, { action: 'startSelector' });
          showToast(i18n('toastClickToSelect'));
        }).catch(() => {
          showToast(i18n('toastSelectorFailed'));
        });
      } else {
        showToast(i18n('toastClickToSelect'));
      }
    });

    // 关闭弹窗，让用户在页面上操作
    window.close();
  } catch (err) {
    showToast(i18n('toastSelectorStartFailed'));
  }
}

// ===== 手工添加表单 =====

/** 切换手工添加表单显示/隐藏 */
function toggleManualForm() {
  manualForm.classList.toggle('hidden');
  if (!manualForm.classList.contains('hidden')) {
    taskNameInput.focus();
  }
}

/** 任务类型变化时切换选择器输入框显示 */
function onTaskTypeChange() {
  if (taskTypeSelect.value === 'click') {
    selectorGroup.classList.remove('hidden');
  } else {
    selectorGroup.classList.add('hidden');
    taskSelectorInput.value = '';
  }
}

/** 保存手工添加的任务 */
async function saveManualTask() {
  const name = taskNameInput.value.trim();
  const url = taskUrlInput.value.trim();
  const type = taskTypeSelect.value;
  const selector = taskSelectorInput.value.trim();

  // 验证输入
  if (!name) {
    showToast(i18n('toastInputName'));
    taskNameInput.focus();
    return;
  }
  if (!url) {
    showToast(i18n('toastInputUrl'));
    taskUrlInput.focus();
    return;
  }

  // 验证URL格式
  try {
    new URL(url);
  } catch {
    showToast(i18n('toastInvalidUrl'));
    taskUrlInput.focus();
    return;
  }

  // 构建任务对象
  const task = {
    id: generateTaskId(),
    name: name,
    url: url,
    type: type,
    selector: type === 'click' ? selector : '',
    createdAt: Date.now()
  };

  // 保存到存储
  const tasks = await loadTasks();
  tasks.push(task);
  await saveTasks(tasks);

  // 清空表单并折叠
  taskNameInput.value = '';
  taskUrlInput.value = '';
  taskSelectorInput.value = '';
  taskTypeSelect.value = 'click';
  onTaskTypeChange();
  manualForm.classList.add('hidden');

  // 刷新列表
  await renderTaskList();
  showToast(i18n('toastTaskAdded'));
}

// ===== 执行所有签到 =====

/** 开始执行所有签到任务（启动倒计时） */
async function startExecution() {
  const tasks = await loadTasks();
  if (tasks.length === 0) {
    showToast(i18n('toastNoTasks'));
    return;
  }

  // 显示倒计时面板
  executePanel.classList.remove('hidden');
  countdownPanel.classList.remove('hidden');
  executingPanel.classList.add('hidden');
  resultPanel.classList.add('hidden');

  // 滚动到执行面板
  executePanel.scrollIntoView({ behavior: 'smooth' });

  // 开始10秒倒计时
  countdownCancelled = false;
  let count = 10;
  countdownNumber.textContent = count;

  countdownTimer = setInterval(() => {
    count--;
    countdownNumber.textContent = count;

    if (countdownCancelled) {
      clearInterval(countdownTimer);
      executePanel.classList.add('hidden');
      return;
    }

    if (count <= 0) {
      clearInterval(countdownTimer);
      executeCountdown();
    }
  }, 1000);
}

/** 倒计时结束，开始执行任务 */
async function executeCountdown() {
  // 切换到执行中面板
  countdownPanel.classList.add('hidden');
  executingPanel.classList.remove('hidden');
  executingText.textContent = i18n('executingText');
  executingProgress.textContent = '';

  try {
    // 发送消息给 background service worker 执行任务
    const response = await chrome.runtime.sendMessage({ action: 'executeTasks' });
    showExecutionResult(response);
  } catch (err) {
    showExecutionResult({ success: 0, fail: 0, details: [], error: i18n('msgExecFailed', [err.message]) });
  }
}

/** 显示执行结果 */
function showExecutionResult(result) {
  executingPanel.classList.add('hidden');
  resultPanel.classList.remove('hidden');

  const success = result.success || 0;
  const fail = result.fail || 0;

  resultSuccess.textContent = success;
  resultFail.textContent = fail;

  // 渲染详细结果
  if (result.details && result.details.length > 0) {
    resultDetails.innerHTML = result.details.map(d => {
      const statusIcon = d.success ? '✅' : '❌';
      const statusClass = d.success ? 'success' : 'fail';
      const detailText = i18n('resultDetailFormat', [escapeHtml(d.name), escapeHtml(d.message)]);
      return `<div class="result-detail-item ${statusClass}">${statusIcon} ${detailText}</div>`;
    }).join('');
  } else if (result.error) {
    resultDetails.innerHTML = `<div class="result-detail-item fail">❌ ${escapeHtml(result.error)}</div>`;
  } else {
    resultDetails.innerHTML = '';
  }
}

/** 取消执行 */
function cancelExecution() {
  countdownCancelled = true;
  if (countdownTimer) {
    clearInterval(countdownTimer);
  }
  executePanel.classList.add('hidden');
  showToast(i18n('toastCancelled'));
}

// ===== 监听来自 content script 的消息 =====

/** 处理选择器返回的任务 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'selectorResult') {
    // 选择器返回了任务信息，刷新列表
    renderTaskList();
    showToast(i18n('toastTaskAddedSelector'));
    sendResponse({ success: true });
  } else if (message.action === 'executeProgress') {
    // 更新执行进度显示
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
  taskNameInput.value = '';
  taskUrlInput.value = '';
  taskSelectorInput.value = '';
});
taskTypeSelect.addEventListener('change', onTaskTypeChange);
btnExecute.addEventListener('click', startExecution);
btnCancelexecute.addEventListener('click', cancelExecution);
btnCloseResult.addEventListener('click', () => {
  executePanel.classList.add('hidden');
  resultPanel.classList.add('hidden');
});

// ===== 初始化（异步加载语言后再渲染）=====
(async () => {
  // 读取语言偏好
  const result = await chrome.storage.local.get(['user_language']);
  const savedLang = result.user_language || 'auto';
  langSelect.value = savedLang;
  await loadCustomLanguage(savedLang);
  applyI18nToHTML();
  renderTaskList();
  onTaskTypeChange();

  // 语言切换
  langSelect.addEventListener('change', async () => {
    const lang = langSelect.value;
    await chrome.storage.local.set({ user_language: lang });
    await loadCustomLanguage(lang);
    applyI18nToHTML();
    renderTaskList();
  });
})();
