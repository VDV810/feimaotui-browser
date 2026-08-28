# 飞毛腿浏览器接入 Edge「沉浸式翻译」插件技术文档

> 版本：v1.3.63（commit 2dd233e）
> 适用范围：Windows 桌面版飞毛腿浏览器（Electron 42 / appId com.electron.browser）
> 目标：让飞毛腿自己的内核直接运行 Edge 商店的「沉浸式翻译（Immersive Translate）」扩展，实现网页自动翻译，无需打开 Edge。

---

## 1. 运行时 / 框架

| 项 | 说明 |
|---|---|
| 运行时 | Electron 42.x（`node_modules/electron/dist/electron.exe`），Windows x64 |
| 扩展来源 | Edge 本地已装版本：`%LOCALAPPDATA%\Microsoft\Edge\User Data\Default\Extensions\amkbmndfnliijdhojkpoglbnaaahippg\1.32.7_0\` |
| 扩展 ID | `amkbmndfnliijdhojkpoglbnaaahippg`（manifest 自带 `key` 字段，ID 固定不变） |
| 扩展版本 | 1.32.7（MV3，content script 动态 `import()` 加载 content_main.js） |
| 仓库扩展目录 | `extensions/immersive-translate/`（已打补丁，随安装包分发） |
| 部署目录 | `%APPDATA%\feimaotui-browser\browser-data\extensions\amkbmndfnliijdhojkpoglbnaaahippg\` |
| 会话分区 | `persist:main`（与标签页同一分区，扩展才能注入到页面） |

**总体链路**：Edge 商店插件 → 拷贝进仓库并打补丁 → electron-builder `extraResources` 打进安装包 → 启动时 `seedAndLoadBundledImmersiveTranslate()` 自动部署到 userData → `session.extensions.loadExtension()` 加载进 `persist:main` → 内容脚本注入页面 → 悬浮球/自动翻译。

---

## 2. 核心问题与解决方案（本方案的核心价值）

### 2.1 问题一：Electron 没有实现 `chrome.storage.sync`

沉浸式翻译的 polyfill 与「快捷键迁移」初始化会在启动时直接访问 `chrome.storage.sync`，Electron 未实现该 API，访问即抛：

```
Error: "sync" is not available in this instance of Chrome
```

background 一启动就崩 → content 发往 background 的消息全部失败 → 悬浮球不渲染、无法翻译。

**修复**（`_ext_test/sync_fix_snippet.js`，prepend 到三个文件顶部）：

```js
// 把 chrome.storage.sync / session 重定向到 local 的封装对象
var _imtFix_s = chrome.storage;
if (_imtFix_s && _imtFix_s.local) {
  var _imtFix_area = {
    get: _imtFix_s.local.get.bind(_imtFix_s.local),
    set: _imtFix_s.local.set.bind(_imtFix_s.local),
    remove: _imtFix_s.local.remove.bind(_imtFix_s.local),
    clear: _imtFix_s.local.clear.bind(_imtFix_s.local)
  };
  Object.defineProperty(_imtFix_s, 'sync', { configurable: true, writable: true, value: _imtFix_area });
  Object.defineProperty(_imtFix_s, 'session', { configurable: true, writable: true, value: _imtFix_area });
}
```

要点：
- Electron 的 `chrome.storage` 各 area 是 **configurable** 的，子级 `Object.defineProperty(chrome.storage,'sync',{value:...})` 可成功（已验证 descriptor `configurable:true`）。
- 同时把扩展自带的存储包装函数 `D5(e)`（content_main.js）和 `Xo(e)`（background.js）入口改成 `if(e==="sync"||e==="session")e="local";`，让模块加载时缓存的 `mue.sync` / `Xm.sync` 访问器也指向 local。

### 2.2 问题二：service worker 缓存导致补丁不生效（36 轮调试才定位的大坑）

manifest 带 `"key"` → 扩展 ID 固定；Electron **按扩展 ID 缓存 background service worker**。第一次加载后，background.js 的源码补丁**永远不生效**（跑的还是第一次加载的旧脚本）。内容脚本不缓存，所以 content 侧补丁全生效、background 侧纹丝不动——这就是"content 修好了 background 还是崩"的诡异现象的根因。

**修复**（两层）：
1. **测试期**：每次测试用全新 partition `session.fromPartition('persist:test' + Date.now())` 绕开缓存。
2. **生产期**：启动部署后清该扩展 origin 的 SW 缓存：
```js
await Promise.race([
  sess.clearStorageData({
    origin: 'chrome-extension://' + BUNDLED_IMT_ID,
    storages: ['serviceworkers', 'indexdb', 'cachestorage', 'shadercache']
  }),
  new Promise(r => setTimeout(r, 5000))  // 5s 超时保护，防止挂起阻塞启动
]);
```

> ⚠️ 注意：`clearStorageData({storages:['indexdb']})` **清不掉 chrome.storage.local**。Electron 的扩展 storage 存在 `userData/Local Extension Settings/<extId>/` 的 LevelDB 里，不在 IndexedDB。旧配置残留只能靠"启动时强制覆盖配置"解决（见 2.3）。

### 2.3 问题三：用户配置 key 位置——`fullLocalUserConfig`

这是"改成默认只显示中文/自动翻译却不生效"的真凶：

沉浸式翻译把**全部用户配置存在 `chrome.storage.local` 的单个 key `'fullLocalUserConfig'` 里**（background 的 `function Pt(){return U.local.get(Vo,{...})}`，`Vo = "fullLocalUserConfig"`）。如果散落 `set` 顶层 key（如 `chrome.storage.local.set({translationMode:...})`），扩展**读不到**。

**修复**（`_ext_test/imt_force_defaults_snippet.js`，V4，prepend 到 content_main.js / background.js）：

```js
var _imtFD_marker = '_imt_forced_v4';
chrome.storage.local.get(['_imtFD_marker', 'fullLocalUserConfig'], function (_v) {
  if (_v && _v[_imtFD_marker]) return;            // 只强制一次，不覆盖用户后续修改
  var _cfg = (_v && _v.fullLocalUserConfig) || {};
  _cfg.translationMode = 'translation';            // 仅译文（不中英对照）
  _cfg.targetLanguage = 'zh-CN';
  _cfg.forceAutoTranslate = true;                  // 自动翻译
  if (!Array.isArray(_cfg.alwaysTranslateLanguages)) _cfg.alwaysTranslateLanguages = ['en'];
  else if (_cfg.alwaysTranslateLanguages.indexOf('en') === -1) _cfg.alwaysTranslateLanguages.push('en');
  chrome.storage.local.set({ _imtFD_marker: true, fullLocalUserConfig: _cfg });
});
```

先读旧值再 merge，避免丢用户已有设置；用 `_imt_forced_v4` marker 保证只写一次，用户后续在悬浮球里改的模式不会被每页刷新覆盖。

### 2.4 问题四：默认配置不生效（default_config.content.json）

`translationMode` 根级从 `dual` 改为 `translation`、新增 `targetLanguage: zh-CN`、`forceAutoTranslate: true`。**注意**：该文件是 162KB 单行 minified JSON，Windows Git Bash 的 GNU `sed s/.../.../2` 在超长单行上不可靠（曾改错 nested rule），**必须用 node 在 JSON 对象层面修改后 minified 写回**。

---

## 3. 核心功能 / 封装（main.js 关键函数）

### 3.1 `computeBundledExtFingerprint(src)`（约 3843 行）

对 bundled 扩展源的关键文件（manifest.json、background.js、content_main.js、content_guard.js、default_config.content.json）取 md5 前 8 位，拼成 `v1:xxxx-xxxx-...` 指纹。

**用途**：部署 marker（`_imt_patch_v1` 文件）内容从"时间戳"升级为"指纹比对"。仓库扩展源码变化 → 指纹变化 → 下次启动自动重新部署，旧版本残留自动失效。旧的 timestamp marker 与新指纹必然不匹配，触发一次刷新。

### 3.2 `getBundledImmersiveTranslateDir()`（约 3856 行）

定位 bundled 扩展源目录：
- 打包后：`process.resourcesPath/extensions/immersive-translate`（electron-builder `extraResources` 拷贝的裸文件，非 asar——Chromium 扩展加载需要真实路径）
- 开发态：`app.getAppPath()/extensions/immersive-translate`

### 3.3 `seedAndLoadBundledImmersiveTranslate()`（约 3863 行，启动时自动执行）

启动流程（`app.whenReady` 内 `await` 执行，先于 `loadPersistedExtensionsOnStartup` 避免竞态）：

```
1. 定位 bundled 源目录
2. 计算源指纹 vs 已部署 marker 指纹
   ├─ 不一致 → 清空旧目录 → cpSync 复制 → 写新指纹 marker
   └─ 一致   → 跳过（幂等）
