# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Detailed project conventions, coding rules, billing-safety invariants, and governance live in **`AGENTS.md`** (root) and **`web/default/AGENTS.md`** (frontend). Read them — this file does not repeat them. What follows is the build/test commands and the runtime architecture those files don't cover.

## Build & Development Commands

### Go backend (repo root)

| Task | Command |
|---|---|
| Run server locally | `go run main.go` (frontends must be built first — see coupling note below) |
| Build binary | `go build -o new-api` |
| Bake the version into the binary | add `-ldflags "-X 'github.com/QuantumNous/new-api/common.Version=$(cat VERSION)'"` |
| All tests | `go test ./...` |
| One package's tests | `go test ./relay/common/...` |
| One test | `go test ./relay/common -run TestRelayInfo -v` |
| Lint / vet | `go vet ./...` |

SQLite uses the pure-Go `glebarez/sqlite` driver, so **CGO is not required** (`CGO_ENABLED=0` builds fine, as in `Dockerfile`). There is no `golangci-lint` config; `go vet` is the linter. New/rewritten backend tests use `testify/require` for fatal assertions and `testify/assert` for non-fatal checks (see `AGENTS.md`).

### Frontend (`web/default/`, default theme — React 19 + Rsbuild)

Run scripts from `web/default/`. Install at the workspace root: `cd web && bun install` (or `bun install --filter ./default`).

| Task | Command |
|---|---|
| Dev server | `bun run dev` |
| Production build | `bun run build` |
| Type check | `bun run typecheck` (run after every TS/TSX change; must be clean) |
| Lint | `bun run lint` / `bun run lint:fix` (oxlint — fix all errors in touched files before finishing) |
| Format | `bun run format` / `bun run format:check` |
| i18n sync | `bun run i18n:sync` |
| Copyright headers | `bun run copyright` / `bun run copyright:check` |
| Find unused exports | `bun run knip` |

`web/classic/` is the React 18 / Semi Design theme with its own `package.json` and equivalent scripts.

### Make & Docker (repo root)

`make dev` spins up the dockerized API (PostgreSQL via `docker-compose.dev.yml`) **and** the default web dev server. Granular targets: `make dev-api` (docker API), `make dev-web` (port 5173), `make dev-web-classic` (5174), `make build-web` / `build-web-classic` / `build-all-web`, `make all` (build all web + run API). `make reset-setup` clears the setup-wizard state and root users for local re-onboarding (PostgreSQL or local SQLite).

### Frontend ↔ binary coupling (gotcha)

`main.go` `//go:embed`s `web/default/dist` and `web/classic/dist`. Both dirs are gitignored and absent in a fresh clone, so **`go build` / `go run main.go` fails until you build the frontends** — the embed pattern must match files. Run `make build-all-web` (or `make build-web`) first.

## Architecture

Layered `router → controller → service → model`; directory layout and tech stack are in `AGENTS.md`. The non-obvious, cross-file parts:

### Startup (`main.go`)

`InitResources()` bootstraps in order: `.env` → `common.InitEnv` → logger → ratio settings → HTTP client → token encoders → `model.InitDB` → **casbin authorization** (`service/authz.Init`) → options → pricing → log DB → Redis → i18n → custom OAuth providers. Gin then mounts middleware (`RequestId`, `Version`, `I18n`, logging, cookie sessions) and embeds both frontend SPAs. Background goroutines: channel-cache + ability sync, option hot-reload, **authz policy sync** (multi-node consistency), quota dashboard, the **system task runner** (scheduled channel tests, model updates, async task polling — DB-leased, master-only), Codex credential refresh, subscription quota reset, and an instance reporter. Graceful shutdown waits on in-flight SSE streams (up to `SHUTDOWN_TIMEOUT_SECONDS`, default 120).

### Routing (`router/`)

`SetRouter` wires `api-router` (management REST), `relay-router` (AI proxy — the core), `video-router`, `web-router` (serves the embedded SPA + static assets), `dashboard`, and `authz-router` (casbin permission queries).

### Relay pipeline (how an AI request flows)

```
HTTP request
  → router/relay-router.go
  → middleware (auth, rate-limit, DISTRIBUTION: picks a channel by model+group via the model/ability table)
  → relay/*_handler.go   (parses DTO: ChatCompletions / Claude / Gemini / Responses / Image / Embedding / Rerank / Audio)
  → relay/helper         (valid_request bounds, EstimateBilling/price, token counting)
  → relay.GetAdaptor(apiType)   ← relay/relay_adaptor.go: APIType → channel adaptor
  → channel.Adaptor             ← relay/channel/adapter.go interface
       Init → GetRequestURL → SetupRequestHeader
            → ConvertOpenAIRequest | ConvertClaudeRequest | ConvertGeminiRequest | ConvertImageRequest | …
            → DoRequest → DoResponse (streams back to client + computes usage)
  → settle quota against the pre-charge
```

- **`channel.Adaptor`** (`relay/channel/adapter.go`) is the per-provider contract — one subdir under `relay/channel/` per provider (openai, claude, gemini, aws, vertex, …). Implementations translate between the client's API format and the upstream's, so conversion is bidirectional (OpenAI ⇄ Claude ⇄ Gemini). Adding a provider = a new `relay/channel/<name>/` package + a `case` in `GetAdaptor` + an `APIType`/`ChannelType` constant in `constant/`.
- **`channel.TaskAdaptor`** covers async work (Midjourney / Suno / video): submit → poll → terminal, with billing hooks `EstimateBilling` / `AdjustBillingOnSubmit` / `AdjustBillingOnComplete` that settle the pre-charge delta against actual upstream parameters.
- **`relay/common.RelayInfo`** is the per-request context threaded through the whole pipeline.
- **Billing** turns usage → tokens → quota through `common/quota_math.go` (centralized truncation / rounding / saturation — never bare `int()` casts on quota) and `types.PriceData` ratio maps (added only via `AddOtherRatio`, which rejects non-positive/NaN/Inf). Tiered / expression pricing lives in `pkg/billingexpr/` — **read `pkg/billingexpr/expr.md` before touching it.** The full billing-safety invariants (no negative charges, bounded multipliers, audited saturation via the `*Checked` helpers + `attachQuotaSaturation`) are in `AGENTS.md` and must be preserved on every billing path.
