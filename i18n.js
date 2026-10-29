/**
 * Copyright (c) 2026 qin_rui (https://github.com/qinruimac)
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 签到助手 - 共享 i18n 模块
 *
 * 设计要点：
 *  - 默认语言走 chrome.i18n（manifest default_locale + 浏览器语言）
 *  - 手动切换：读取 chrome.storage.local 的 user_language，非 auto 时
 *    fetch 对应 _locales/<lang>/messages.json 作为覆盖层
 *  - 未覆盖的 key 自动回退 chrome.i18n.getMessage
 *  - 三种环境共用：popup（<script>）、service worker（importScripts）、
 *    content script（manifest content_scripts），均挂载到全局 CheckinI18n
 */
(function (global) {
  'use strict';

  var customMsgs = null;
  var currentLang = null;

  /**
   * 初始化/刷新语言覆盖层。
   * @param {string} [lang] 指定语言；缺省时从 storage 读取 user_language
   */
  async function init(lang) {
    if (typeof lang !== 'string') {
      try {
        var r = await chrome.storage.local.get('user_language');
        lang = r.user_language;
      } catch (e) { lang = null; }
    }
    currentLang = (lang && lang !== 'auto') ? lang : null;
    if (!lang || lang === 'auto') { customMsgs = null; return; }
    try {
      var res = await fetch(chrome.runtime.getURL('_locales/' + lang + '/messages.json'));
      customMsgs = await res.json();
    } catch (e) { customMsgs = null; }
  }

  /**
   * 获取消息文本（与 chrome.i18n.getMessage 签名一致）。
   * @param {string} key
   * @param {string|string[]} [subs]
   * @returns {string}
   */
  function getMsg(key, subs) {
    if (!customMsgs || !customMsgs[key]) return chrome.i18n.getMessage(key, subs);
    var entry = customMsgs[key];
    var msg = entry.message || '';
    if (entry.placeholders && subs) {
      var arr = Array.isArray(subs) ? subs : [subs];
      var names = Object.keys(entry.placeholders);
      for (var i = 0; i < names.length; i++) {
        var name = names[i];
        var info = entry.placeholders[name];
        var idx = parseInt(String(info.content).replace(/\$/g, ''), 10) - 1;
        msg = msg.replace(new RegExp('\\$' + name + '\\$', 'g'), arr[idx] || '');
      }
    }
    return msg;
  }

  /**
   * 当前生效语言（BCP 47 tag，供 Intl 日期等格式化用）。
   * 手动切换时为切换值；auto/未初始化时回退浏览器 UI 语言。
   */
  function getLang() {
    var l = currentLang;
    if (!l && typeof chrome !== 'undefined' && chrome.i18n && chrome.i18n.getUILanguage) {
      try { l = chrome.i18n.getUILanguage(); } catch (e) { /* 忽略 */ }
    }
    return String(l || 'en').replace('_', '-');
  }

  global.CheckinI18n = { init: init, getMsg: getMsg, getLang: getLang };
})(typeof self !== 'undefined' ? self : this);
