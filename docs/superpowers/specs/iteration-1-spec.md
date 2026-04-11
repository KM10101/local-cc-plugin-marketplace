# Iteration 1 设计规格文档

> 基于 PRD: `docs/prds/prd-iteration-1-20260411.md`
> 创建日期: 2026-04-11

## 一、设计决策

- **方案选型**：方案 A — 分支作为独立 marketplace 记录，每个分支对应一条 `marketplaces` 表记录
- **数据库约束**：不使用 FOREIGN KEY，关联关系和级联删除在应用层代码中处理
- **数据迁移**：不考虑，可直接删除已有数据
- **Clone 深度**：当前只处理 marketplace 直接引用的外部插件（一层），不递归。后续可通过配置控制递归深度
- **增量更新**：首次 `git clone`，后续 `git pull/fetch`，不重新全量 clone

---

## 二、数据库设计

### 2.1 `marketplaces` 表

```sql
CREATE TABLE IF NOT EXISTS marketplaces (
  id              TEXT PRIMARY KEY,
  repo_url        TEXT NOT NULL,
  branch          TEXT NOT NULL DEFAULT 'main',
  name            TEXT,
  local_path      TEXT,
  status          TEXT DEFAULT 'pending',
  description     TEXT,
  owner           TEXT,
  git_commit_sha  TEXT,
  last_updated    DATETIME,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(repo_url, branch)
);
```

变更点（对比现有）：
- `source_url` → `repo_url`（语义更清晰）
- 新增 `branch` 字段，默认 `main`
- 新增唯一约束 `(repo_url, branch)`
- 应用层校验：同 `repo_url` 下最多 5 个不同 branch

### 2.2 `plugins` 表

```sql
CREATE TABLE IF NOT EXISTS plugins (
  id              TEXT PRIMARY KEY,
  marketplace_id  TEXT NOT NULL,
  name            TEXT,
  version         TEXT,
  author          TEXT,
  author_url      TEXT,
  description     TEXT,
  keywords        TEXT,
  homepage        TEXT,
  license         TEXT,
  source_type     TEXT,
  source_url      TEXT,
  local_path      TEXT,
  status          TEXT DEFAULT 'pending',
  git_commit_sha  TEXT,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

变更点：无结构变更。`created_at` 已存在，前端新增展示。

### 2.3 `tasks` 表

```sql
CREATE TABLE IF NOT EXISTS tasks (
  id              TEXT PRIMARY KEY,
  parent_task_id  TEXT,
  type            TEXT NOT NULL,
  status          TEXT DEFAULT 'queued',
  marketplace_id  TEXT,
  repo_url        TEXT,
  branch          TEXT,
  plugin_id       TEXT,
  progress        INTEGER DEFAULT 0,
  message         TEXT,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at    DATETIME
);
```

变更点（对比现有）：
- 新增 `parent_task_id`：null = 父任务，非 null = 子任务
- 新增 `type: 'clone_plugin'`（子任务类型），现有 `'clone_marketplace'` 为父任务类型
- 新增 status 值：`queued`（排队等待）、`stopped`（手动停止）
- 完整 status 枚举：`queued` | `running` | `stopped` | `completed` | `failed`
- 新增 `repo_url`、`branch`：任务标题展示用
- 新增 `plugin_id`：子任务关联的插件
- 应用层校验：同 `(repo_url, branch)` 不允许有重复的 running/queued 任务

### 2.4 `exports` 表

```sql
CREATE TABLE IF NOT EXISTS exports (
  id                TEXT PRIMARY KEY,
  name              TEXT,
  status            TEXT DEFAULT 'packaging',
  progress          INTEGER DEFAULT 0,
  message           TEXT,
  selected_content  TEXT,
  zip_path          TEXT,
  zip_size          INTEGER,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at      DATETIME
);
```

变更点：无结构变更。`selected_content` 中的 marketplaceId 在方案 A 下天然对应特定分支。

---

## 三、任务系统设计

### 3.1 任务创建流程

```
用户添加 marketplace (repo_url + branch)
  → 创建父任务 (type=clone_marketplace, status=queued)
  → 调度器检查并发数
    → < 20: 启动 Worker，status → running
    → ≥ 20: 保持 queued，等待空位

