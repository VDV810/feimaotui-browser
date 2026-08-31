# GitHub 访问修复技术文档（Watt Toolkit 方案）

> 版本：v1.0 | 日期：2026-08-31 | 适用：飞毛腿浏览器（Electron）/ 其他 Windows 电脑通用

## 一、问题现象

飞毛腿访问 `github.com`（如 `github.com/settings/tokens/new`）白屏，Edge 正常。
日志特征：

```
[ERROR] 页面加载失败 https://github.com/settings/tokens/new | ERR_CONNECTION_RESET (-101)
```

## 二、根因诊断（重要，先排错再动手）

### 诊断流程（按顺序做，5 分钟出结论）

```bash
# 1. 查日志有无拦截记录（飞毛腿日志里搜 ADBLOCK / BLOCK）
#    有 → 是浏览器拦截问题，走"误杀排查"；没有 → 继续第 2 步

# 2. DNS 解析（Node 环境）
node -e "require('dns').lookup('github.com',(e,a)=>console.log(e?('FAIL:'+e.code):a))"
# 正常应返回 20.205.243.166 等真实 IP

# 3. TCP 层连通性
node -e "const net=require('net');const s=net.connect(443,'20.205.243.166',
  ()=>{console.log('TCP通');s.end()});s.setTimeout(8000,()=>{console.log('TCP超时');s.destroy()})"

# 4. TLS 层连通性（关键！）
node -e "const tls=require('tls');const s=tls.connect({host:'140.82.121.4',port:443,
  servername:'github.com',rejectUnauthorized:false,timeout:8000},
  ()=>{console.log('TLS通');s.destroy()});
  s.on('error',e=>console.log('TLS失败:',e.code));s.on('timeout',()=>console.log('TLS超时'))"
```

### 本次诊断结论

| 层级 | 结果 | 说明 |
|---|---|---|
| DNS 解析 | ✅ 正常 | 返回真实 IP，无污染 |
| TCP 443 | ✅ 通（111ms） | 连接放行 |
| **TLS 握手** | ❌ **间歇性超时** | **SNI 指纹干扰** |

**根因**：国内对 GitHub 的干扰是 **"TCP 通、TLS 被掐"** 型——连接请求放行，但携带
`github.com` SNI 指纹的加密握手包被干扰丢弃。且干扰是**波动窗口型**（实测 10 分钟内
两轮测试：第一轮 10 个节点 8 个 TLS 通，第二轮全部超时）。

**关键结论**：波动窗口型干扰 → **没有任何固定 IP/hosts 映射能长期稳定**，必须走加速节点。

### 排错口诀（网络类白屏）

1. 日志先搜 `ADBLOCK`/`BLOCK` → 有 = 拦截误杀（查自定义广告规则）
2. 看 `ERROR` 行错误码：
   - `ERR_CONNECTION_RESET` = 被墙/网络重置（本文档场景）
   - `ERR_NAME_NOT_RESOLVED` = DNS 问题
   - `ERR_ABORTED` = 页面主动取消
3. 按 DNS → TCP → TLS 三层逐级测，定位卡在哪层

## 三、方案对比（为什么选 Watt Toolkit）

| 方案 | 结论 |
|---|---|
| Edge 商店代理插件（SwitchyOmega 类） | ❌ 只是配置管理器，**不带翻墙服务器**，没服务器装了也白装 |
| "自带免费服务器"代理插件（Hola 类） | ❌ 被曝出售用户带宽，不安全，禁用 |
| 固定 IP 写 hosts | ❌ 波动窗口型干扰下失效，只能碰运气 |
| **Watt Toolkit（本方案）** | ✅ 免费、国内可下、GitHub 专用加速、一键操作 |

## 四、安装与配置步骤（新电脑照做）

### 1. 下载安装

- 官网：`https://steampp.net`（免费，国内直连可下）
- 安装包约 96MB，双击安装（需要管理员权限）

### 2. 开启 GitHub 加速（GUI 操作，自动化碰不了）

1. 打开 Watt Toolkit → 左侧 **「网络加速」**
2. 勾选 **「GitHub」**
3. 点 **「一键加速」**
4. 加速模式：默认（hosts 模式 / 系统代理模式均可）

### 3. 重启浏览器

飞毛腿 / Edge / Chrome **全部直接生效**（加速对系统级生效，不挑浏览器）。

### 4. 验证

```
打开 https://github.com → 能显示页面 = 成功
```

## 五、飞毛腿侧的配合配置（v1.3.75+）

飞毛腿 v1.3.75 起内置**网络代理设置**（设置 → 网络代理）：

- **留空**（默认）= 显式跟随系统代理 `{mode:'system'}`，与 Edge 行为对齐
- **填写**（如 `127.0.0.1:7890`）= 走指定代理 `{proxyRules}`，立即生效不用重启
- 支持系统代理模式（Watt Toolkit 的系统代理模式开起来后，飞毛腿留空即可）

实现位置（源码索引）：
- `src/main.js`：`applyProxyToSessions()`（对 persist:main / persist:privacy / default 三会话 setProxy）、IPC `set-proxy` / `get-proxy`
- `src/preload/preload.js`：`setProxy` / `getProxy`
- `src/renderer/`：设置面板"网络代理"section

## 六、异常与注意事项

| 异常 | 处理 |
|---|---|
| 加速后仍白屏 | 重启浏览器（hosts/代理变更需重启才生效） |
| Watt Toolkit 提示"hosts 写入失败" | 以管理员身份运行 Watt Toolkit |
| 静默安装 `/S` 无效 | 该安装器可能需 UAC 交互，用 `Start-Process -Verb RunAs` 弹 GUI 装 |
| 加速时其他网站变慢 | Watt Toolkit 只加速勾选的站点，取消不需要的勾选 |
| 干扰窗口期偶尔连不上 | 重开"一键加速"刷新节点列表 |

## 七、约定

1. **浏览器白屏先看日志错误码，不要急着改代码**——本次 ERR_CONNECTION_RESET 与浏览器无关
2. 被墙站点统一走 Watt Toolkit（GitHub/Steam/Docker 等），不走代理插件
3. 飞毛腿的代理设置框保留，供未来接入正规代理工具（Azure/付费 API 等）
4. 新电脑配置流程：装 Watt Toolkit → 勾 GitHub → 一键加速 → 重启浏览器，全程 3 分钟
