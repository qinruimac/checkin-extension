/**
 * Copyright (c) 2026 qin_rui (https://github.com/qinruimac)
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 签到助手 - Background Service Worker
 * 负责接收执行任务指令，依次打开标签页并执行签到点击，收集结果并发送通知
 *
 * v1.1.0 变更：
 *  - importScripts 加载 storage.js
 *  - onInstalled 时自动迁移 local → sync（幂等，不删 local）
 *  - loadTasks 改走 TaskStorage.getTasks()
 */

// MV3 service worker 用 importScripts 加载额外脚本
try { importScripts(chrome.runtime.getURL('i18n.js'), chrome.runtime.getURL('storage.js')); } catch (e) { console.error('importScripts failed:', e); }

// ===== i18n（共享模块 CheckinI18n，见 i18n.js）=====
const i18n = (key, subs) => CheckinI18n.getMsg(key, subs);

// ===== 工具函数 =====
async function loadTasks() {
  return TaskStorage.getTasks();
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// ===== 等待标签页加载 =====
async function waitForTabLoaded(tabId, timeout = 30000) {
  // 先查当前状态：若 complete 事件在监听器挂载前就已发出（如缓存页面直接秒开），
  // 挂监听后会一直等不到，只能干等 timeout。因此挂监听前先确认一次。
  try {
    const t = await chrome.tabs.get(tabId);
    if (t.status === 'complete') { await sleep(800); return; }
  } catch (e) { return; }  // 标签页已关闭
  return new Promise((resolve) => {
    let resolved = false;
    function onUpdated(id, info) {
      if (id === tabId && info.status === 'complete' && !resolved) {
        resolved = true;
        chrome.tabs.onUpdated.removeListener(onUpdated);
        setTimeout(resolve, 800);
      }
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
    setTimeout(() => {
      if (!resolved) { resolved = true; chrome.tabs.onUpdated.removeListener(onUpdated); resolve(); }
    }, timeout);
  });
}

// ===== 执行单个任务 =====
async function executeSingleTask(task) {
  try {
    if (!task.url) return { success: false, message: i18n('msgUrlEmpty') };
    const tab = await chrome.tabs.create({ url: task.url, active: false });
    await waitForTabLoaded(tab.id);
    const tabInfo = await chrome.tabs.get(tab.id).catch(() => null);
    if (!tabInfo) return { success: false, message: i18n('msgTabClosed') };
    if (task.type === 'click' && task.selector) return await performClick(tab.id, task.selector);
    return { success: true, message: i18n('msgPageOpened') };
  } catch (err) {
    return { success: false, message: err.message || i18n('msgExecError') };
  }
}

async function performClick(tabId, selector) {
  try {
    const result = await chrome.tabs.sendMessage(tabId, { action: 'autoClick', selector });
    if (result) return result;
  } catch (msgErr) { /* content script 可能未注入，继续尝试注入 */ }

  const msgs = {
    noSelector: i18n('msgNoSelector'),
    invalidSelector: i18n('msgInvalidSelector'),
    notFound: i18n('msgElementNotFound'),
    success: i18n('msgClickSuccess'),
    failPrefix: i18n('msgClickFailed', [''])
  };
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId }, func: injectedClickFunction, args: [selector, msgs]
    });
    if (results && results[0] && results[0].result) return results[0].result;
    return { success: false, message: i18n('msgNoResult') };
  } catch (execErr) {
    return { success: false, message: i18n('msgInjectFailed', [execErr.message || i18n('msgUnknownError')]) };
  }
}

function injectedClickFunction(selector, msgs) {
  if (!selector) return { success: false, message: msgs.noSelector };
  let element = null;
  try { element = document.querySelector(selector); } catch (e) { return { success: false, message: msgs.invalidSelector }; }
  if (!element) return { success: false, message: msgs.notFound };
  element.scrollIntoView({ behavior: 'instant', block: 'center' });
  const rect = element.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const eventOptions = { bubbles: true, cancelable: true, view: window, clientX: centerX, clientY: centerY, button: 0 };
  try {
    element.dispatchEvent(new MouseEvent('mousedown', eventOptions));
    element.dispatchEvent(new MouseEvent('mouseup', eventOptions));
    element.dispatchEvent(new MouseEvent('click', eventOptions));
    if (typeof element.click === 'function') element.click();
    return { success: true, message: msgs.success };
  } catch (e) { return { success: false, message: msgs.failPrefix + e.message }; }
}

// ===== 发送进度通知 =====
function sendProgress(current, total, taskName) {
  chrome.runtime.sendMessage({ action: 'executeProgress', current, total, taskName }).catch(() => {});
}

// ===== 执行所有任务 =====
async function executeAllTasks() {
  const tasks = await loadTasks();
  const details = [];
  let successCount = 0, failCount = 0;
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    sendProgress(i + 1, tasks.length, task.name);
    const result = await executeSingleTask(task);
    details.push({ name: task.name, success: result.success, message: result.message });
    if (result.success) successCount++; else failCount++;
    if (i < tasks.length - 1) await sleep(2000);
  }
  sendNotification(successCount, failCount);
  return { success: successCount, fail: failCount, details };
}

// ===== 桌面通知 =====
function sendNotification(success, fail) {
  const total = success + fail;
  chrome.notifications.create({
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon48.png'),
    title: i18n('notifTitle'),
    message: i18n('notifMessage', [String(total), String(success), String(fail)]),
    priority: 2
  }, () => { if (chrome.runtime.lastError) return; });
}

// ===== 消息监听 =====
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'executeTasks') {
    CheckinI18n.init().then(() => executeAllTasks()).then(result => sendResponse(result))
      .catch(err => sendResponse({ success: 0, fail: 0, details: [], error: i18n('msgExecFailed', [err.message || i18n('msgUnknownError')]) }));
    return true;
  }
  return true;
});

// ===== onInstalled：自动迁移 local → sync（幂等）=====
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    console.log('Check-in Assistant installed');
  }
  // 无论 install 还是 update，都尝试迁移（migrateFromLocal 内部幂等）
  try {
    const r = await TaskStorage.migrateFromLocal();
    if (r.migrated > 0) {
      console.log(`Migrated ${r.migrated} tasks from local to sync`);
    }
    if (r.overQuota) {
      console.warn('Migration skipped: sync quota would be exceeded');
    }
  } catch (e) {
    console.error('Migration failed:', e);
  }
});