Worker 执行:
  1. git clone/pull marketplace 仓库 → 父任务 progress 更新
  2. 解析 marketplace.json，识别外部插件
  3. 为每个外部插件创建子任务 (type=clone_plugin, status=queued)
  4. 子任务逐个提交到调度器（调度器决定立即执行还是排队）
  5. 每个子任务独立 clone/pull
  6. 全部子任务完成 → 父任务 status → completed
```

### 3.2 并发调度器

```typescript
class TaskScheduler {
  private maxConcurrent = 20;

  async enqueue(taskId: string) {
    const runningCount = db.count("tasks WHERE status = 'running'");
    if (runningCount < this.maxConcurrent) {
      this.startTask(taskId);  // status → running, 启动 Worker
    }
    // else: 保持 queued，等其他任务完成后触发
  }

  onTaskComplete(taskId: string) {
    const next = db.getFirst("tasks WHERE status = 'queued' ORDER BY created_at");
    if (next) this.startTask(next.id);
  }
}
```

关键点：
- 调度器在主线程维护，非 Worker 内部
- 计数粒度：每个独立的 git 操作（子任务级别）计为 1
- 父任务的 marketplace clone 本身也占 1 个并发位

### 3.3 停止与恢复

| 操作 | 行为 |
|------|------|
| 停止子任务 | `worker.terminate()`，status → `stopped`，已下载文件保留 |
| 停止父任务 | 停止所有 running 子任务，父任务 status → `stopped` |
| 恢复子任务 | status → `queued`，进入调度器排队 |
| 恢复父任务 | 恢复所有 stopped 子任务，父任务 status → `running` |

Worker 启动时的增量逻辑：
- 本地目录存在且是有效 git 仓库 → `git fetch + git checkout` / `git pull`（增量更新）
- 本地目录存在但不完整（clone 中断） → 删除后重新 `git clone`
- 本地目录不存在 → `git clone`

### 3.4 父任务进度计算

```
父任务 progress =
  (marketplace_clone_progress + Σ 子任务_progress) / (1 + 子任务数)
