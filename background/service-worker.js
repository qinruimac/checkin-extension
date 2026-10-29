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
    if (!task.url) return { success: false, message: i18n('msgUrlEmpty'), tabId: null };
    const tab = await chrome.tabs.create({ url: task.url, active: false });
    await waitForTabLoaded(tab.id);
    const tabInfo = await chrome.tabs.get(tab.id).catch(() => null);
    if (!tabInfo) return { success: false, message: i18n('msgTabClosed'), tabId: null };
    if (task.type === 'click' && task.selector) {
      const r = await performClick(tab.id, task.selector);
      r.tabId = tab.id;   // 供自动执行后按策略关闭标签页
      return r;
    }
    return { success: true, message: i18n('msgPageOpened'), tabId: tab.id };
  } catch (err) {
    return { success: false, message: err.message || i18n('msgExecError'), tabId: null };
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
/**
 * @param {Object} [opts]
 * @param {'manual'|'auto'} [opts.source='manual'] 触发来源
 * @param {'close'|'keep'} [opts.tabPolicy='keep'] 自动执行后的标签页处理
 */
async function executeAllTasks(opts) {
  opts = opts || {};
  const source = opts.source === 'auto' ? 'auto' : 'manual';
  const tabPolicy = opts.tabPolicy === 'close' ? 'close' : 'keep';

  const tasks = await loadTasks();
  const details = [];
  const openedTabs = [];
  let successCount = 0, failCount = 0;
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    sendProgress(i + 1, tasks.length, task.name);
    const result = await executeSingleTask(task);
    openedTabs.push({ id: result.tabId, success: !!result.success });
    details.push({ name: task.name, success: result.success, message: result.message });
    if (result.success) successCount++; else failCount++;
    if (i < tasks.length - 1) await sleep(2000);
  }

  // 自动执行 + 策略为关闭：成功的标签页关掉，失败的保留（失败往往要看一眼，多半是登录态过期）
  if (source === 'auto' && tabPolicy === 'close') {
    for (const t of openedTabs) {
      if (t.success && t.id) {
        try { await chrome.tabs.remove(t.id); } catch (e) { /* 标签页可能已被用户关闭 */ }
      }
    }
  }

  // 记录执行状态：手动与自动都写，供"当天设定时间后是否已执行"判定
  try {
    await ScheduleStorage.setScheduleState({
      lastRunAt: Date.now(),
      source: source,
      total: successCount + failCount,
      success: successCount,
      failedNames: details.filter(d => !d.success).map(d => d.name)
    });
  } catch (e) { console.error('save schedule state failed:', e); }

  if (source === 'auto') sendAutoNotification(successCount, failCount, details);
  else sendNotification(successCount, failCount);

  return { success: successCount, fail: failCount, details };
}

// ===== 定时自动签到 =====
const SCHEDULE_ALARM = 'daily_checkin';
const CATCHUP_DELAY_MS = 75000;  // 启动补跑延迟：60–90 秒之间

function minutesOfTimeStr(t) {
  const p = String(t).split(':');
  return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
}

/** 重建闹钟：开关关闭时清除，开启时按配置时间注册 24 小时周期 */
async function rebuildAlarm() {
  try {
    await chrome.alarms.clear(SCHEDULE_ALARM);
    const cfg = await ScheduleStorage.getScheduleConfig();
    if (!cfg.enabled) return;
    chrome.alarms.create(SCHEDULE_ALARM, {
      when: ScheduleStorage.nextRunTimestamp(cfg.time),
      periodInMinutes: 1440
    });
  } catch (e) { console.error('rebuildAlarm failed:', e); }
}

/**
 * 判断是否该执行自动签到（前置检查，任一不满足即静默返回）。
 * @param {'alarm'|'startup'} source
 */
async function maybeRunAuto(source) {
  try {
    const cfg = await ScheduleStorage.getScheduleConfig();
    if (!cfg.enabled) return;

    // 启动补跑：仅在"今天已过设定时间"时才补；没到点交给 alarm
    if (source === 'startup') {
      const now = new Date();
      if (now.getHours() * 60 + now.getMinutes() < minutesOfTimeStr(cfg.time)) return;
    }

    const tasks = await loadTasks();
    if (tasks.length === 0) return;

    const state = await ScheduleStorage.getScheduleState();
    if (ScheduleStorage.alreadyRanAfterSchedule(state, cfg.time)) return;

    await CheckinI18n.init();
    await executeAllTasks({ source: 'auto', tabPolicy: cfg.tabPolicy });
  } catch (e) { console.error('auto run failed:', e); }
}

/** 自动执行的汇总通知：有失败时点名失败任务，避免静默失效 */
function sendAutoNotification(success, fail, details) {
  const failedNames = (details || []).filter(d => !d.success).map(d => d.name);
  const title = fail > 0 ? i18n('scheduleNotifFail') : i18n('scheduleNotifOk');
  let message = i18n('scheduleResult', [String(success), String(fail)]);
  if (fail > 0 && failedNames.length > 0) {
    message = message + ' · ' + i18n('scheduleFailedNames', [failedNames.join('、')]);
  }
  chrome.notifications.create({
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon48.png'),
    title: title,
    message: message,
    priority: 2
  }, () => { if (chrome.runtime.lastError) return; });
}

// 到点触发
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== SCHEDULE_ALARM) return;
  maybeRunAuto('alarm');
});

// 浏览器启动补跑：延迟执行，避开开机瞬间会话未恢复 / 网络未就绪导致的全败
chrome.runtime.onStartup.addListener(() => {
  setTimeout(() => { maybeRunAuto('startup'); }, CATCHUP_DELAY_MS);
});

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
    // 手动执行：不受"当天是否已执行"限制，用户随时有权手动跑
    CheckinI18n.init().then(() => executeAllTasks({ source: 'manual' })).then(result => sendResponse(result))
      .catch(err => sendResponse({ success: 0, fail: 0, details: [], error: i18n('msgExecFailed', [err.message || i18n('msgUnknownError')]) }));
    return true;
  }
  if (message.action === 'rebuildAlarm') {
    rebuildAlarm().then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
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

  // 注册/重建定时闹钟。
  // 注意：此处不立即补跑——刚安装或刚更新就自动开一堆标签页体验很差，
  // 首次执行交给下一次到点或后续浏览器启动补跑。
  rebuildAlarm();
});
