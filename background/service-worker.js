/**
 * 网页签到助手 - Background Service Worker
 * 负责接收执行任务指令，依次打开标签页并执行签到点击，收集结果并发送通知
 */

const STORAGE_KEY = 'checkin_tasks';

// ===== 工具函数 =====

/** 从 storage 读取任务列表 */
function loadTasks() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      resolve(result[STORAGE_KEY] || []);
    });
  });
}

/** 延迟函数 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ===== 等待标签页加载 =====

/**
 * 等待指定标签页加载完成
 * @param {number} tabId - 标签页ID
 * @param {number} timeout - 超时时间（毫秒）
 */
function waitForTabLoaded(tabId, timeout = 30000) {
  return new Promise((resolve) => {
    let resolved = false;

    function onUpdated(id, info) {
      if (id === tabId && info.status === 'complete' && !resolved) {
        resolved = true;
        chrome.tabs.onUpdated.removeListener(onUpdated);
        // 额外等待确保 content script 已就绪
        setTimeout(resolve, 800);
      }
    }

    chrome.tabs.onUpdated.addListener(onUpdated);

    // 超时保护
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    }, timeout);
  });
}

// ===== 执行单个任务 =====

/**
 * 执行单个签到任务
 * @param {Object} task - 任务对象 { name, url, type, selector }
 * @returns {Promise<Object>} 执行结果 { success: boolean, message: string }
 */
async function executeSingleTask(task) {
  try {
    // 验证URL
    if (!task.url) {
      return { success: false, message: 'URL为空' };
    }

    // 打开标签页（后台打开，不打扰用户）
    const tab = await chrome.tabs.create({ url: task.url, active: false });

    // 等待页面加载完成
    await waitForTabLoaded(tab.id);

    // 检查标签页是否还存在
    const tabInfo = await chrome.tabs.get(tab.id).catch(() => null);
    if (!tabInfo) {
      return { success: false, message: '标签页已关闭' };
    }

    // 如果是 click 类型且有 selector，执行自动点击
    if (task.type === 'click' && task.selector) {
      return await performClick(tab.id, task.selector);
    }

    // 仅打开网页类型，打开即成功
    return { success: true, message: '页面已打开' };
  } catch (err) {
    return { success: false, message: err.message || '执行异常' };
  }
}

/**
 * 在指定标签页执行点击操作
 * 优先通过消息发送，失败则用 executeScript 注入
 * @param {number} tabId - 标签页ID
 * @param {string} selector - CSS选择器
 */
async function performClick(tabId, selector) {
  // 方式1：通过消息发送给 content script
  try {
    const result = await chrome.tabs.sendMessage(tabId, {
      action: 'autoClick',
      selector: selector
    });
    if (result) {
      return result;
    }
  } catch (msgErr) {
    // 消息发送失败（content script 可能未注入），继续尝试方式2
  }

  // 方式2：用 chrome.scripting.executeScript 直接注入点击代码
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: injectedClickFunction,
      args: [selector]
    });
    if (results && results[0] && results[0].result) {
      return results[0].result;
    }
    return { success: false, message: '注入执行无结果' };
  } catch (execErr) {
    return { success: false, message: '注入失败: ' + (execErr.message || '未知错误') };
  }
}

/**
 * 注入到页面中执行的点击函数
 * 此函数会被序列化后注入目标页面执行，不能引用外部变量
 * @param {string} selector - CSS选择器
 */
function injectedClickFunction(selector) {
  if (!selector) {
    return { success: false, message: '未提供CSS选择器' };
  }

  let element = null;
  try {
    element = document.querySelector(selector);
  } catch (e) {
    return { success: false, message: 'CSS选择器无效' };
  }

  if (!element) {
    return { success: false, message: '未找到匹配元素' };
  }

  // 滚动到元素位置
  element.scrollIntoView({ behavior: 'instant', block: 'center' });

  // 模拟完整点击事件序列
  const rect = element.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  const eventOptions = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: centerX,
    clientY: centerY,
    button: 0
  };

  try {
    element.dispatchEvent(new MouseEvent('mousedown', eventOptions));
    element.dispatchEvent(new MouseEvent('mouseup', eventOptions));
    element.dispatchEvent(new MouseEvent('click', eventOptions));

    if (typeof element.click === 'function') {
      element.click();
    }

    return { success: true, message: '点击成功' };
  } catch (e) {
    return { success: false, message: '点击失败: ' + e.message };
  }
}

// ===== 发送进度通知 =====

/**
 * 向 popup 发送执行进度
 * @param {number} current - 当前任务序号
 * @param {number} total - 总任务数
 * @param {string} taskName - 当前任务名称
 */
function sendProgress(current, total, taskName) {
  chrome.runtime.sendMessage({
    action: 'executeProgress',
    current: current,
    total: total,
    taskName: taskName
  }).catch(() => {
    // popup 可能已关闭，忽略错误
  });
}

// ===== 执行所有任务 =====

/**
 * 依次执行所有签到任务
 * @returns {Promise<Object>} 汇总结果 { success, fail, details }
 */
async function executeAllTasks() {
  const tasks = await loadTasks();
  const details = [];
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];

    // 发送进度
    sendProgress(i + 1, tasks.length, task.name);

    // 执行单个任务
    const result = await executeSingleTask(task);

    // 记录结果
    details.push({
      name: task.name,
      success: result.success,
      message: result.message
    });

    if (result.success) {
      successCount++;
    } else {
      failCount++;
    }

    // 任务间隔2秒（最后一个任务不需要等待）
    if (i < tasks.length - 1) {
      await sleep(2000);
    }
  }

  // 发送桌面通知
  sendNotification(successCount, failCount);

  return {
    success: successCount,
    fail: failCount,
    details: details
  };
}

// ===== 桌面通知 =====

/**
 * 发送桌面通知
 * @param {number} success - 成功数
 * @param {number} fail - 失败数
 */
function sendNotification(success, fail) {
  const total = success + fail;
  const iconUrl = chrome.runtime.getURL('icons/icon48.png');

  chrome.notifications.create({
    type: 'basic',
    iconUrl: iconUrl,
    title: '签到执行完成',
    message: `共执行 ${total} 个任务，成功 ${success} 个，失败 ${fail} 个。`,
    priority: 2
  }, () => {
    // 忽略通知创建错误
    if (chrome.runtime.lastError) return;
  });
}

// ===== 消息监听 =====

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'executeTasks') {
    executeAllTasks().then(result => {
      sendResponse(result);
    }).catch(err => {
      sendResponse({
        success: 0,
        fail: 0,
        details: [],
        error: '执行失败: ' + (err.message || '未知错误')
      });
    });
    return true; // 保持消息通道开放，等待异步响应
  }
  return true;
});

// ===== Service Worker 安装事件 =====

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // 首次安装，可以初始化一些数据
    console.log('网页签到助手已安装');
  }
});
