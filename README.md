# local-cc-plugin-marketplace

在可联网的机器上下载 Claude Code 插件市场，导出为离线压缩包，在无法联网的内网环境中安装使用。

## 主要功能

- **下载 Marketplace**：输入 GitHub 地址，自动克隆 marketplace 仓库及其所有外部插件依赖
- **多分支管理**：同一仓库支持最多 5 个分支，每个分支独立管理
- **全源类型支持**：支持 `local`、`github`、`url`、`git-subdir`（sparse-checkout）四种插件源类型
- **子任务并行克隆**：外部插件以独立子任务形式克隆，最多 20 个并发 git 操作
- **实时进度**：显示 git 操作详细进度（Receiving objects、Resolving deltas 等）
- **智能解析**：自动解析 `marketplace.json`，支持仅有 `plugin.json` 的单插件仓库
- **元数据回退**：插件元数据优先从 `plugin.json` 读取，缺失时从 marketplace 条目回退
- **浏览插件**：以卡片形式查看已下载的 marketplace 及插件详情（名称、版本、作者、描述等）
- **导出离线包**：选择需要的 marketplace 和插件子集，打包为自包含的 zip 文件
- **离线安装**：解压到内网机器，运行安装脚本，按提示在 Claude Code 中执行安装命令

## 使用流程

### 联网环境（下载与导出）

**1. 安装依赖并启动**

```bash
npm install
npm run build
npm start
```

开发模式（热重载）：

```bash
npm run dev
```

服务默认运行在 http://localhost:3001

**2. 下载 Marketplace**

打开 Web 界面，在首页输入 GitHub 仓库地址（如 `https://github.com/owner/repo`），点击 **Add Marketplace**。系统会自动克隆 marketplace 及其所有外部插件，可在 **Tasks** 页面查看下载进度。

**3. 导出离线包**

进入 **Exports → New Export**，勾选需要导出的 marketplace 和插件，点击 **Start Export**。打包完成后点击 **Download** 下载 zip 文件。

### 内网环境（离线安装）

**1. 解压 zip 文件**到任意目录

**2. 运行对应平台的安装脚本**：

| 平台 | 脚本 |
|------|------|
| Windows CMD | `install.bat` |
| Windows PowerShell | `install.ps1` |
| Linux / macOS | `install.sh` |

脚本会输出需要在 Claude Code 中执行的命令，例如：

```
/plugin marketplace add C:\path\to\export\marketplace-name
```

**3. 在 Claude Code 中执行**上述命令即可完成安装。

## 技术栈

- **后端**：Node.js + TypeScript + Express + SQLite
- **前端**：React + TypeScript + Vite
- **异步**：Worker Threads（git 克隆、zip 打包）
- **实时进度**：Server-Sent Events (SSE)
- **分发方式**：`npm install && npm start`，无需 Docker

## 系统要求

- Node.js 19+
- Git（需在 PATH 中可用）
- 联网机器：能访问 GitHub
- 内网机器：仅需 Claude Code，无需联网

## License

[MIT](./LICENSE)
