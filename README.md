# MCSM-Plugin

基于 Yunzai-Bot v3 的 MCSManager + Minecraft 综合管理插件。合并了 Axiu-Plugin（面板重启/更新）、mcsmanager-plugin（实例/用户管理）、mctool-plugin（节点/文件/MC 服务器）的功能，统一代码风格与数据存储。

## 功能

- Yunzai 自管理 — MCSM API / 框架原生双路重启，Git 更新（含全部插件更新）
- 面板绑定 — 多面板绑定，自动同步实例列表
- 实例管理 — 启动/停止/重启/强制结束，日志查看，命令发送
- 用户管理 — 面板用户增删改查，权限修改，密码重置
- 节点管理 — 守护进程节点添加/删除/连接
- 面板概览 — 面板整体状态、用户列表
- 文件管理 — 文件浏览、下载
- MC 服务器 — MC 服务器列表、在线状态、MOTD 查询

## 安装

1. 在 Yunzai-Bot 根目录下执行：

```bash
git clone <仓库地址> ./plugins/MCSM-Plugin/
```

2. 无需额外安装依赖（使用 Node 18+ 内置 `fetch`，puppeteer/art-template/yaml 由框架提供）

3. 重启 Yunzai-Bot

## 指令列表

### 面板绑定

| 指令 | 说明 |
|------|------|
| `#mcsm绑定 <URL> <API密钥>` | 绑定 MCSManager 面板 |
| `#mcsm解绑` | 解绑面板 |
| `#mcsm绑定信息` | 查看绑定信息 |
| `#mcsm同步实例` | 同步实例列表 |

### 实例管理

| 指令 | 说明 |
|------|------|
| `#mcsm实例列表 [页码]` | 实例列表 |
| `#mcsm实例信息 <实例ID/序号>` | 实例详情 |
| `#mcsm启动 <实例ID/序号>` | 启动实例 |
| `#mcsm停止 <实例ID/序号>` | 停止实例 |
| `#mcsm重启 <实例ID/序号>` | 重启实例 |
| `#mcsm强制结束 <实例ID/序号>` | 强制结束（需确认） |
| `#mcsm日志 <实例ID/序号> [大小KB]` | 查看日志 |
| `#mcsm命令 <实例ID/序号> <命令>` | 发送命令 |

### 用户管理

| 指令 | 说明 |
|------|------|
| `#mcsm创建用户 <用户名> <密码> <权限>` | 创建用户（权限：1=用户, 10=管理员, -1=封禁） |
| `#mcsm删除用户 <用户名/ID>` | 删除用户 |
| `#mcsm修改权限 <用户名/ID> <权限值>` | 修改权限 |
| `#mcsm重置密码 <用户名/ID> <新密码>` | 重置密码 |

### 节点管理

| 指令 | 说明 |
|------|------|
| `#mcsm节点列表` | 节点列表 |
| `#mcsm添加节点 <IP> <端口> <API密钥> [备注]` | 添加节点 |
| `#mcsm删除节点 <序号>` | 删除节点 |
| `#mcsm连接节点 <序号>` | 连接节点 |

### 面板信息

| 指令 | 说明 |
|------|------|
| `#mcsm概览` | 面板概览 |
| `#mcsm用户列表 [页码]` | 面板用户列表 |

### 文件管理

| 指令 | 说明 |
|------|------|
| `#mcsm文件列表 <实例序号> [页码] [路径]` | 浏览文件 |
| `#mcsm下载文件 <实例序号> <文件路径>` | 下载文件 |

### Yunzai 自管理（仅 Master）

| 指令 | 说明 |
|------|------|
| `#重启` | 重启 Bot（MCSM API / 框架原生双路） |
| `#更新` | 更新 Bot |
| `#强制更新` | 强制更新（git reset --hard） |
| `#全部更新` | 更新 Bot 及所有插件 |
| `#更新日志` | 查看指定插件更新日志 |

### MC 服务器

| 指令 | 说明 |
|------|------|
| `#mc添加 <名称> <地址> [描述]` | 添加 MC 服务器（群管理员） |
| `#mc删除 <ID>` | 删除服务器（群管理员） |
| `#mc状态` / `#mc列表` | 服务器列表及状态 |
| `#mc在线` | 在线玩家列表 |
| `#mc motd <地址[:端口]>` | 查询服务器 MOTD |

### 帮助

| 指令 | 说明 |
|------|------|
| `#mcsm帮助` / `#mcsm菜单` | 帮助页面 |

## 配置

首次启动后，编辑 `plugins/MCSM-Plugin/config/config.yaml`：

```yaml
restart:
  enableMcsm: false          # 启用 MCSM 面板重启
  mcsmHost: '127.0.0.1'      # 面板地址
  mcsmPort: 23333            # 面板端口
  mcsmApiKey: ''             # API Key
  mcsmInstanceUuid: ''       # 云崽实例 UUID
  mcsmDaemonId: ''           # 守护进程 ID
  restartCron: []            # 定时重启 Cron
```

MC 服务器列表在 `config/mc-server.yaml`：

```yaml
servers:
  - name: '示例服务器'
    host: 'mc.example.com'
    port: 25565
    type: 'java'
```

也可通过锅巴后台（`guoba-plugin`）可视化配置重启管理段。

## 注意事项

1. MCSManager 面板操作需使用管理员账户的 API Key
2. 绑定后需执行 `#mcsm同步实例` 同步实例列表，否则实例操作可能失败
3. 请妥善保管 API Key，避免泄露
4. 建议使用 MCSManager 10.x 版本

## 鸣谢

本插件合并重构自以下三个项目，感谢原作者的贡献：

- [Axiu-Plugin](https://github.com/AxiuCN/Axiu-Plugin) — MCSManager 面板重启与 Bot 自更新
- [mcsmanager-plugin](https://github.com/A1Panda/mcsmanager-plugin) — 面板绑定、实例管理与用户管理
- [mctool-plugin](https://github.com/Dnyo666/mctool-plugin) — 节点管理、文件管理与 MC 服务器状态查询

## 交流与讨论

如有问题，请加入 QQ 群 **965272093** 交流反馈。

## 许可

[GPL-3.0](./LICENSE)
