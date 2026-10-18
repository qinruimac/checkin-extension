/**
 * 签到助手 - 同步状态检测 (SyncStatus)
 *
 * 三态判定（中性色，不报警）：
 *  - synced            ：已登录 + sync 已有数据 → 云端同步中
 *  - logged_in_pending ：已登录但 sync 无数据（本地数据待上传 / 首次同步前）
 *  - not_logged_in     ：未登录浏览器账号 → 仅本地，可手动导出导入
 *
 * 依赖 chrome.identity.getProfileUserInfo（需 manifest 声明 "identity" 权限）。
 * 仅在 popup / service worker 中加载（content script 无 chrome.identity）。
 */

(function (global) {
  'use strict';

  var OBSERVED_KEY = 'sync_observed'; // local 标记：sync 是否已被观测到有数据

  /**
   * 获取登录账号邮箱（可能为空）。
   * getProfileUserInfo 在未登录时返回空 email。
   */
  function getLoginEmail() {
    return new Promise(function (resolve) {
      if (!chrome.identity || typeof chrome.identity.getProfileUserInfo !== 'function') {
        resolve(null);
        return;
      }
      try {
        chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' }, function (info) {
          if (chrome.runtime.lastError) { resolve(null); return; }
          resolve((info && info.email) || null);
        });
      } catch (e) { resolve(null); }
    });
  }

  /**
   * sync 中是否已有任务数据。
   */
  function hasSyncData() {
    return new Promise(function (resolve) {
      chrome.storage.sync.get(null, function (items) {
        if (chrome.runtime.lastError) { resolve(false); return; }
        // 有 task_index 或任意 task_ 前缀 key 即视为有数据
        var has = items && items.task_index && items.task_index.length > 0;
        if (!has && items) {
          for (var k in items) {
            if (Object.prototype.hasOwnProperty.call(items, k) && k.indexOf('task_') === 0) {
              has = true; break;
            }
          }
        }
        resolve(!!has);
      });
    });
  }

  /**
   * 标记 sync 已被观测到（用于区分"首次同步前"状态）。
   */
  function markObserved() {
    return new Promise(function (resolve) {
      chrome.storage.local.set({ sync_observed: true }, function () { resolve(); });
    });
  }

  /**
   * 获取当前同步状态。
   * @returns {Promise<{state:string, email:string|null}>}
   *   state ∈ 'synced' | 'logged_in_pending' | 'not_logged_in'
   */
  async function getState() {
    var email = await getLoginEmail();
    if (!email) {
      return { state: 'not_logged_in', email: null };
    }
    var synced = await hasSyncData();
    if (synced) {
      await markObserved();
      return { state: 'synced', email: email };
    }
    return { state: 'logged_in_pending', email: email };
  }

  global.SyncStatus = {
    getState: getState,
    getLoginEmail: getLoginEmail,
    hasSyncData: hasSyncData
  };
})(typeof self !== 'undefined' ? self : this);
