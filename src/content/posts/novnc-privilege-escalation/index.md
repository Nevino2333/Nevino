---
title: "noVNC：基于浏览器实现学生机越权远控超脑的方案"
published: 2026-09-04
updated: 2026-09-04
draft: false
description: "在官方设计中，超脑远控权限仅属于教师。魔改版 noVNC 通过自动化脚本与 WebSocket 协议转换，使学生仅用浏览器即可越权获得完整远控能力。"
aiSummary: ""
image: ""
tags: ["Changyan"]
category: "软破"
lang: "zh-CN"
pinned: false
author: "Nevino"
sourceLink: ""
licenseName: ""
licenseUrl: ""
comment: true
---

## 前言

上一篇文章介绍了 Captive 如何通过 DNS 劫持与透明代理，绕过 MDM 对 40 网段的封锁，实现学生平板零配置访问超脑本地 Web 服务。本文则是另一条技术路径的延伸——如果说 Captive 解决的是“**访问**”问题，那么本文要探讨的则是“**权限**”问题。

在官方设计框架中，讯飞超脑的远控权限是严格按角色分配的。教师端拥有完整的超脑远控能力，可以通过官方工具进行投屏控制、课件翻页等操作；学生平板则被设计为纯粹的“接收端”，仅能观看教师投屏内容，无权对超脑进行任何形式的远程操作。这一权限划分的意图是明确的：**保证教师对课堂设备的绝对控制权，避免学生越权干扰教学进程**。

然而，任何权限系统的严密性都受限于其实现层的技术边界。MDM 可以限制应用安装、可以封锁特定网段，但无法阻止浏览器通过标准 WebSocket 协议建立连接并传输 VNC 指令。只要超脑上运行了 VNC Server，且 VNC 流量能够被协议转换为学生浏览器可识别的内容，远控权限的分配逻辑便从“**系统层强制**”降级为“**协议层可达**”。

**noVNC** 正是利用这一技术路径实现的越权工具。它是一个纯 HTML5 的 VNC 客户端，配合 WebSocket 代理（websockify），可以将传统的 TCP VNC 协议转换为浏览器可识别的 WebSocket 协议，使学生平板仅通过浏览器即可获得对超脑的完整远程控制能力——**这一能力在官方设计中本应专属教师**。

本文将从技术原理、系统架构与部署实践三个维度，完整阐述如何利用 noVNC 在超脑上搭建一条学生机越权远控的技术通路。

**声明**：本文所述方案仅供技术研究与学习交流，不鼓励任何违反所在机构设备管理规定的行为。本方案涉及对学生平板的权限越权操作，使用者应充分了解相关风险并自行承担相应责任。

## 问题背景：官方权限框架下的不对称设计

在官方智慧课堂系统中，远控权限的分配遵循以下规则：

| 角色 | 远控超脑权限 | 实现方式 |
|------|-------------|----------|
| **教师** | ✅ 允许 | 官方投屏工具、遥控器 App |
| **学生** | ❌ 禁止 | 仅能接收投屏画面 |

这一权限划分由 MDM 策略与系统层权限管理共同保障：
1. **应用层面**：学生平板无法安装非官方远控软件，官方投屏工具本身不开放远控功能入口；
2. **网络层面**：40 网段被封锁，即使学生发现 VNC 端口，也无法建立 TCP 连接；
3. **协议层面**：标准 VNC 协议（TCP 5900）在浏览器中无法直接使用，进一步降低了越权可能性。

三重防护看似严密，但**任何系统的安全性都受限于其协议栈的设计边界**——MDM 可以封锁网段、限制应用安装，但无法阻止浏览器通过标准 WebSocket 协议建立连接。

## noVNC 的越权路径

noVNC 的核心策略是：**将传统的 VNC 远程桌面协议“Web”化，利用 WebSocket 绕过 MDM 对 TCP 直接连接的限制，使学生在不安装任何软件的前提下获得超脑的远控能力**。

### 技术原理

整个系统的数据流如下：

```
[学生浏览器] <--(WebSocket)--> [websockify 代理] <--(TCP VNC)--> [TightVNC Server] <--(系统图形接口)--> [超脑桌面]
```

系统由三个核心组件构成：

| 组件 | 作用 | 运行位置 |
|------|------|----------|
| **TightVNC Server** | 运行在 Windows 上的 VNC 服务端，负责捕获和传输桌面画面，监听 TCP 5900 端口 | 超脑 |
| **websockify** | WebSocket 到 TCP 的代理，将浏览器的 WebSocket 连接转换为 VNC 协议 | 超脑 |
| **noVNC** | HTML5 VNC 客户端，运行在浏览器中，无需安装任何客户端软件 | 学生浏览器 |

