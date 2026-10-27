/**
 * Copyright (c) 2026 qin_rui (https://github.com/qinruimac)
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 签到助手 - 自动点击执行
 * 接收 autoClick 消息后，在页面上找到指定元素并模拟点击
 */

// 防止重复初始化
if (!window.__checkinAutoClickInitialized) {
  window.__checkinAutoClickInitialized = true;

  // ===== i18n（共享模块 CheckinI18n，见 i18n.js）=====
  const i18n = (key, subs) => CheckinI18n.getMsg(key, subs);

  // ===== 模拟点击 =====

  /**
   * 模拟真实用户点击（派发完整鼠标事件序列）
   * @param {Element} element - 要点击的元素
   */
  function simulateClick(element) {
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

    // 派发完整的鼠标事件序列：mousedown → mouseup → click
    element.dispatchEvent(new MouseEvent('mousedown', eventOptions));
    element.dispatchEvent(new MouseEvent('mouseup', eventOptions));
    element.dispatchEvent(new MouseEvent('click', eventOptions));

    // 同时调用原生 click() 作为兜底
    if (typeof element.click === 'function') {
      try {
        element.click();
      } catch (e) {
        // 忽略错误
      }
    }
  }

  // ===== 执行自动点击 =====

  /**
   * 查找元素并执行点击
   * @param {string} selector - CSS选择器
   * @returns {Object} 执行结果 { success: boolean, message: string }
   */
  function performAutoClick(selector) {
    if (!selector) {
      return { success: false, message: i18n('msgNoSelector') };
    }

    // 尝试查找元素
    let element = null;
    try {
      element = document.querySelector(selector);
    } catch (e) {
      return { success: false, message: i18n('msgInvalidSelector') };
    }

    if (!element) {
      return { success: false, message: i18n('msgElementNotFound') };
    }

    // 检查元素是否可见可点击
    let rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      // 元素不可见，先滚动到可见位置；仍不可见则明确报错，不做无意义点击
      element.scrollIntoView({ behavior: 'instant', block: 'center' });
      rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        return { success: false, message: i18n('msgElementHidden') };
      }
    }

    // 执行模拟点击
    try {
      simulateClick(element);
      return { success: true, message: i18n('msgClickSuccess') };
    } catch (e) {
      return { success: false, message: i18n('msgClickFailed', [e.message]) };
    }
  }

  /**
   * 等待元素出现的重试机制
   * @param {string} selector - CSS选择器
   * @param {number} maxRetries - 最大重试次数
   * @param {number} interval - 重试间隔（毫秒）
   */
  function waitForElement(selector, maxRetries = 10, interval = 500) {
    return new Promise((resolve) => {
      let retries = 0;

      function check() {
        try {
          const element = document.querySelector(selector);
          if (element) {
            resolve(element);
            return;
          }
        } catch (e) {
          // 选择器无效
          resolve(null);
          return;
        }

        retries++;
        if (retries >= maxRetries) {
          resolve(null);
        } else {
          setTimeout(check, interval);
        }
      }

      check();
    });
  }

  /**
   * 等待 DOM 加载完成后执行自动点击
   * @param {string} selector - CSS选择器
   * @returns {Promise<Object>} 执行结果
   */
  async function executeAutoClick(selector) {
    // 等待 DOM 加载完成
    if (document.readyState === 'loading') {
      await new Promise((resolve) => {
        document.addEventListener('DOMContentLoaded', resolve, { once: true });
      });
    }

    // 等待元素出现（带重试）
    const element = await waitForElement(selector, 10, 500);

    if (!element) {
      return { success: false, message: i18n('msgWaitTimeout') };
    }

    // 滚动到元素位置
    element.scrollIntoView({ behavior: 'instant', block: 'center' });

    // 稍作等待后执行点击
    await new Promise(resolve => setTimeout(resolve, 300));

    return performAutoClick(selector);
  }

  // ===== 消息监听 =====

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'autoClick') {
      const selector = message.selector;
      CheckinI18n.init().then(() => executeAutoClick(selector)).then(result => {
        sendResponse(result);
      });
      return true; // 保持消息通道开放，等待异步响应
    }
    return true;
  });
}