```

父任务 status 汇总规则：
- 任一子任务 `running` → 父任务 `running`
- 所有子任务 `completed` → 父任务 `completed`
- 所有子任务 `stopped`/`queued`（无 running）→ 父任务 `stopped`
- 任一子任务 `failed` 且无 `running` → 父任务 `failed`

---

## 四、API 设计

### 4.1 Marketplaces API

| 接口 | 方法 | 变更说明 |
|------|------|----------|
| `/api/marketplaces` | GET | 新增 query param `search`（名称模糊搜索）；返回新增 `branch` 字段 |
| `/api/marketplaces` | POST | body 新增 `branch`（可选，默认 main）；校验去重（repo_url+branch 唯一）、分支数 ≤ 5 |
| `/api/marketplaces/:id` | GET | 返回新增 `branch` 字段；新增 `siblings` 数组（同 repo_url 的其他分支信息） |
| `/api/marketplaces/:id/refresh` | POST | 不变，返回 task_id 用于前端追踪 |
| `/api/marketplaces/:id` | DELETE | 不变 |
| `/api/marketplaces/:id/plugins` | GET | 新增 query param `search`（插件名称搜索） |
| `/api/marketplaces/:id/branches` | POST | **新增** — 为已有仓库添加新分支 clone |
| `/api/marketplaces/repo-branches` | GET | **新增** — query param `repo_url`，返回同仓库已有分支列表 |

#### 错误码约定

| 场景 | HTTP 状态码 | 错误信息 |
|------|-------------|----------|
| repo_url + branch 已存在 | 409 Conflict | `"Marketplace with this URL and branch already exists"` |
| 同 repo_url 分支数达到 5 | 409 Conflict | `"Maximum 5 branches per repository"` |
| 同仓库同分支有 running/queued 任务 | 409 Conflict | `"A clone task for this repository and branch is already in progress"` |

### 4.2 Tasks API

| 接口 | 方法 | 变更说明 |
|------|------|----------|
| `/api/tasks` | GET | 新增 query param `search`（仓库名称搜索）；返回父子结构（父任务含 `children` 数组） |
| `/api/tasks/:id/events` | GET | 不变（SSE） |
| `/api/tasks/:id/stop` | POST | **新增** — 停止任务（父任务或子任务） |
| `/api/tasks/:id/resume` | POST | **新增** — 恢复已停止的任务 |
| `/api/tasks/:id` | DELETE | **新增** — 删除父任务，应用层级联删除子任务 |

### 4.3 Exports API

| 接口 | 方法 | 变更说明 |
|------|------|----------|
| `/api/exports` | GET | 新增 query param `search`（按插件名称搜索含该插件的导出包） |
| `/api/exports/:id` | GET | 返回新增 `plugins` 详情数组（名称、版本、marketplace 名称等） |
| `/api/exports` | POST | 不变 |
| `/api/exports/:id` | DELETE | 不变 |
| `/api/exports/:id/download` | GET | 不变 |
| `/api/exports/:id/events` | GET | 不变 |

---

## 五、前端设计

### 5.1 新增通用组件

| 组件 | 说明 |
|------|------|
| `ConfirmModal` | 自定义删除确认弹窗，替代 `window.confirm()`。包含标题、描述文本、确认/取消按钮，确认按钮为红色（危险操作） |
| `Toast` | 操作结果消息提示。支持 success / error 类型，自动消失（3秒），右上角定位 |
| `SearchInput` | 可复用搜索输入框，带清除按钮，支持 debounce |

### 5.2 Marketplaces 页面

#### MarketplaceList（列表页）

- **添加表单**：URL 输入框 + 分支名输入框（可选，placeholder "main"）
- **去重提示**：后端返回 409 时，Toast 提示"该仓库分支已存在"
- **分组展示**：MarketplaceCard 按 `repo_url` 分组，同仓库多分支卡片归在一起
- **Refresh 按钮**：点击后变为 loading spinner + disabled，任务完成后恢复
- **搜索栏**：顶部搜索框，按 marketplace 名称实时过滤（前端过滤或后端 search param）

#### MarketplaceDetail（详情页）

- **分支信息**：显示当前分支名
- **分支管理**：显示同仓库所有分支列表，支持：
  - 添加新分支（输入分支名 → 调用 `POST /api/marketplaces/:id/branches`）
  - 切换查看其他分支（导航到对应分支的 marketplace 详情）
  - 删除分支（删除对应的 marketplace 记录）
  - 分支数达 5 个时，添加按钮禁用
- **插件搜索**：插件列表上方搜索框，按插件名称过滤
- **PluginCard 增强**：显示 `created_at`（clone 时间）和 `source_url`（仓库地址）

### 5.3 Tasks 页面

#### TaskList

- **父子层级展示**：
  - 父任务行：显示仓库名称 + 分支名 + 整体进度 + 状态
  - 可折叠/展开子任务列表
  - 子任务行：缩进展示，显示插件名 + 独立进度 + 状态
- **操作按钮**：
  - running 任务：显示"停止"按钮
  - stopped/failed 任务：显示"恢复"按钮
  - 父任务：额外显示"删除"按钮（ConfirmModal 确认）
- **queued 状态**：显示排队标识（如 StatusBadge 新增 queued 类型）
- **搜索栏**：按仓库名称搜索
- **防重复**：同仓库同分支已有 running/queued 任务时，Marketplaces 页面的 Refresh 按钮禁用

### 5.4 Exports 页面

#### ExportList（列表页）

- **插件详情展示**：每条导出记录可展开查看包含的插件列表（名称、版本）
- **搜索栏**：按插件名称搜索，匹配含该插件的导出包

#### ExportNew（创建导出页）

- **分支选择**：每个 marketplace 显示分支下拉菜单，用户选定后加载该分支的插件列表
- **Marketplace 折叠**：每个 marketplace 节点默认折叠，可展开查看插件列表
- **插件搜索**：搜索框输入插件名，自动展开匹配的 marketplace 并高亮定位
- **插件状态**：
  - `ready` 状态：正常可勾选
  - 非 `ready` 状态（pending/cloning/error）：灰置 + 禁止勾选 + 显示 StatusBadge
- **汇总面板**：右侧显示已选 marketplace 数、插件数、启动导出按钮

#### ExportDetail（详情页）

- 显示包含的插件完整信息（名称、版本、所属 marketplace、分支）

### 5.5 StatusBadge 扩展

新增支持的状态值：
- `queued` — 灰色/蓝色，排队中
- `stopped` — 黄色/橙色，已停止

---

## 六、文件变更范围预估

### 后端

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `server/db.ts` | 修改 | 表结构更新（marketplaces 加 branch，tasks 加父子结构） |
| `server/types.ts` | 修改 | 类型定义更新 |
| `server/services/marketplace-service.ts` | 修改 | 分支管理逻辑、去重校验 |
| `server/services/task-scheduler.ts` | **新增** | 并发调度器 |
| `server/routes/marketplaces.ts` | 修改 | 新增 branches 相关路由、search 参数 |
| `server/routes/tasks.ts` | 修改 | 新增 stop/resume/delete 路由、父子结构查询 |
| `server/routes/exports.ts` | 修改 | search 参数、插件详情返回 |
| `server/workers/clone-worker.ts` | 修改 | 子任务创建、增量 clone 逻辑 |

### 前端

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `client/src/types.ts` | 修改 | 类型定义更新 |
| `client/src/api.ts` | 修改 | 新增 API 调用方法 |
| `client/src/components/ConfirmModal.tsx` | **新增** | 删除确认弹窗 |
| `client/src/components/Toast.tsx` | **新增** | 消息提示组件 |
| `client/src/components/SearchInput.tsx` | **新增** | 搜索输入框 |
| `client/src/components/StatusBadge.tsx` | 修改 | 新增 queued/stopped 状态 |
| `client/src/components/PluginCard.tsx` | 修改 | 显示 created_at 和 source_url |
| `client/src/components/MarketplaceCard.tsx` | 修改 | 分支信息展示 |
| `client/src/pages/MarketplaceList.tsx` | 修改 | 添加表单、分组展示、搜索、Refresh 防重复 |
| `client/src/pages/MarketplaceDetail.tsx` | 修改 | 分支管理、插件搜索 |
| `client/src/pages/TaskList.tsx` | 修改 | 父子层级、折叠、停止/恢复/删除 |
| `client/src/pages/ExportList.tsx` | 修改 | 插件详情展开、搜索 |
| `client/src/pages/ExportNew.tsx` | 修改 | 分支选择、折叠、搜索、状态禁用 |
| `client/src/pages/ExportDetail.tsx` | 修改 | 插件完整信息 |

### 测试

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `tests/db.test.ts` | 修改 | 新表结构测试 |
| `tests/routes/marketplaces.test.ts` | 修改 | 分支相关路由测试 |
| `tests/routes/tasks.test.ts` | 修改 | 父子任务、stop/resume 测试 |
| `tests/routes/exports.test.ts` | 修改 | search、插件详情测试 |
| `tests/task-scheduler.test.ts` | **新增** | 调度器单元测试 |