**越权的关键点**：学生机只需要一个现代浏览器（Chrome、Edge、Safari 均可），输入 URL 即可获得对超脑桌面的完整控制权。整个过程：
- **不涉及任何应用安装**——MDM 的应用管控被绕过；
- **不涉及 40 网段**——通信路径与 Captive 方案一致，经超脑热点 IP 完成；
- **不依赖任何官方授权**——VNC Server 的密码保护是唯一的“门槛”，但一旦密码被获取或破解，权限防线便完全失效。

### 与 Captive 的协同

本方案与上一篇文章介绍的 Captive 可以形成完整的越权工具链：

- **Captive**：解决“网络可达”问题——让学生机通过域名访问超脑本地服务
- **noVNC**：解决“权限越权”问题——让学生机通过浏览器获得本不属于他们的远控能力

两者结合，学生机只需连接超脑热点、打开浏览器，即可同时访问超脑上的 Web 服务并获得超脑桌面的完整控制权，**在官方权限框架之外重建了一套平行的远程操作体系**。

## 部署方案（魔改版）

以下基于我魔改的 noVNC 仓库进行部署。与官方版本相比，本仓库的主要改进在于：

- **完整的自动化脚本体系**：提供 `test_run.bat`、`start_noVNC.bat`、`setup_autostart.bat` 等一系列脚本，覆盖测试、后台运行、开机自启全场景；
- **一键开机自启**：支持 Windows 计划任务、NSSM 服务、注册表 Run 键三种自启方式，适配不同权限场景；
- **预设连接参数**：通过 `defaults.json` 可预设 VNC 地址、端口、自动连接、断线重连等参数，实现开箱即用；
- **静默后台运行**：使用 VBScript 实现完全无窗口闪烁的后台启动；
- **完整的卸载与排障工具**：提供一键卸载所有自启配置的命令，便于清理。

### 环境要求

- 硬件：讯飞超脑（Windows 10 / 11 64 位）
- Python 运行环境（推荐 3.11 或更高）
- 权限：管理员权限（用于安装 VNC Server 和配置开机自启）
- 网络：超脑热点已开启

### 第一步：安装 Python

