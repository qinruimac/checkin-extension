# 签到助手 (checkin-extension)

不只是打开网页——选取页面上的签到按钮，自动模拟点击完成签到。支持元素选取、手工添加、批量执行，一键搞定所有签到任务。

基于 Manifest V3 开发，同时兼容 **Edge** 和 **Chrome** 浏览器。支持 10 种语言界面切换。

- 官方站点（产品介绍，10 种语言）：https://erui.org/checkin/
- 在线隐私政策（10 种语言）：https://erui.org/checkin/privacy.html

## 功能特性

### 1. 快速新增签到任务（元素选择器模式）
- 在需要签到的网页上，点击扩展弹窗中的"选取签到按钮"
- 页面进入选择模式：鼠标悬浮高亮元素（红色边框），点击选中
- 选中后弹出确认浮层，可编辑任务名称，确认后保存
- 自动生成稳定的 CSS 选择器（优先使用 id，其次 class+tag，最后 nth-of-type）
- 按 `ESC` 键可取消选择模式

### 2. 手工添加任务
- 在弹窗中展开"手工添加"表单
- 填写任务名称、URL、选择任务类型（"点击签到"或"仅打开网页"）
- "点击签到"类型可填写 CSS 选择器（留空则仅打开网页）

### 3. 执行所有签到任务
- 点击"执行所有签到"按钮，显示 10 秒倒计时
- 倒计时期间可点击"取消执行"中止
- 倒计时结束后依次执行每个任务：
  - 在后台新标签页打开任务 URL（不打扰当前浏览）
  - "click" 类型且有 selector 时，自动点击对应元素
  - 每个任务之间间隔 2 秒
- 执行完成后显示结果汇总（成功/失败数及详情）
- 发送桌面通知提醒

### 4. 定时自动签到（默认开启）

- 默认**每天 08:00** 自动执行全部签到任务，可在弹窗里关闭或改时间
- 到点时若浏览器没运行，**下次启动浏览器后会补跑当天**（启动后延迟约 75 秒，避开开机瞬间网络未就绪导致的全败）
- 手动执行不受限制：就算当天已经执行过，你依然可以随时手动再跑一次
- 手动执行只有在**设定时间之后**发生，才计入「当天已执行」；设定时间之前手动跑过，到点仍会自动执行
- 自动签到后标签页可选「关闭」（默认；失败的任务会保留，方便查看）或「保留」
- 定时配置与执行记录只存在本设备的浏览器本地，**不跟随账号同步**；多设备各自独立执行

### 5. 任务列表管理
- 弹窗主区域显示所有签到任务
- 每个任务显示：网站图标（favicon，加载失败自动回退）、名称、URL（截断）、类型图标（🎯点击 / 🔗打开）
- 支持删除单个任务
- 任务列表分页显示（每页 10 条），支持翻页
- 任务列表通过 `chrome.storage.sync` 跟随浏览器账号同步：登录 Edge（微软账号）/ Chrome（谷歌账号）后多设备自动同步；未登录则仅存储在本地
- 从旧版本（v1.0.x）升级时自动迁移本地数据，无需手动操作

### 6. 导入 / 导出（备份与跨设备搬运）
- 点击弹窗右上角 ⋯ 按钮展开面板
- **导出**：将全部任务保存为 JSON 文件，用于备份
- **导入**：选择 JSON 文件按任务 ID 合并导入（同 ID 覆盖，新 ID 新增）
- 存储接近容量上限时会提示超限，可导出备份后精简任务

### 7. 多语言支持（i18n）
- 支持 10 种语言：英语、简体中文、繁体中文、日语、韩语、法语、德语、俄语、西班牙语、葡萄牙语
- 自动检测浏览器语言，也支持手动切换
- 弹窗右上角有语言下拉菜单，可随时切换界面语言
- 语言偏好保存在本地，重启浏览器后保持
- 所有界面文本、提示信息、通知内容均支持多语言