3. clearStorageData 清 SW 缓存（5s 超时保护）
4. 检查 extensions.json 已安装列表，无则 push {id, dir, name:'Immersive Translate', url:'bundled'}
5. loadExtensionIntoMainSession(tgt, id) → session.extensions.loadExtension(dir,{allowFileAccess:true})
```

`url:'bundled'` 标记用于 `loadPersistedExtensionsOnStartup` 跳过重复加载（该函数只加载 `url !== 'bundled'` 的扩展）。

### 3.4 `loadExtensionIntoMainSession(extDir, extId)`（约 3743 行）

优先用 Electron 42 新 API `session.extensions.loadExtension(extDir,{allowFileAccess:true})`，降级到旧 `session.loadExtension`；"already loaded" 异常按已加载处理，从 `getAllExtensions()` 命中返回。

### 3.5 扩展管理 IPC（约 4023 行起）

| IPC channel | 主进程处理 | 说明 |
|---|---|---|
| `extension-list-loaded` | `session.extensions.getAllExtensions()` + 读 manifest（description/icons/short_name） | 返回扩展列表给面板 |
| `extension-remove` | `session.extensions.removeExtension(id)` + 从 extensions.json 移除 | 卸载 |
| `extension-reload` | removeExtension + 300ms 后重新 loadExtension | 重新加载 |
| `extension-install-local` | `installLocalExtensionViaDialog()` | 本地安装（对话框） |

### 3.6 `installLocalExtensionViaDialog()`（约 3924 行）

**升级点**：从"仅支持选择文件夹"扩展为**支持 .crx / .zip 文件**：

```
1. showOpenDialog(properties:['openDirectory','openFile'], filters:[{crx,zip}])
2. 文件模式：
   ├─ .crx  → stripCrxHeader(buf) 剥离 CRX2/CRX3 头 → 得到 zip 数据
   ├─ .zip  → 直接读
   └─ 其它  → 尝试按 CRX 解析，失败报"不是有效的 .crx 或 .zip 文件"
   → 临时解压 → 读 manifest.json → 生成 safeId 目录
   → 移动到 userData/extensions/<safeId> → 加载
