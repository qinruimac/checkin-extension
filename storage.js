/**
 * 签到助手 - 统一存储抽象层 (TaskStorage)
 *
 * 设计要点：
 *  - 主存储 chrome.storage.sync：跟随浏览器账号（Edge=微软, Chrome=谷歌），免自建后端
 *  - 按任务拆 key（task_<id>），单条 < 8KB 限额；索引 key task_index 存 ID 列表
 *  - 旧用户兼容：local 里 checkin_tasks 仍可读（迁移期双读回退），不主动删
 *  - 90KB 预算阈值（sync 上限 102,400 字节），超限回退 local 并抛 quotaExceeded
 *
 * 在 popup / service worker / content script 三处均可用（均通过 chrome.storage.sync）。
 */

(function (global) {
  'use strict';

  var LEGACY_KEY = 'checkin_tasks';   // 旧版单 key 整数组
  var INDEX_KEY = 'task_index';       // sync 里的任务 ID 索引
  var PREFIX = 'task_';               // 单任务 key 前缀
  var BUDGET = 90 * 1024;             // 90KB 预算（sync 总上限 102,400B）

  // ===== 底层读写 =====

  function syncGet(keys) {
    return new Promise(function (resolve) {
      chrome.storage.sync.get(keys, function (r) {
        resolve(r || {});
      });
    });
  }
  function syncSet(obj) {
    return new Promise(function (resolve, reject) {
      chrome.storage.sync.set(obj, function () {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else { resolve(); }
      });
    });
  }
  function syncRemove(keys) {
    return new Promise(function (resolve) {
      chrome.storage.sync.remove(keys, function () { resolve(); });
    });
  }
  function localGet(keys) {
    return new Promise(function (resolve) {
      chrome.storage.local.get(keys, function (r) { resolve(r || {}); });
    });
  }

  // ===== 索引管理 =====

  async function getIndex() {
    var r = await syncGet([INDEX_KEY]);
    return Array.isArray(r[INDEX_KEY]) ? r[INDEX_KEY] : [];
  }

  // ===== 公开 API =====

  /**
   * 读取全部任务。
   * 优先读 sync 拆 key；若 sync 为空则回退 local 旧 key（迁移安全）。
   * @returns {Promise<Array>} 任务数组
   */
  async function getTasks() {
    var ids = await getIndex();
    if (ids.length > 0) {
      var keys = ids.map(function (id) { return PREFIX + id; });
      var r = await syncGet(keys);
      var tasks = [];
      for (var i = 0; i < ids.length; i++) {
        var t = r[PREFIX + ids[i]];
        if (t) tasks.push(t);
      }
      return tasks;
    }
    // sync 为空 → 回退 local 旧 key
    var local = await localGet([LEGACY_KEY]);
    return Array.isArray(local[LEGACY_KEY]) ? local[LEGACY_KEY] : [];
  }

  /**
   * 写入/更新单个任务（拆 key）。
   * @returns {Promise<void>}
   * @throws {Error} message='quotaExceeded' 超过 90KB 预算
   */
  async function setTask(task) {
    if (!task || !task.id) throw new Error('task.id required');
    var ids = await getIndex();
    if (ids.indexOf(task.id) === -1) ids.push(task.id);

    // 预算检查：估算写入后总字节
    var est = await getByteSize();
    var itemBytes = new Blob([JSON.stringify(task)]).size + PREFIX.length + 16;
    if (est + itemBytes > BUDGET) {
      throw new Error('quotaExceeded');
    }

    var obj = {};
    obj[PREFIX + task.id] = task;
    obj[INDEX_KEY] = ids;
    await syncSet(obj);
  }

  /**
   * 删除单个任务。
   */
  async function deleteTask(id) {
    var ids = await getIndex();
    ids = ids.filter(function (x) { return x !== id; });
    await syncRemove([PREFIX + id]);
    await syncSet({ task_index: ids });
  }

  /**
   * 清空所有任务（sync 拆 key + 索引）。
   */
  async function clearAll() {
    var ids = await getIndex();
    var keys = ids.map(function (id) { return PREFIX + id; });
    keys.push(INDEX_KEY);
    await syncRemove(keys);
  }

  /**
   * 估算 sync 中任务数据占用的字节数。
   * chrome.storage.sync 不会直接给 byteUsage，这里用 JSON 长度估算。
   */
  async function getByteSize() {
    var ids = await getIndex();
    if (ids.length === 0) return 0;
    var keys = ids.map(function (id) { return PREFIX + id; });
    keys.push(INDEX_KEY);
    var r = await syncGet(keys);
    var total = 0;
    for (var k in r) {
      if (Object.prototype.hasOwnProperty.call(r, k)) {
        total += k.length + new Blob([JSON.stringify(r[k])]).size + 8;
      }
    }
    return total;
  }

  /**
   * 按 ID 合并导入任务（用于导入功能）。
   * 已存在同 ID 则覆盖，否则新增。
   * @returns {Promise<{added:number, updated:number, skipped:number}>}
   */
  async function mergeById(incoming) {
    var existing = await getTasks();
    var map = {};
    existing.forEach(function (t) { map[t.id] = t; });
    var added = 0, updated = 0, skipped = 0;
    for (var i = 0; i < incoming.length; i++) {
      var t = incoming[i];
      if (!t || !t.id) { skipped++; continue; }
      if (map[t.id]) { updated++; } else { added++; }
      map[t.id] = t;
    }
    // 批量写入
    var ids = Object.keys(map);
    var obj = {};
    obj[INDEX_KEY] = ids;
    ids.forEach(function (id) { obj[PREFIX + id] = map[id]; });
    // 预算检查
    var est = 0;
    for (var k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) {
        est += k.length + new Blob([JSON.stringify(obj[k])]).size + 8;
      }
    }
    if (est > BUDGET) throw new Error('quotaExceeded');
    await syncSet(obj);
    return { added: added, updated: updated, skipped: skipped };
  }

  /**
   * 监听存储变化（封装 chrome.storage.onChanged）。
   * @param {Function} cb 回调，参数为最新任务数组
   * @returns {Function} 取消监听函数
   */
  function onChanged(cb) {
    var handler = function (changes, area) {
      if (area !== 'sync' && area !== 'local') return;
      // 只在任务相关 key 变化时触发
      var relevant = false;
      for (var k in changes) {
        if (k === INDEX_KEY || k === LEGACY_KEY || k.indexOf(PREFIX) === 0) {
          relevant = true; break;
        }
      }
      if (relevant) getTasks().then(cb);
    };
    chrome.storage.onChanged.addListener(handler);
    return function () { chrome.storage.onChanged.removeListener(handler); };
  }

  /**
   * 一次性迁移：把 local 旧 key 整数组拆成 sync 单 key。
   * 仅在 sync 为空、local 有数据时执行（幂等）。
   * @returns {Promise<{migrated:number}>} 迁移了几个任务
   */
  async function migrateFromLocal() {
    var ids = await getIndex();
    if (ids.length > 0) return { migrated: 0 }; // sync 已有数据，不迁移

    var local = await localGet([LEGACY_KEY]);
    var legacy = local[LEGACY_KEY];
    if (!Array.isArray(legacy) || legacy.length === 0) return { migrated: 0 };

    // 拆 key 写入 sync
    var obj = {};
    var newIds = [];
    legacy.forEach(function (t) {
      if (t && t.id) {
        obj[PREFIX + t.id] = t;
        newIds.push(t.id);
      }
    });
    obj[INDEX_KEY] = newIds;

    // 预算检查
    var est = 0;
    for (var k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) {
        est += k.length + new Blob([JSON.stringify(obj[k])]).size + 8;
      }
    }
    if (est > BUDGET) {
      // 超限：保留 local 不动，让用户自行处理
      return { migrated: 0, overQuota: true };
    }

    await syncSet(obj);
    // 不删 local，保留作为安全副本（用户可手动清除）
    return { migrated: newIds.length };
  }

  global.TaskStorage = {
    getTasks: getTasks,
    setTask: setTask,
    deleteTask: deleteTask,
    clearAll: clearAll,
    getByteSize: getByteSize,
    mergeById: mergeById,
    onChanged: onChanged,
    migrateFromLocal: migrateFromLocal,
    BUDGET: BUDGET
  };
})(typeof self !== 'undefined' ? self : this);
