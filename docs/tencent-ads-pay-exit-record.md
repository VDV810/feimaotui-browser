# 腾讯广告支付页偶尔彻底退出浏览器 — 完整修复记录（交接文档）

> 写给下一个接手的 AI。截至 2026-09-02（v1.3.80），问题**仍未根治**：腾讯广告支付流程
> （充值页 → 支付成功页 → 点「返回」等操作）偶尔还是会把整个浏览器干退出。
> 下面是全部修复历史、现存防线、以及我核实出的**关键线索（防线丢失嫌疑）**。

---

## 一、现象

- 腾讯广告（ad.qq.com / e.qq.com）充值/支付成功页，点「返回」或页面自身脚本动作时，
  **偶尔**（不是必现）整个浏览器进程直接退出，而不是只关标签页/子窗口。
- 必现的版本已经修过三轮（v1.3.47/48/52），v1.3.53 又修了充值页 about:blank 联动问题。
- 现在是「偶尔」残余，说明主链路已断，剩下的是某条漏网路径。

## 二、真正的攻击链路（前三轮修复确认的根因）

```
腾讯充值成功页「返回」按钮调 window.close()
  → Electron 里 window.close 冒泡到宿主
    → 命中 BrowserView webContents close / 独立子窗口 close / 主窗口 close
      → 主窗口 'close' 无守卫 → app.quit() → 整个浏览器退出
```

要点：**页面 JS 调 window.close 是源头，主窗口 close 无条件退出是终局**。
preload 隔离世界覆盖 window.close 无效，必须主世界注入（v1.3.47 教训）。

## 三、修复历史（按时间，全部已进 main 分支）

### v1.3.47 — commit 9957184
- did-start-navigation 主世界注入 `window.close = function(){}`（屏蔽页面关闭调用）
- 主窗口 + view 的 `will-prevent-unload` 处理，避免页面 onbeforeunload 把「返回」卡死
- preload 收紧 close-btn-fix 选择器（删掉过宽的 `#splitview i/svg`）
- **遗留**：注入依赖导航时机，页面不重新导航就不生效 → 引出 v1.3.48

### v1.3.48 — commit 3567ab2（结果层多重保险）
- 每个 tab 的 `webContents.on('close')` → `event.preventDefault()`，阻止页面关标签页
- `mainWindow.on('close')` 加 isQuitting 守卫：非用户主动退出（托盘/菜单才置 true）
  一律 `preventDefault`，浏览器保持运行
- **⚠️ 这个守卫在当前代码里已经不存在了！见第五节，头号嫌疑。**

### v1.3.52 — commit 0ed9a31
- 发现漏网点：`setWindowOpenHandler` 对 `/platformkfim|shop\/kf|shop\/platform/` 的 URL
  返回 allow → 创建**真独立子窗口**（type 'window'），其 webContents 没注册 close 拦截
- 修三层：
  1. 全局 `app.on('web-contents-created')`：拦截所有**非主窗口网页内容**的 close
     （主窗口 webContents 和 type 'window' 的合法子窗口放行）
  2. `view.webContents.on('did-create-window')`：单独拦截 allow 分支真子窗口的 close
  3. `window-all-closed` 改保护式：只有 isQuitting=true 才 app.quit()

### v1.3.53 — commit 8a61491
- setWindowOpenHandler 拦截 about:blank / javascript: 占位 URL（巨量引擎/千川 window.open 空白标签）
- `window-all-closed` 去掉 `!mainWindow` 隐患，仅 isQuitting 才退出（终极兜底）
- closeTab / mainWindow.on('close') / did-create-window 加 **QUIT-DIAG** 诊断日志
- 新增日志面板「导出」按钮（export-logs IPC，一键存 TXT）

### 相关但不同问题
- **v1.3.76 — commit 4a1c0c7**：会话 Cookie 持久化（微信小店/腾讯广告每次打开要扫码的问题，不是退出问题）

## 四、当前代码（v1.3.80, d598af0）里还活着的防线

| 层 | 位置 | 状态 |
|---|---|---|
| 1. 主世界注入屏蔽 window.close | main.js ~2833（did-start-navigation 注入 `window.close=function(){}`） | ✅ 在 |
| 2. view 的 will-prevent-unload → preventDefault | main.js ~2705 | ✅ 在 |
| 3. 每个 tab webContents.on('close') 拦截 | main.js ~2712（CLOSE-FIX 日志） | ✅ 在 |
| 4. did-create-window 子窗口 close 拦截 | main.js ~2893 | ✅ 在 |
| 5. 全局 web-contents-created 非主窗口 close 拦截 | main.js ~6187 | ✅ 在 |
| 6. window-all-closed 仅 isQuitting 才退出 | main.js ~6200 | ✅ 在 |
| **7. 主窗口 close 的 isQuitting 守卫（v1.3.48）** | 应在 createMainWindow 内 `mainWindow.on('close')` | **❌ 丢失！** |