## 文件结构

```
checkin-extension/
├── manifest.json              # 扩展配置（Manifest V3）
├── i18n.js                    # 共享 i18n 模块（CheckinI18n，手动语言切换）
├── storage.js                 # 统一存储抽象层（TaskStorage：sync 拆 key + 旧数据迁移；ScheduleStorage：定时配置与执行状态）
├── _locales/                  # 多语言资源（10 种语言）
│   ├── en/messages.json       # 英语
│   ├── zh_CN/messages.json    # 简体中文
│   ├── zh_TW/messages.json    # 繁体中文
│   ├── ja/messages.json       # 日语
│   ├── ko/messages.json       # 韩语
│   ├── fr/messages.json       # 法语
│   ├── de/messages.json       # 德语
│   ├── ru/messages.json       # 俄语
│   ├── es/messages.json       # 西班牙语
│   └── pt/messages.json       # 葡萄牙语
├── popup/
│   ├── popup.html             # 弹窗页面
│   ├── popup.css              # 弹窗样式
│   └── popup.js               # 弹窗逻辑
├── content/
│   ├── selector.js            # 元素选择器模式
│   └── auto-click.js          # 自动点击执行
├── background/
│   └── service-worker.js      # 后台服务工作者（批量执行 + 桌面通知）
├── icons/
│   ├── icon16.png             # 16x16 图标
│   ├── icon48.png             # 48x48 图标
│   └── icon128.png            # 128x128 图标
├── PRIVACY.md                 # 隐私政策
├── CHANGELOG.md               # 更新日志
└── README.md                  # 说明文档
```

## 安装方法

### 开发者模式加载（Edge / Chrome 通用）

1. 打开浏览器的扩展管理页：
   - **Edge**：地址栏输入 `edge://extensions/`
   - **Chrome**：地址栏输入 `chrome://extensions/`
2. 打开"开发者模式"开关
3. 点击"加载已解压的扩展"按钮
4. 选择本项目的 `checkin-extension` 文件夹
5. 扩展安装完成，工具栏会出现签到助手图标

### 从商店安装

- **Edge Add-ons**：https://microsoftedge.microsoft.com/addons/detail/jfoiljgknpbcddkpfpaglcoeeflgpiha
- **Chrome Web Store**：https://chromewebstore.google.com/detail/gdgdjllgdagmhkdmomcikgpocabfnmai

## 使用方法

### 方式一：选取签到按钮（推荐）

1. 打开需要签到的网页
2. 点击工具栏中的签到助手图标
3. 点击"选取签到按钮"
4. 在页面上将鼠标移到签到按钮上（会显示红色高亮）
5. 点击该按钮，弹出确认浮层
6. 编辑任务名称（默认使用元素文本），点击"确认保存"

### 方式二：手工添加

1. 点击工具栏中的签到助手图标
2. 点击"手工添加"展开表单
3. 填写任务名称、页面 URL
4. 选择任务类型：
   - "点击签到"：还需填写 CSS 选择器（可留空）
   - "仅打开网页"：只需打开页面即可
5. 点击"保存任务"

### 执行签到

1. 点击工具栏中的签到助手图标
2. 点击"执行所有签到"
3. 等待 10 秒倒计时（可取消）
4. 倒计时结束后自动执行所有任务
5. 查看执行结果汇总

### 导入 / 导出任务

1. 点击工具栏中的签到助手图标
2. 点击弹窗右上角 ⋯ 按钮展开面板
3. 导出：点击"导出"，自动下载 JSON 备份文件
4. 导入：点击"导入"，选择此前导出的 JSON 文件（按任务 ID 合并）

### 切换语言

1. 点击工具栏中的签到助手图标
2. 在弹窗右上角找到语言下拉菜单
3. 选择所需语言，界面立即切换
4. 选择"自动"则跟随浏览器语言设置

## 技术说明

