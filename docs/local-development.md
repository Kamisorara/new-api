# 本地开发启动指南

本指南介绍如何在本地**分别启动 Go 后端与前端**，并让前端连到后端进行开发。

---

## 架构总览

开发时，前后端各自独立运行，通过代理打通：

```
浏览器
  │  访问 http://localhost:5173（前端 dev server）
  ▼
Rsbuild dev server（前端，React 19）
  │  proxy：/api  /mj  /pg  → http://localhost:3000
  ▼
Go 后端（Gin，:3000）──→ SQLite / MySQL / PostgreSQL + Redis
```

- 前端 `src/lib/api.ts` 中 `baseURL = ''`（同源请求）
- Rsbuild dev server 把 `/api`、`/mj`、`/pg` 三个前缀反代到 `VITE_REACT_APP_SERVER_URL`，默认 `http://localhost:3000`
- 后端默认端口 `3000`（由根目录 `.env` 的 `PORT=3000` 决定）

两边各自热更新，互不影响。

---

## 前置条件

| 工具 | 用途 | 说明 |
|---|---|---|
| **Go 1.22+** | 跑后端 | |
| **Bun** | 跑前端 | 项目首选包管理器（替代 npm/yarn/pnpm） |
| **Git** | 拉代码 | |

可选：PostgreSQL / MySQL / Redis（不装则默认用 SQLite，零配置）。

---

## 方式 A：分别跑前后端（推荐，最贴近实际开发）

### 1. 准备前端依赖（仅首次）

```bash
cd web
bun install
```

> 后端通过 `//go:embed` 嵌入 `web/default/dist`，编译时该目录必须存在。
> 首次克隆仓库时它不存在，**先跑一次前端构建**生成 `dist`，之后开发期间就不再需要重复构建：
>
> ```bash
> cd web/default
> bun run build        # 生成 web/default/dist
> ```

### 2. 启动 Go 后端（端口 3000）

**在项目根目录**开一个终端：

```bash
go run main.go
```

- 监听 `:3000`（`.env` 里 `PORT=3000`）
- 数据库默认走 SQLite（`.env` 里 `SQLITE_PATH=../new-api-custom.db`），无需额外配置
- 启动成功后日志会打印 `New API ... started` 及访问地址

如需编译为二进制：

```bash
go build -o new-api
./new-api
```

### 3. 启动前端 dev server（端口 5173）

**在 `web/default/` 目录**另开一个终端：

```bash
cd web/default
bun run dev
```

- 端口由 `rsbuild.config.ts` 的 `server.port` 控制：读取 `PORT` 环境变量，**默认 5173**（与后端 3000 不冲突，无需手动指定）
- 启动后终端会打印地址，如 `http://localhost:5173`，**浏览器访问该地址**

> **只访问 5173（前端 dev server），不要访问 3000（后端）。**
> 3000 是 Go 后端，只用于 API；前端 dev server 在 5173，带 HMR 热更新，发出的 `/api`、`/mj`、`/pg` 请求会自动代理到后端。

### 4. 验证连通

浏览器打开 **http://localhost:5173**，能看到登录页/初始化向导即说明前端 ↔ 后端打通。

---

## 端口与后端地址的自定义

> 注意区分两个 `PORT`：
> - **后端端口**：根目录 `.env` 的 `PORT`（默认 `3000`），控制 Go 服务监听地址
> - **前端 dev server 端口**：`rsbuild.config.ts` 读 `web/default/.env.local` 的 `PORT`（默认 `5173`）
>
> 两者独立，各自读取自己目录下的环境文件，互不影响。

### 后端不在 3000

若改了后端端口（修改根目录 `.env` 的 `PORT`，例如 `PORT=8080`），前端代理目标也要跟着改。
在 `web/default/` 下新建 `.env.local`：

```bash
# web/default/.env.local
VITE_REACT_APP_SERVER_URL=http://localhost:8080
```

Rsbuild 会把 `/api`、`/mj`、`/pg` 反代到这个地址。

### 使用其它数据库 / Redis

编辑根目录 `.env`（或用环境变量覆盖）：

```bash
# MySQL
SQL_DSN=user:password@tcp(127.0.0.1:3306)/new-api?parseTime=true

# PostgreSQL
SQL_DSN=postgres://user:password@127.0.0.1:5432/new-api

# Redis
REDIS_CONN_STRING=redis://localhost:6379/0
```

---

## 方式 B：Docker 一键开发环境

项目自带 `Makefile` + `docker-compose.dev.yml`，可用 Docker 同时拉起 API（PostgreSQL）和前端 dev server：

```bash
make dev             # 启动 dockerized API + 默认前端 dev server
```

常用细分命令：

| 命令 | 作用 |
|---|---|
| `make dev-api` | 仅启动 dockerized API（PostgreSQL） |
| `make dev-web` | 仅启动默认前端 dev server（端口 5173） |
| `make dev-web-classic` | classic 主题前端 dev server（端口 5174） |
| `make build-web` | 构建默认前端 |
| `make build-all-web` | 构建所有前端 |
| `make reset-setup` | 清除 setup 向导状态和 root 用户（本地重新初始化） |

---

## 常见问题

### `go run main.go` 报 `pattern web/default/dist: no matching files found`

`//go:embed web/default/dist` 要求该目录存在且非空。先构建一次前端：

```bash
cd web/default && bun run build
```

之后开发期间 `dist` 一直都在，无需重复构建。

### 前端启动后访问页面报 404 / 接口 404

- 确认后端已先启动并在 `:3000`
- 确认前端访问的是 **dev server 地址**（如 `http://localhost:5173`），而不是后端的 `:3000`
- 若后端端口非 3000，按上文「后端不在 3000」配置 `web/default/.env.local`

### 重新走 setup 初始化流程

```bash
make reset-setup        # Docker 方式
# 或手动删除 SQLite 文件后重启后端
```

---

## 速查

```bash
# 终端 1：后端（项目根目录）
go run main.go                  # 监听 :3000

# 终端 2：前端（web/default 目录）
cd web/default
bun run dev                     # 监听 :5173（无需手动指定端口）
```

浏览器访问 **http://localhost:5173**（不要访问 3000）。

> 首次运行前，需先 `cd web/default && bun run build` 生成 `dist`，否则 `go run main.go` 因 `//go:embed` 失败。