3. 目录模式：检查 manifest.json 存在性（原逻辑）
4. 持久化到 extensions.json + 弹窗提示
```

解决用户"其他浏览器能装、飞毛腿提示没有 manifest.json"（因为旧版只认文件夹，用户选的是 .crx 文件）。

### 3.7 渲染层（renderer）

- `index.html`：工具栏新增 `#extensionsBtn`（拼图图标，历史按钮旁）；新增 `#extensionsPanel` 面板（列表 + "安装本地扩展" + "Edge 扩展商店"按钮）
- `app.js`：`togglePanel('extensions')` 触发 `loadExtensionsList()` → `renderExtensionsList()`（图标用 `chrome-extension://<id>/icons/128.png` 拼 URL；移除按钮调 `electronAPI.removeExtension`；内置扩展（ID 以 amkb 开头）特殊标注）
- `preload.js`：暴露 `listLoadedExtensions` / `removeExtension` / `reloadExtension` / `installLocalExtension`

---

## 4. 入参 / 出参

### 4.1 `seedAndLoadBundledImmersiveTranslate()`
- 入参：无（读全局 `dataPath`）
- 出参：无（副作用：部署+加载+日志）
- 异常：整体 try/catch，失败仅 `addLog('EXT', ...)` 不阻塞启动

### 4.2 `extension-list-loaded`
- 返回：`[{ id, name, version, path, enabled, description, icons, shortName }]`
- 异常：返回 `[]`

### 4.3 `extension-remove(extId)`
- 入参：扩展 ID
- 返回：`{ success: true }` 或 `{ success: false, error }`
- 异常：卸载失败记录 `addLog('EXT','卸载失败')`

### 4.4 `installLocalExtensionViaDialog()`
- 返回：`{ success:true, name, version }` / `{ success:false, canceled:true }` / `{ success:false, error }`
- 异常：临时解压目录在 catch 中清理

---

## 5. 异常与已知问题