- **Manifest V3**：使用最新的扩展开发规范，不使用已废弃的 API
- **跨浏览器兼容**：仅使用 `chrome.*` 标准 API，Edge 和 Chrome 均原生支持，无需任何适配代码
- **chrome.storage.sync**：任务列表跟随浏览器账号同步存储。按任务拆 key 以适配单条 8KB 限额，设 90KB 预算阈值，超限提示并引导导出精简；语言偏好等本地设置存 `chrome.storage.local`
- **chrome.scripting.executeScript**：动态注入 content script 执行点击；内容脚本未注入的页面（如扩展安装/更新前已打开）会自动补齐注入
- **chrome.notifications**：执行完成后发送桌面通知
- **CSS 选择器生成算法**：从目标元素向上遍历 DOM 树，优先使用 id，其次使用 class+tag 组合，最后使用 nth-of-type 路径，确保选择器稳定且唯一
- **模拟点击**：派发完整的鼠标事件序列（mousedown → mouseup → click），同时调用原生 click() 作为兜底
- **i18n 实现**：Chrome/Edge 原生 `_locales/` 机制 + 共享 `i18n.js`（`CheckinI18n`）实现手动语言切换层。popup、content script、service worker 三处共用同一实现，通过 `chrome.storage.local` 持久化语言偏好，content script 通过 `web_accessible_resources` 声明访问 `_locales/` 资源

## 权限说明

| 权限 | 用途 |
|------|------|
| activeTab | 访问当前标签页进行元素选取 |
| storage | 持久化存储任务列表和语言偏好 |
| tabs | 创建和管理标签页 |
| scripting | 动态注入 content script |
| notifications | 发送桌面通知 |
| alarms | 定时自动签到（浏览器本地闹钟触发，不联网） |
| host_permissions: `<all_urls>` | 在任意网页上执行签到操作 |
| web_accessible_resources: `_locales/*` | content script 加载多语言资源文件 |

## 注意事项

- 部分网站可能有反自动化检测，自动点击可能不生效
- CSS 选择器基于添加时的页面结构生成，如果网站改版可能需要重新选取
- 执行任务时标签页在后台打开，不会切换当前标签页；任务完成后标签页保留打开，确认无误后可手动关闭或直接关闭浏览器
- 扩展安装或更新后，此前已经打开的页面需要刷新后才能使用元素选取功能（执行签到不受影响，未及时刷新时会提示）
- 建议在添加任务前先手动签到一次，确认签到按钮的位置和选择器

## 隐私政策

- 在线版（10 种语言，随浏览器语言自动识别）：https://erui.org/checkin/privacy.html
- 本仓库文本：详见 [PRIVACY.md](PRIVACY.md)

任务列表通过浏览器内置的 `chrome.storage.sync` 跟随浏览器账号同步，本扩展不自建后端、不收集任何个人数据；未登录浏览器账号时，数据仅存储在本地浏览器中。

## 反馈与贡献

代码完全开源，欢迎提 Issue 和 PR：
[https://github.com/qinruimac/checkin-extension](https://github.com/qinruimac/checkin-extension)

## 开源许可

Copyright (c) 2026 qin_rui (https://github.com/qinruimac)

本项目基于 **GPL-3.0-or-later** 协议开源，许可证全文见 [LICENSE](LICENSE)（[GNU GPL v3 官方文本](https://www.gnu.org/licenses/gpl-3.0.txt)）。

简单说：你可以在此基础上修改、加工，甚至商用，但必须：

- 保留原作者署名与本项目的版权声明（各源码文件头部均已标注 `Copyright (c) 2026 qin_rui` 与 SPDX 标识）
- 衍生作品同样以 GPL-3.0 协议开源发布
- 注明修改内容及原项目出处：https://github.com/qinruimac/checkin-extension

若你希望允许衍生作品闭源发布、仅要求保留署名，可改用 Apache-2.0 或 MIT 协议，替换 LICENSE 文件与各源文件头部标识即可。
