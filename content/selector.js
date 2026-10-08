/**
 * 网页签到助手 - 元素选择器
 * 在页面上进入选择模式，用户鼠标悬浮高亮元素，点击选中后生成 CSS 选择器
 * 选中后显示确认浮层，用户可编辑任务名称并确认保存
 */

// 防止重复初始化
if (!window.__checkinSelectorInitialized) {
  window.__checkinSelectorInitialized = true;

  const STORAGE_KEY = 'checkin_tasks';

  // 选择模式状态
  let selectorMode = false;
  let highlightedElement = null;
  let originalOutline = null;

  // ===== CSS 选择器生成 =====

  /**
   * 为元素生成唯一且稳定的 CSS 选择器
   * 策略：优先使用 id，其次使用 class+tag，最后使用 nth-of-type 路径
   */
  function generateSelector(element) {
    if (element.id) {
      return '#' + cssEscape(element.id);
    }

    const parts = [];
    let current = element;

    while (current && current !== document.body && current !== document.documentElement) {
      let selector = current.tagName.toLowerCase();

      // 优先使用 id
      if (current.id) {
        parts.unshift('#' + cssEscape(current.id));
        break;
      }

      // 使用 class + tag（如果有 class）
      if (current.className && typeof current.className === 'string') {
        const classes = current.className.trim().split(/\s+/).filter(c => c && !c.startsWith('__checkin'));
        if (classes.length > 0) {
          // 最多使用2个class，避免选择器过长
          selector += '.' + classes.slice(0, 2).map(cssEscape).join('.');
        }
      }

      // 计算 nth-of-type
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(s => s.tagName === current.tagName);
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += `:nth-of-type(${index})`;
        }
      }

      parts.unshift(selector);
      current = current.parentElement;
    }

    return parts.join(' > ');
  }

  /** CSS 转义处理 */
  function cssEscape(str) {
    return str.replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c);
  }

  // ===== 选择模式交互 =====

  /** 进入选择模式 */
  function enterSelectorMode() {
    if (selectorMode) return;
    selectorMode = true;

    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('mouseout', onMouseOut, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);

    // 显示提示条
    showHintBar();
  }

  /** 退出选择模式 */
  function exitSelectorMode() {
    if (!selectorMode) return;
    selectorMode = false;

    document.removeEventListener('mouseover', onMouseOver, true);
    document.removeEventListener('mouseout', onMouseOut, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);

    // 移除高亮
    if (highlightedElement) {
      highlightedElement.style.outline = originalOutline || '';
      highlightedElement = null;
      originalOutline = null;
    }

    // 移除提示条
    hideHintBar();
  }

  /** 鼠标悬浮高亮元素 */
  function onMouseOver(e) {
    if (!selectorMode) return;
    // 排除选择器自身的UI元素
    if (isCheckinElement(e.target)) return;

    if (highlightedElement && highlightedElement !== e.target) {
      highlightedElement.style.outline = originalOutline || '';
    }

    highlightedElement = e.target;
    originalOutline = e.target.style.outline;
    e.target.style.outline = '2px solid red';
    e.target.style.outlineOffset = '-2px';
  }

  /** 鼠标移出移除高亮 */
  function onMouseOut(e) {
    if (!selectorMode) return;
    if (isCheckinElement(e.target)) return;

    if (highlightedElement) {
      highlightedElement.style.outline = originalOutline || '';
      highlightedElement = null;
      originalOutline = null;
    }
  }

  /** 点击选中元素 */
  function onClick(e) {
    if (!selectorMode) return;
    if (isCheckinElement(e.target)) return;

    // 阻止默认行为和冒泡
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const element = e.target;
    const selector = generateSelector(element);

    // 退出选择模式
    exitSelectorMode();

    // 显示确认浮层
    showConfirmDialog(element, selector);
  }

  /** ESC 键取消 */
  function onKeyDown(e) {
    if (!selectorMode) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      exitSelectorMode();
    }
  }

  /** 判断是否是签到扩展自身的UI元素 */
  function isCheckinElement(el) {
    if (!el) return false;
    return el.id && el.id.startsWith('__checkin') ||
           (el.className && typeof el.className === 'string' && el.className.startsWith('__checkin'));
  }

  // ===== 提示条 =====

  let hintBar = null;

  function showHintBar() {
    if (hintBar) return;
    hintBar = document.createElement('div');
    hintBar.id = '__checkinHintBar';
    hintBar.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
      background: #0d6efd; color: #fff; padding: 8px 16px;
      font-size: 14px; font-family: sans-serif; text-align: center;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    `;
    hintBar.innerHTML = '�� 请在页面上点击签到按钮 | 按 <strong>ESC</strong> 取消';
    document.body.appendChild(hintBar);
  }

  function hideHintBar() {
    if (hintBar) {
      hintBar.remove();
      hintBar = null;
    }
  }

  // ===== 确认浮层 =====

  /**
   * 显示确认浮层
   * @param {Element} element - 选中的元素
   * @param {string} selector - 生成的CSS选择器
   */
  function showConfirmDialog(element, selector) {
    // 移除已有浮层
    const existing = document.getElementById('__checkinConfirmDialog');
    if (existing) existing.remove();

    // 生成默认任务名称：优先用元素文本，其次用页面标题
    const elementText = (element.textContent || '').trim().substr(0, 20);
    const defaultName = elementText || document.title || '签到任务';

    // 创建遮罩
    const overlay = document.createElement('div');
    overlay.id = '__checkinConfirmDialog';
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      z-index: 2147483647; background: rgba(0,0,0,0.4);
      display: flex; align-items: center; justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
    `;

    // 创建对话框
    const dialog = document.createElement('div');
    dialog.style.cssText = `
      background: #fff; border-radius: 0.5rem; padding: 24px;
      width: 400px; max-width: 90vw; box-shadow: 0 8px 32px rgba(0,0,0,0.2);
    `;

    dialog.innerHTML = `
      <h2 style="margin:0 0 16px;font-size:18px;color:#212529;">✅ 已选中签到按钮</h2>
      <div style="margin-bottom:12px;">
        <div style="font-size:12px;color:#6c757d;margin-bottom:4px;">元素标签</div>
        <div style="font-size:13px;color:#212529;padding:8px;background:#f8f9fa;border-radius:0.375rem;word-break:break-all;">
          &lt;${element.tagName.toLowerCase()}&gt;
        </div>
      </div>
      <div style="margin-bottom:12px;">
        <div style="font-size:12px;color:#6c757d;margin-bottom:4px;">CSS 选择器</div>
        <div style="font-size:12px;color:#6c757d;padding:8px;background:#f8f9fa;border-radius:0.375rem;word-break:break-all;font-family:monospace;">
          ${escapeHtmlForDialog(selector)}
        </div>
      </div>
      <div style="margin-bottom:16px;">
        <label style="display:block;font-size:12px;color:#6c757d;margin-bottom:4px;">任务名称</label>
        <input type="text" id="__checkinTaskName" value="${escapeHtmlForDialog(defaultName)}"
          style="width:100%;padding:8px 10px;font-size:14px;border:1px solid #dee2e6;border-radius:0.375rem;box-sizing:border-box;"
          maxlength="50">
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button id="__checkinCancel" style="padding:8px 16px;font-size:14px;border:none;border-radius:0.375rem;background:#f8f9fa;color:#6c757d;cursor:pointer;">取消</button>
        <button id="__checkinConfirm" style="padding:8px 16px;font-size:14px;border:none;border-radius:0.375rem;background:#0d6efd;color:#fff;cursor:pointer;">确认保存</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // 获取元素引用
    const nameInput = document.getElementById('__checkinTaskName');
    const confirmBtn = document.getElementById('__checkinConfirm');
    const cancelBtn = document.getElementById('__checkinCancel');

    nameInput.focus();
    nameInput.select();

    // 确认按钮事件
    confirmBtn.addEventListener('click', () => {
      const taskName = nameInput.value.trim() || '签到任务';
      saveSelectorTask(taskName, selector);
      overlay.remove();
    });

    // 取消按钮事件
    cancelBtn.addEventListener('click', () => {
      overlay.remove();
    });

    // 回车确认
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        confirmBtn.click();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        overlay.remove();
      }
    });

    // 点击遮罩关闭（点击对话框外部）
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
      }
    });
  }

  /** HTML 转义（用于对话框内联HTML） */
  function escapeHtmlForDialog(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ===== 保存任务 =====

  /**
   * 保存选取的签到任务到 storage
   * @param {string} name - 任务名称
   * @param {string} selector - CSS选择器
   */
  function saveSelectorTask(name, selector) {
    const task = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      name: name,
      url: window.location.href,
      type: 'click',
      selector: selector,
      createdAt: Date.now()
    };

    // 读取现有任务列表
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      const tasks = result[STORAGE_KEY] || [];
      tasks.push(task);

      // 保存
      chrome.storage.local.set({ [STORAGE_KEY]: tasks }, () => {
        // 通知 popup 刷新（如果 popup 还开着）
        chrome.runtime.sendMessage({ action: 'selectorResult', task: task }, () => {
          // 忽略错误（popup 可能已关闭）
          if (chrome.runtime.lastError) return;
        });

        // 在页面上显示成功提示
        showSuccessToast('签到任务已保存：' + name);
      });
    });
  }

  /** 在页面上显示成功提示 */
  function showSuccessToast(message) {
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
      z-index: 2147483647; background: rgba(33,37,41,0.9); color: #fff;
      padding: 12px 24px; border-radius: 0.375rem; font-size: 14px;
      font-family: sans-serif; box-shadow: 0 4px 16px rgba(0,0,0,0.2);
      animation: __checkinToastIn 0.3s ease;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.transition = 'opacity 0.3s ease';
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }

  // ===== 消息监听 =====

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'startSelector') {
      enterSelectorMode();
      sendResponse({ success: true });
    }
    return true;
  });
}