## 五、⚠️ 头号嫌疑：v1.3.48 的主窗口守卫丢了

当前 main.js ~690 行：

```js
mainWindow.on('close', (event) => {
  addLog('QUIT-DIAG', 'mainWindow close 事件', `isQuitting=${globalState.isQuitting}`);
  globalState.isQuitting = true;   // ← 无条件置 true！
  saveData();
  ...
  app.quit();                       // ← 无条件退出
});
```

v1.3.48 原版的守卫是：

```js
if (!globalState.isQuitting) {
  event.preventDefault();
  addLog('CLOSE-FIX', 'mainWindow close 被拦截', '非主动关闭...');
  return;
}
```

这段在 **commit 8a27616（v1.3.64，仓库重导入型提交）** 中被重写覆盖，守卫没带过来。
后果：现在第 5 层只拦「非主窗口」的 webContents；**任何**能让主窗口 'close' 事件
真正触发的路径（主窗口 webContents 的 window.close 冒泡不拦、某些竞态）都会
把 isQuitting 置 true 并直接退出——第 6 层 window-all-closed 形同虚设。

**建议第一步：把 v1.3.48 的守卫加回去**（但注意：当前 close handler 里承担了
saveData / 清 tabs-session.json / 销毁托盘职责，v1.3.79/80 的会话恢复逻辑依赖
「正常关闭时清除会话文件」。加守卫时若 preventDefault 拦截，要保证正常用户退出
路径仍然走完整流程——参考 v1.3.48 做法：拦截后仅 return，用户正常退出走托盘/菜单
退出按钮（那里先置 isQuitting=true 再 quit），需要核对点 X 关闭和托盘退出两条路径都不回归）。

## 六、其他可能的漏网路径（排查优先级排序）

1. **主窗口 close 守卫缺失**（第五节，最优先）
2. 主窗口 webContents 自身的 window.close 冒泡：web-contents-created 第 6190 行
   对 `contents === mainWindow.webContents` 直接 return 不拦
3. will-prevent-unload 在 main.js ~552 是**空 handler**（主窗口层面）：
   `mainWindow.on('will-prevent-unload', (event) => {})` 不调 preventDefault，
   语义上等于放行 unload 取消？与 view 层（~2705 调 preventDefault 放行导航）行为不一致，需确认
4. `web-contents-created` 里 type 'window' 的合法子窗口（书签/截图弹层）不拦 close——
   如果腾讯广告某条路径创建了 type 'window' 的窗口且它的关闭逻辑冒泡，是个盲区
5. 崩溃型退出（不是 close 流程）：主进程 crash / GPU 崩溃也会「彻底退出」，
   要靠日志区分是 close 流程退出还是 crash（看有没有 QUIT-DIAG 日志）

## 七、诊断方法（下次复现时）

1. 日志面板有「导出」按钮，一键存 TXT；grep 关键字 `QUIT-DIAG` / `CLOSE-FIX` / `BLOCK` / `NAV`
2. 判别链路：
   - 有 `window-all-closed 被拦截（非主动退出）` → 第 6 层还活着，退出来自更早环节
   - 有 `mainWindow close 事件` 且紧接退出 → 主窗口 close 被真实触发（第五节嫌疑实锤）
   - 完全没有 QUIT-DIAG 日志就没了 → 疑似主进程 crash，另查 crash dump
3. 复现操作：腾讯广告后台 → 充值 → 支付成功页 → 反复点「返回」/刷新/直接关支付子窗口

## 八、给接手 AI 的行动建议

1. 先把 v1.3.48 的主窗口 close 守卫恢复（第五节），注意兼容会话保存逻辑
2. 打包前跑语法关卡：`node --check src/main.js src/preload/preload.js src/renderer/app.js`
3. 改动前 `git log --oneline -1` 核对版本；发版要同时改 package.json 版本号
4. 最小改动、别动其他模块；改完自己先用日志验证「点 X 关闭 / 托盘退出 / 支付页返回」三条路径
5. 版本历史参考：v1.3.47（9957184）→ v1.3.48（3567ab2）→ v1.3.52（0ed9a31）→
   v1.3.53（8a61491）→ v1.3.80（d598af0，当前 HEAD）
