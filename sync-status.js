/**
 * 签到助手 - 同步状态检测 (SyncStatus)
 *
 * 不依赖 chrome.identity（Edge 登录微软账户时 getProfileUserInfo 返回空，
 * 无法可靠检测登录状态）。改为根据数据所在位置判断：
 *
 *  - synced  ：sync 里有任务数据 → 已保存到同步存储
 *  - pending ：sync 空，local 有旧数据 → 待迁移
 *  - empty   ：两边都没数据 → 暂无任务
 */

(function (global) {
  'use strict';

  /**
   * sync 中是否已有任务数据。
   */
  function hasSyncData() {
    return new Promise(function (resolve) {
      chrome.storage.sync.get(null, function (items) {
        if (chrome.runtime.lastError) { resolve(false); return; }
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
   * local 中是否有旧版任务数据（迁移前）。
   */
  function hasLocalData() {
    return new Promise(function (resolve) {
      chrome.storage.local.get('tasks', function (items) {
        if (chrome.runtime.lastError) { resolve(false); return; }
        var has = items && items.tasks && Array.isArray(items.tasks) && items.tasks.length > 0;
        resolve(!!has);
      });
    });
  }

  /**
   * 获取当前同步状态（纯数据判定，不依赖登录 API）。
   * @returns {Promise<{state:string}>}
   *   state ∈ 'synced' | 'pending' | 'empty'
   */
  async function getState() {
    var synced = await hasSyncData();
    if (synced) return { state: 'synced' };

    var local = await hasLocalData();
    if (local) return { state: 'pending' };

    return { state: 'empty' };
  }

  global.SyncStatus = {
    getState: getState,
    hasSyncData: hasSyncData,
    hasLocalData: hasLocalData
  };
})(typeof self !== 'undefined' ? self : this);