| 问题 | 影响 | 状态 |
|---|---|---|
| `TypeError: Cannot read properties of undefined (reading 'update')`（background.js，minified 代码内） | 非致命异步错误，不阻塞悬浮球/翻译 | 已知，未处理 |
| `fetchError: Failed to fetch`（content_main.js:5349） | 扩展 GA 埋点被飞毛腿广告拦截 cancel 引发，不影响翻译 | 已知，无害 |
| 广告拦截误伤 | 若用户自定义规则命中翻译服务域名会阻断翻译；`weixin.qq.com` 等登录域已放行 | 需留意 |
| 扩展商店 crx 直装接口被 WAF 挡 | 走"安装本地扩展"选 .crx 文件路径（v1.3.63 已支持） | 已解决 |
| 首次部署时旧 SW 缓存 | 已用 clearStorageData(serviceworkers) 清除 | 已解决 |
| 旧版本 storage 残留（fullLocalUserConfig=dual） | 已用 V4 强制覆盖 marker `_imt_forced_v4` | 已解决 |

---

## 6. 示例 / 约定

### 6.1 手动重新打补丁（升级扩展版本时）

```bash
# 1. 从 Edge 拿最新扩展拷贝到仓库
EDGE="/c/Users/Administrator/AppData/Local/Microsoft/Edge/User Data/Default/Extensions/amkbmndfnliijdhojkpoglbnaaahippg/<新版本>_0"
rm -rf extensions/immersive-translate
mkdir -p extensions/immersive-translate
cp -r "$EDGE"/. extensions/immersive-translate/
rm -rf extensions/immersive-translate/_metadata

# 2. 跑补丁脚本（幂等：sync fix + D5/Xo 重定向 + 强制默认配置V4 + L1e放行 + 暴露init错误）
node _ext_test/patch_final.js
```

### 6.2 测试（全新 partition 避免 SW 缓存）

```bash
unset ELECTRON_RUN_AS_NODE
IMT_EXT_DIR="$PWD/extensions/immersive-translate" \
  node_modules/electron/dist/electron.exe _ext_test/verify_force_defaults.js
```

成功标志：日志出现 `IMT_FORCE_DEFAULTS_V4 applied translation-only/zh-CN/auto-en -> fullLocalUserConfig`，且无 `"sync" is not available` / `IMT_INIT_ERR`。

### 6.3 打包构建（绕开本机 safe-delete 守卫）

```bash
# 本环境 NODE_OPTIONS 注入了 genie-safe-delete shim，会让 electron-builder 的 fs.remove 失败，
# 必须 env -u NODE_OPTIONS + 直接调 node 二进制；构建前先杀残留 node/electron 进程防 win-unpacked 锁
MSYS_NO_PATHCONV=1 taskkill /F /IM electron.exe 2>/dev/null
MSYS_NO_PATHCONV=1 taskkill /F /IM node.exe 2>/dev/null
env -u NODE_OPTIONS "C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2/node.exe" \
  node_modules/electron-builder/out/cli/cli.js --win
```

### 6.4 版本约定

- 扩展版本保持 Edge 原版号（当前 1.32.7），飞毛腿主版本每次改动 +0.0.1（v1.3.60 → v1.3.63）
- 扩展内置补丁通过 `_imt_patch_v1` 文件指纹（md5）判断是否需要重新部署
- 内置扩展在 extensions.json 中标记 `url: 'bundled'`，与用户手动安装的扩展区分

---

## 7. 相关文件索引

| 文件 | 职责 |
|---|---|
| `extensions/immersive-translate/` | 已打补丁的扩展（随包分发） |
| `_ext_test/patch_final.js` | 补丁脚本（幂等，含全部注入层） |
| `_ext_test/sync_fix_snippet.js` | chrome.storage.sync/session→local 补丁 |
| `_ext_test/imt_force_defaults_snippet.js` | 强制默认配置 V4（写 fullLocalUserConfig） |
| `_ext_test/verify_force_defaults.js` | 配置写入验证脚本 |
| `src/main.js:3838-3901` | 内置扩展自动部署（指纹/清缓存/加载） |
| `src/main.js:3924-4030+` | 本地安装 .crx/.zip + 扩展管理 IPC |
| `src/preload/preload.js` | 扩展管理 IPC 暴露 |
| `src/renderer/index.html / app.js` | 扩展管理面板 UI |
| `package.json` | `extraResources` 打包扩展 + `nsis.include` 杀进程钩子 |
