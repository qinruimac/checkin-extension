/**
 * 网页签到助手 - 弹窗脚本
 * 责责任务列表的加载/渲染/删除、选取签到按钮、手工添加、执行所有签到及倒计时逻辑
 */

// ===== 常量定义 =====
const STORAGE_KEY = 'checkin_tasks';

// ===== DOM 元素引用 =====
const btnPick = document.getElementById('btn-pick');
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
  taskCount.textContent = `${tasks.length} 个任务`;

  // 更新底部统计
  const clickCount = tasks.filter(t => t.type === 'click').length;
  const openCount = tasks.filter(t => t.type === 'open').length;
  footerStats.textContent = `共 ${tasks.length} 个任务 | 点击 ${clickCount} | 打开 ${openCount}`;

  // 空状态处理
  if (tasks.length === 0) {
    taskList.innerHTML = '';
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');

  // 渲染任务卡片
  taskList.innerHTML = tasks.map(task => {
    const fallbackIcon = task.type === 'click' ? '🎯' : '🔗';
    let domain = '';
    try {
      domain = new URL(task.url).hostname;
    } catch (e) {
      domain = '';
    }
    const faviconUrl = domain
      ? `https://www.google.com/s2/favicons?domain=${domain}&sz=32`
      : '';
    const iconHtml = faviconUrl
      ? `<img src="${faviconUrl}" class="task-favicon" alt="${escapeHtml(task.name)}"
           onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
         <span class="task-icon" style="display:none">${fallbackIcon}</span>`
      : `<span class="task-icon">${fallbackIcon}</span>`;
    return `
      <div class="task-card" data-id="${task.id}">
        <span class="task-icon">${iconHtml}</span>
        <div class="task-info">
          <div class="task-name">${escapeHtml(task.name)}</div>
          <div class="task-url" title="${escapeHtml(task.url)}">${escapeHtml(truncateUrl(task.url))}</div>
        </div>
        <button class="task-delete" data-id="${task.id}" title="删除任务">✕</button>
      </div>
    `;
  }).join('');

  // 绑定删除按钮事件
  document.querySelectorAll('.task-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      await deleteTask(id);
    });
  });
}

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
  await renderTaskList();
  showToast('任务已删除');
}

// ===== 选取签到按钮 =====

/** 启动元素选择器模式 */
async function startPicker() {
  try {
    // 获取当前活动标签页
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      showToast('无法获取当前标签页');
      return;
    }

    // 检查是否是特殊页面（chrome://, edge:// 等）
    if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('chrome-extension://'))) {
      showToast('该页面不支持元素选取');
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
          showToast('请在页面上点击签到按钮');
        }).catch(() => {
          showToast('无法启动选择器，请刷新页面后重试');
        });
      } else {
        showToast('请在页面上点击签到按钮');
      }
    });

    // 关闭弹窗，让用户在页面上操作
    window.close();
  } catch (err) {
    showToast('启动选择器失败');
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
    showToast('请输入任务名称');
    taskNameInput.focus();
    return;
  }
  if (!url) {
    showToast('请输入页面 URL');
    taskUrlInput.focus();
    return;
  }

  // 验证URL格式
  try {
    new URL(url);
  } catch {
    showToast('URL 格式不正确');
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
  showToast('任务添加成功');
}

// ===== 执行所有签到 =====

/** 开始执行所有签到任务（启动倒计时） */
async function startExecution() {
  const tasks = await loadTasks();
  if (tasks.length === 0) {
    showToast('没有可执行的签到任务');
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
  executingText.textContent = '正在执行签到任务...';
  executingProgress.textContent = '';

  try {
    // 发送消息给 background service worker 执行任务
    const response = await chrome.runtime.sendMessage({ action: 'executeTasks' });
    showExecutionResult(response);
  } catch (err) {
    showExecutionResult({ success: 0, fail: 0, details: [], error: '执行失败: ' + err.message });
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
      return `<div class="result-detail-item ${statusClass}">${statusIcon} ${escapeHtml(d.name)}：${escapeHtml(d.message)}</div>`;
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
  showToast('已取消执行');
}

// ===== 监听来自 content script 的消息 =====

/** 处理选择器返回的任务 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'selectorResult') {
    // 选择器返回了任务信息，刷新列表
    renderTaskList();
    showToast('签到任务已添加');
    sendResponse({ success: true });
  } else if (message.action === 'executeProgress') {
    // 更新执行进度显示
    executingText.textContent = `正在执行：${message.taskName}`;
    executingProgress.textContent = `进度：${message.current} / ${message.total}`;
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

// ===== 初始化 =====
document.addEventListener('DOMContentLoaded', () => {
  renderTaskList();
  onTaskTypeChange();
});

// 初始渲染
renderTaskList();
onTaskTypeChange();