访问 [python.org](https://www.python.org/downloads/) 下载最新版本 Python。安装时**务必勾选 "Add Python to PATH"**，然后点击 "Install Now"。

验证安装：
```cmd
python --version
```
应输出 Python 3.x 的版本信息。

### 第二步：安装 TightVNC Server

下载 TightVNC Server：访问 [tightvnc.com](https://www.tightvnc.com/download.php)，选择 "TightVNC for Windows (64-bit)"。

安装时选择 **"Custom installation"**，组件中确保勾选 **TightVNC Server**（必须），TightVNC Viewer 可选。

验证安装：
```cmd
tvnserver.exe -version
```
应输出 TightVNC Server 的版本信息。

### 第三步：配置 TightVNC Server

**首次启动配置**：
```cmd
tvnserver.exe -install
```
系统会弹出配置对话框：
- **主密码 (Primary Password)**：设置 VNC 连接密码，**这是必需的**
- **查看-only 密码 (View-only Password)**：可选

**手动启动服务**：
```cmd
tvnserver.exe -run
```
TightVNC Server 启动后会在系统托盘显示图标，默认监听 5900 端口。

**验证端口监听**：
```cmd
netstat -ano | findstr :5900
```
应看到 5900 端口处于 LISTENING 状态。

**配置建议**：
| 配置项 | 建议值 |
|--------|--------|
| Allow loopback connections | 勾选 |
| Allow web connections | 勾选 |
| Log verbosity | 3（正常）|

通过命令行设置密码：
```cmd
tvnserver.exe -setpassword YOUR_PASSWORD
```

### 第四步：启动 noVNC 服务

进入项目目录后，有以下启动方式：

**方式一：测试模式（推荐首次验证）**
双击运行 `test_run.bat`，服务在前台运行，便于观察日志输出：
```
WebSocket server wss://0.0.0.0:8999/ running
- Connecting to security=draft-00 address=localhost:5900
```
按 `Ctrl+C` 停止服务。

**方式二：后台运行**
双击运行 `start_noVNC.bat`，服务在后台运行，窗口会自动关闭。

**方式三：手动命令行启动**：
```cmd
cd /d D:\NetWork\noVNC
python utils\websockify-master\websockify --web . 8999 localhost:5900
```

默认 noVNC 监听 **8999** 端口，TightVNC Server 监听 **5900** 端口。

### 第五步：浏览器访问验证

确保 noVNC 服务和 TightVNC Server 都在运行，打开浏览器访问：
```
http://[超脑热点IP]:8999/vnc.html
```

页面加载后：
- **Host** 填写：超脑热点 IP（如 `192.168.137.1`）或 `localhost`（本机测试）
- **Port** 填写：`5900`
- **Password** 填写：TightVNC 设置的密码
- 点击 **Connect** 

如果一切正常，浏览器中会显示超脑桌面画面。

**URL 参数直连方式**（可选）：
```
http://[超脑IP]:8999/vnc.html?host=[超脑IP]&port=5900&password=YOUR_PASSWORD
```

**可用页面**：
| 页面 | 说明 |
|------|------|
| `vnc.html` | 完整功能版（推荐）|
| `vnc_lite.html` | 精简版 |
| `vnc_compat.html` | Chrome 80 兼容版（魔改）|

### 第六步：配置开机自启（关键）

项目提供了三种自启方案，可按需选择：

| 方案 | 启动时机 | 需要管理员 | 推荐度 |
|------|----------|-----------|--------|
| Windows 计划任务 | 开机即启动 | 是 | ⭐ 最推荐 |
| NSSM Windows 服务 | 开机即启动 | 是 | ⭐ 稳定推荐 |
| 注册表 Run 键 | 用户登录后 | 否 | 无需管理员 |

**方案一：Windows 计划任务（最推荐）**

右键点击 `setup_autostart.bat`，选择 **"以管理员身份运行"**，在菜单中选择选项 **1（安装计划任务模式）**，等待安装完成。

或通过 PowerShell 命令安装：
```powershell
cd D:\NetWork\noVNC
powershell -ExecutionPolicy Bypass -File ".\setup_autostart.ps1" -Mode task
```

计划任务会在系统启动时执行 `start_noVNC_silent.vbs`，该脚本自动查找 Python 路径，以隐藏窗口方式启动 websockify，并将日志写入 `logs/noVNC_startup.log`，**完全无窗口闪烁**。

**方案二：NSSM Windows 服务**

右键点击 `install_novnc_service.bat`，选择 **"以管理员身份运行"**。脚本会自动检查 Python 和 websockify，下载 NSSM（如果没有），创建 Windows 服务 `noVNC_Service` 并启动。

服务管理命令：
```cmd
nssm.exe status noVNC_Service   # 查看状态
nssm.exe stop noVNC_Service     # 停止服务
nssm.exe start noVNC_Service    # 启动服务
nssm.exe restart noVNC_Service  # 重启服务
nssm.exe remove noVNC_Service confirm  # 卸载服务
```

也可在 `services.msc` 中找到 "noVNC Remote Desktop Service" 进行管理。

**方案三：注册表 Run 键（无需管理员权限）**
```powershell
cd D:\NetWork\noVNC
powershell -ExecutionPolicy Bypass -File ".\setup_autostart.ps1" -Mode registry
```

**一键安装菜单**

运行 `setup_autostart.bat` 会显示交互菜单：
```
1. 安装 (计划任务模式 - 需要管理员)
2. 安装 (注册表模式 - 无需管理员)
3. 卸载
4. 查看状态
5. 手动启动服务
6. 手动停止服务
0. 退出
```

### 第七步：防火墙配置（跨设备访问必需）

如果要从学生平板等**其他设备**访问，需开放防火墙端口：
```cmd
netsh advfirewall firewall add rule name="noVNC" dir=in action=allow protocol=tcp localport=8999
netsh advfirewall firewall add rule name="TightVNC" dir=in action=allow protocol=tcp localport=5900
```

### 配置修改

**修改 noVNC 监听端口**（默认 8999）：
```powershell
.\setup_autostart.ps1 -Mode task -Port 8080
```

**修改 VNC 目标地址**（如果 VNC Server 不在本机）：
```powershell
.\setup_autostart.ps1 -Mode task -VNCHost 192.168.1.100 -VNCPort 5900
```

**通过 defaults.json 预设连接参数**：
编辑项目目录下的 `defaults.json`：
```json
{
  "host": "192.168.137.1",
  "port": "5900",
  "autoconnect": true,
  "reconnect": true,
  "reconnect_delay": 5000,
  "password": ""
}
```

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `autoconnect` | 自动连接 | false |
| `reconnect` | 断线自动重连 | false |
| `reconnect_delay` | 重连延迟（毫秒）| 5000 |
| `host` | VNC 服务器地址 | - |
| `port` | VNC 服务器端口 | - |
| `quality` | 图像质量 0-9 | 6 |
| `compression` | 压缩级别 0-9 | 2 |

### 故障排除

**浏览器无法访问 `http://[IP]:8999/vnc.html`**：
1. 检查 noVNC 服务是否运行：`netstat -ano | findstr :8999`
2. 检查 Python 是否安装：`python --version`
3. 检查防火墙是否阻止：临时关闭防火墙测试，或添加 8999 端口入站规则

**连接后显示黑屏或无法连接**：
1. 检查 TightVNC Server 是否运行：`netstat -ano | findstr :5900`
2. 检查 VNC 密码是否正确：`tvnserver.exe -setpassword YOUR_PASSWORD`
3. 检查 TightVNC Server 配置：`tvnserver.exe -settings`，确保 "Allow loopback connections" 已勾选，端口为 5900

**开机自启动不生效**：
1. 检查计划任务是否存在：`Get-ScheduledTask -TaskName "noVNC_Service"`
2. 确认 `start_noVNC_silent.vbs` 文件存在
3. 查看启动日志：`Get-Content "D:\NetWork\noVNC\logs\noVNC_startup.log" -Tail 20`
4. 检查 8999 端口是否被占用：`netstat -ano | findstr :8999`

**卸载所有自启配置**：
```powershell
cd D:\NetWork\noVNC
powershell -ExecutionPolicy Bypass -File ".\setup_autostart.ps1" -Uninstall
```

## 浏览器兼容性说明

学习机上的浏览器环境与普通消费级设备有显著差异。经过实际测试，学习机内置的 WebView 主要有两个版本变体：

| 内核版本 | 对应页面 | 说明 |
|----------|----------|------|
| **腾讯 X5 内核（Chrome 89 WebView）** | `vnc.html`（完整版） | 内核版本较高，对 ES6+ 语法与 Canvas 渲染支持完善，可直接使用官方完整版 noVNC。 |
| **Chrome 80 WebView** | `vnc_compat.html`（兼容版，魔改） | 内核版本较低，官方完整版无法运行。此页面为针对 Chrome 80 特性魔改的兼容版本，并非 noVNC 官方出品。 |

### 核心约束

部署时需要特别注意以下现实情况：

1. **同班不同机**：受设备采购批次、固件版本、MDM 分批推送策略等因素影响，即使在同一班级内，不同学习机的 WebView 内核版本也可能不同；

2. **管理员可随时升级**：学校管理员可通过 MDM 或 OTA 渠道对学习机 WebView 进行版本升级，使用者无法预先获知升级时间与目标版本；

3. **设备升级前后状态变化**：一台今天能用 `vnc.html` 的设备，明天管理员推送升级后可能就变成了只能用 `vnc_compat.html` 的状态，反之亦然。

### 关于兼容版（vnc_compat.html）的重要说明

`vnc_compat.html` 是为 Chrome 80 WebView 适配的魔改版本，与 noVNC 官方发布的兼容页面不同，其特点和限制如下：

| 方面 | 说明 |
|------|------|
| **来源** | 针对学习机 Chrome 80 WebView 特性自行修改，非 noVNC 官方维护 |
| **兼容性** | 尽可能覆盖 Chrome 80 的特性边界，但无法保证在所有 Chrome 80 设备上完美运行 |
| **稳定性** | 魔改版本未经大规模测试，可能存在未知渲染异常或交互问题 |
| **维护状态** | 随学习机系统升级可能需要同步调整，不保证长期有效 |

> **建议**：在实际使用中，应优先引导学生使用 `vnc.html`（完整版）。只有在完整版白屏或报错时，才切换至 `vnc_compat.html` 作为兜底方案。兼容版可能存在未知问题，使用时需自行承担相应风险。

### 部署建议

1. **两个版本页面均部署**：在 noVNC 服务目录中同时保留 `vnc.html`（完整版）和 `vnc_compat.html`（魔改兼容版），并提供两个独立的访问入口；

2. **提供双链接引导**：在给学生的访问说明中同时提供两个链接，并注明：
   - **优先**：访问 `vnc.html`（完整版），若能正常显示画面则继续使用；
   - **备选**：若 `vnc.html` 白屏或报错，切换至 `vnc_compat.html`（兼容版）重试；

3. **禁用自动 UA 检测分配**：由于同班设备版本混杂，且无法保证 UA 检测规则的准确性，不建议使用自动重定向。让使用者手动选择是最稳妥的方案；

4. **定期测试**：建议定期对不同批次、不同型号的学习机进行交叉测试，确认两个版本页面的实际可用性；

5. **版本升级的应对**：若学校管理员推送 WebView 升级，需及时跟进测试，必要时调整兼容版的适配逻辑。

## 已知问题与注意事项

### c6 型号设备：noVNC 弹出键盘按钮不显示

经实测，**c6 型号学习机**在通过 noVNC 远控超脑时，noVNC 工具栏中的 **“弹出键盘”（Show Keyboard）按钮**无法正常显示，具体表现为：

| 问题 | 说明 |
|------|------|
| **现象** | noVNC 界面工具栏缺少“弹出键盘”按钮，学生无法通过点击按钮唤出软键盘进行输入 |
| **原因** | c6 型号设备系统固件与 noVNC 前端 UI 渲染存在兼容性问题，导致该按钮未被正确绘制 |
| **影响** | 学生无法在远控会话中输入文字、密码、进行文本编辑等键盘依赖操作 |

### 解决方案：使用超脑内置虚拟键盘

当 noVNC 弹出键盘按钮不显示时，可通过超脑电脑上的 Windows 虚拟键盘替代：

1. **在超脑上打开虚拟键盘**：
   - 方式一：任务栏右键 → 勾选“显示触摸键盘按钮”
   - 方式二：`Win + Ctrl + O` 快捷键快速打开屏幕键盘
   - 方式三：开始菜单搜索“屏幕键盘”或“On-Screen Keyboard”

2. **在 noVNC 会话中进行输入**：
   - 学生通过 noVNC 远控超脑时，超脑上的虚拟键盘会显示在屏幕中
   - 学生在 noVNC 画面中用鼠标点击虚拟键盘按键，即可完成输入

3. **操作流程示意**：
   ```
   学生在 noVNC 画面中点击输入框 → 超脑屏幕显示虚拟键盘 → 学生鼠标点击虚拟键盘按键 → 输入内容显示在输入框中
   ```

> **注意**：虚拟键盘会遮挡部分远控画面，建议将其拖动到屏幕边缘或调整透明度。若需频繁输入，建议优先使用非 c6 型号设备。

## 功能特性

| 特性 | 说明 |
|------|------|
| **零客户端** | 学生机无需安装任何软件，仅需浏览器即可访问 |
| **跨平台** | 支持 Windows、macOS、Linux、iPadOS 等任何有浏览器的设备 |
| **自动化脚本** | 提供测试、后台运行、开机自启、一键安装/卸载等完整脚本体系 |
| **多种自启方案** | 支持计划任务、NSSM 服务、注册表 Run 键三种方式 |
| **静默运行** | VBScript 实现完全无窗口闪烁的后台启动 |
| **预设参数** | 通过 `defaults.json` 预设连接参数，实现开箱即用 |
| **协议全覆盖** | 支持剪贴板共享、文件传输等高级功能 |

## 安全风险提示

本方案在实现越权的同时，也引入了严重的安全风险：

| 风险点 | 说明 |
|--------|------|
| **密码泄露** | VNC 密码在传输中以弱加密形式存在，可能被中间人截获 |
| **权限失控** | 一旦学生获得远控权限，可完全操作超脑，包括访问教师课件、教学数据等 |
| **恶意操作** | 学生可干扰教师正常授课，如关闭课件、重启系统等 |
| **无审计日志** | VNC 协议不提供操作审计功能，越权操作无法追溯 |

建议任何尝试本方案的使用者充分评估上述风险，并在非正式课堂环境中进行技术验证。

## 总结

在官方智慧课堂系统中，远控权限是严格按角色划分的：教师拥有、学生禁止。MDM 策略从应用管控、网络封锁、协议限制三个层面保障了这一权限分配的有效性。

然而，**任何权限系统的严密性都受限于其协议栈的设计边界**。DNS 解析与 WebSocket 作为标准网络栈的组成部分，其协议行为无法被选择性关闭。noVNC 正是利用这一特性，将 VNC 远控协议“Web”化，使学生仅通过浏览器便获得了本不属于他们的超脑远控权限。

本文介绍的魔改版 noVNC 进一步降低了部署门槛——通过自动化脚本、一键安装、开机自启、预设参数等优化，使得整个越权方案可以在数分钟内完成部署，且对学生完全透明。

与 Captive 配合使用时，两套方案共同构成了一条完整的越权链路：
- **Captive**：打通网络通路，绕过 40 网段封锁；
- **noVNC**：提供远控能力，绕过权限分配机制。

两者均不依赖客户端安装，均通过标准 Web 技术实现，均绕过了 MDM 的核心管控边界。本文所述方案揭示了权限系统设计中的一个普遍困境：**系统层策略再严密，也无法完全约束协议层的可达性**。

---

**项目地址**：[https://github.com/Nevino2333/noVNC](https://github.com/Nevino2333/noVNC)