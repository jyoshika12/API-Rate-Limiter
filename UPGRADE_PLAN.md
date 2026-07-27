# API Rate Limiter: Full-Stack Upgrade Proposal

## Goal

Turn the current learning demo into a production-shaped portfolio project that is easy to explain in an interview: a React + TypeScript dashboard, an Express + TypeScript API, PostgreSQL for durable data, Redis for fast distributed rate limiting, user authentication, securely stored API keys, Docker-based local development, automated tests and CI, cloud deployment, and monitoring. Vector search stays optional and should be added only after the core product is reliable.

The finished project should let a user sign up, create and revoke API keys, choose a rate-limit plan, send requests through a protected demo API, and inspect usage and limit decisions in a dashboard.

## What exists today

- `server.js`: Express 5 server on port 5000 with JSON parsing, permissive CORS, API-key middleware, and a Redis sorted-set sliding-window limiter.
- `apiKeyAuth.js` and `apikeys.js`: three hard-coded, plaintext keys and limits.
- `index.html`: a standalone HTML/CSS/JavaScript page that sends a selected plaintext key to `GET /` and displays remaining capacity and reset time.
- `package.json`: CommonJS JavaScript with `express`, `cors`, and `ioredis`; no development, lint, type-check, or real test scripts.
- `README.md`: short setup notes; it mentions Docker, but the repository has no Docker files.
- `index.js`: empty and currently unused.
- Redis is assumed to run with default connection settings. There is no PostgreSQL, authentication, validation, structured logging, health endpoint, deployment configuration, or CI.

Important current risks:

- `apiKeyAuth.js` imports `./apiKeys`, but the file is named `apikeys.js`. Windows accepts this; a case-sensitive Linux container is likely to fail. Standardize the filename during the TypeScript migration.
- Real secrets must never be offered in a browser dropdown or committed to source control. The current values are demo credentials and must be invalidated when database-backed keys arrive.
- The current limiter performs several Redis commands separately. Concurrent requests can race between incrementing, counting, and deciding. A Lua script should make the operation atomic.
- A timestamp is both the sorted-set score and member, so two requests for the same key in the same millisecond can overwrite one another. Use a unique member/request ID.
- The rejected request is added before the decision, so repeated rejected calls can extend pressure on the window. This behavior must be explicitly chosen and tested.
- The current key includes both API key and IP. That limits each key/IP pair, not the key globally. Make scope (`api_key`, `user`, `ip`, or route) an explicit policy decision.
- CORS is open, configuration is hard-coded, error bodies and rate-limit headers are not standardized, and Redis failure behavior is undefined beyond returning HTTP 500.
- Authentication and rate limiting run before every route; public health/readiness routes will need an explicit bypass.
- There are uncommitted changes in `server.js` and `index.html`. Preserve them and begin implementation only after the owner decides whether to commit them as the baseline.

## Proposed architecture

```text
Browser (React + TypeScript)
        |
        | HTTPS + secure session cookie
        v
Express API (TypeScript)
  |          |             |
  |          |             +--> OpenTelemetry / logs / error tracking
  |          +--> Redis: atomic rate-limit counters and short-lived cache
  +--> PostgreSQL: users, sessions, API-key metadata, plans, policies, usage events

External API client
        |
        | HTTPS + x-api-key
        v
Protected Express route --> authenticate key hash --> atomic Redis decision --> handler
```

Use a small monorepo rather than microservices:

```text
apps/
  web/                 React + Vite + TypeScript
  api/                 Express + TypeScript
packages/
  shared/              shared schemas/types only where genuinely useful
db/                    migrations and seed data
infra/                 deployment and monitoring configuration
```

Recommended implementation choices:

- npm workspaces, Node.js LTS, TypeScript in strict mode, ESLint, and Prettier.
- Vite, React Router, TanStack Query, and a modest component/CSS system for the frontend.
- Express 5, Zod validation, Prisma or Drizzle migrations, PostgreSQL, and `ioredis` for the API. Pick one ORM and explain the trade-off; do not introduce a repository abstraction unless it earns its keep.
- Server-managed sessions in secure, `HttpOnly`, `SameSite=Lax` cookies. Store only a session identifier in the cookie; store session state server-side. This is simpler to revoke safely than browser-stored JWTs. Add CSRF protection for state-changing cookie-authenticated requests.
- Passwords hashed with Argon2id. API keys generated from cryptographically secure random bytes, displayed once, and stored only as a keyed hash/HMAC plus a visible prefix and last four characters.
- Redis Lua script for an atomic sliding-window log initially. Document memory cost and compare it with fixed window, sliding-window counter, token bucket, and leaky bucket algorithms.
- Standard `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, and `Retry-After` response headers, plus a small JSON body for clients.

## Preservation strategy

1. First commit or otherwise preserve the current uncommitted `server.js` and `index.html` work as a known baseline.
2. Add characterization tests around the current behavior before changing its structure.
3. Move behavior in small slices: configure the server, migrate it to TypeScript, then replace hard-coded storage, then replace the UI.
4. Keep the original demo route working until the React dashboard has an equivalent request playground.
5. Avoid a simultaneous rewrite of UI, data model, authentication, and rate-limit logic. Every phase below should leave the main branch runnable.

## Phase 0 — Freeze and characterize the current demo

**Outcome:** A reproducible baseline with documented behavior, configuration, and known limitations. Resolve the user-owned working-tree changes before implementation; do not overwrite them.

**Request flow:** Browser opens the existing `index.html` -> user selects a demo key -> browser sends `GET /` with `x-api-key` -> middleware looks up the in-memory key -> Redis sorted-set operations calculate usage -> Express returns JSON -> browser updates its counter.

**Work:** Document supported Node/Redis versions and exact run commands. Add `.env.example` later (never `.env`) for `PORT`, `REDIS_URL`, and allowed origins. Export the Express app separately from the listening process so it can be tested. Add `/health/live` without dependencies and `/health/ready` that checks required dependencies. Standardize the `apiKeys` filename casing. Capture the current limit boundary and reset semantics as tests before changing them.

**Concepts to learn:** Express middleware order, CommonJS modules, environment-based configuration, liveness versus readiness, characterization tests, Linux case-sensitive paths.

**Tests:** Valid and missing API key; requests at, below, and above the limit; reset after 60 seconds using a fake clock; Redis unavailable; health routes do not require a key; a Linux/container startup smoke test catches casing errors.

**Suggested commit:** `test: characterize the existing rate limiter`

**Interview questions:** Why write tests before refactoring? Why are liveness and readiness separate? Why can code work on Windows but fail in a Linux container? Should a rate limiter fail open or fail closed when Redis is unavailable?

## Phase 1 — Create a TypeScript monorepo without changing behavior

**Outcome:** `apps/api` contains a strict TypeScript version of the existing Express behavior, while the current HTML demo still works.

**Request flow:** The request follows the same path as Phase 0, but typed configuration, typed request context, route modules, middleware, services, and centralized error handling make each responsibility explicit.

**Work:** Introduce npm workspaces, `apps/api`, `apps/web`, and `packages/shared`. Move the server in small commits. Define Express request augmentation for authenticated key context. Add Zod configuration validation at startup, consistent error responses, request IDs, graceful shutdown, and CORS allowlisting. Keep `index.html` available as a legacy demo until Phase 4.

**Concepts to learn:** TypeScript strictness, type narrowing, declaration merging, dependency boundaries, configuration validation, graceful shutdown, error middleware.

**Tests:** Type-check and lint; API characterization suite remains green; invalid configuration prevents startup with a useful message; unknown route returns a stable 404; unexpected errors do not leak stack traces.

**Suggested commit:** `refactor: migrate the Express API to strict TypeScript`

**Interview questions:** What bugs does strict TypeScript prevent here? Why separate `app` from `server`? What belongs in shared types, and why should database models not automatically be shared with the browser? How does Express 5 handle async errors?

## Phase 2 — Add PostgreSQL and a real domain model

**Outcome:** Durable users, plans, API-key metadata, policies, and usage summaries replace the hard-coded object.

**Request flow:** API receives a management request -> validates input -> authenticated user is authorized -> service reads/writes PostgreSQL in a transaction -> response DTO is returned. Protected traffic resolves the API-key prefix/hash to an active database record, then obtains the effective plan/policy.

**Work:** Add migrations and seeds for `users`, `sessions`, `plans`, `api_keys`, `rate_limit_policies`, and optionally aggregated `usage_events`. Include timestamps, unique constraints, foreign keys, revocation fields, and indexes based on actual lookups. Seed Free, Pro, and Admin-like plans without seeding usable production secrets. Decide whether raw high-volume request events belong in PostgreSQL; prefer aggregates or asynchronous ingestion so rate-limit decisions do not wait on analytics writes.

**Concepts to learn:** Relational modeling, normalization, foreign keys, indexes, migrations, transactions, connection pools, N+1 queries, data retention.

**Tests:** Migration up/down in a disposable database; unique email and key-prefix constraints; cascade/restrict behavior; transaction rollback; query integration tests; seed is idempotent; expired/revoked keys cannot authenticate.

**Suggested commit:** `feat: add PostgreSQL schema and persistence layer`

**Interview questions:** Why is PostgreSQL the source of truth while Redis is not? Which columns need indexes? When is a transaction required? Why avoid writing every request synchronously to PostgreSQL? How would the schema support organization/team ownership later?

## Phase 3 — Add user authentication and secure API-key lifecycle

**Outcome:** Users can register, log in, log out, list keys, create a key, rotate/revoke it, and never retrieve its full secret again.

**Request flow (dashboard authentication):** Browser submits credentials over HTTPS -> API validates -> Argon2id verifies the password -> API creates a server-side session -> browser receives a `Secure`, `HttpOnly`, `SameSite` cookie -> later management requests load the session and perform authorization.

**Request flow (API-key authentication):** Client sends `x-api-key: rl_live_<prefix>.<secret>` -> API parses the prefix -> loads a small candidate record -> computes an HMAC/hash and compares in constant time -> rejects revoked/expired keys -> attaches only safe key/user/policy identifiers to the request.

**Work:** Add register/login/logout/session endpoints, password rules, generic login errors, login throttling, CSRF protection, cookie security, and authorization checks that prevent one user from managing another user's keys. Generate keys using Node's cryptographic RNG. Show a new secret exactly once; store a server-side pepper outside the database and support pepper rotation/versioning. Redact authorization headers, cookies, and API keys from logs. Do not put API keys in URLs or `localStorage`.

**Concepts to learn:** Authentication versus authorization, sessions versus JWTs, password hashing, salts versus peppers, entropy, HMAC, constant-time comparison, CSRF, XSS, credential rotation, least privilege.

**Tests:** Register/login/logout; wrong-password response does not reveal account existence; session expiry and revocation; CSRF rejection; ownership authorization; generated keys have sufficient entropy and expected format; database never contains the raw secret; key shown once; valid, invalid, revoked, expired, and rotated key cases; sensitive-field log-redaction test.

**Suggested commit:** `feat: add secure sessions and API key management`

**Interview questions:** Why hash passwords with Argon2id? Why are API keys hashed or HMACed? Why include a lookup prefix? Why not store an access token in `localStorage`? What threats do `HttpOnly`, `Secure`, and `SameSite` address? How would pepper rotation work?

## Phase 4 — Replace the static page with a React + TypeScript dashboard

**Outcome:** A responsive dashboard covers sign-up/login, keys, plan/limits, usage, and an API playground. Remove the static demo only after feature parity.

**Request flow:** React route renders -> TanStack Query requests session/data with credentials -> API authorizes and returns DTOs -> query cache updates UI. For mutations, React validates basic input, sends a CSRF-protected request, invalidates relevant queries, and displays accessible success/error feedback. The playground uses the newly displayed key only when the user explicitly supplies it; it does not persist the secret.

**Work:** Use Vite and React Router. Build pages for login/register, overview, API keys, usage, and playground. Add loading, empty, error, 401/403, and rate-limited states. Read rate-limit response headers rather than inventing a separate countdown contract. Keep accessibility and mobile layouts in scope. Avoid global state until server state and small context providers prove insufficient.

**Concepts to learn:** Component composition, hooks, client routing, server state versus client state, caching/invalidation, controlled forms, accessibility, optimistic versus pessimistic updates, browser security boundaries.

**Tests:** Vitest/React Testing Library component tests for all states; MSW-backed login and key-management flows; keyboard navigation and accessible labels; key secret is not persisted; Playwright happy path from registration to key creation to rate-limited request; responsive smoke tests.

**Suggested commit:** `feat: add the React TypeScript management dashboard`

**Interview questions:** Why use TanStack Query instead of putting API data in global state? What is the difference between unit, component, and end-to-end tests? How do you prevent secret leakage in the UI? How do CORS and cookies interact? What causes stale UI and how is cache invalidation handled?

## Phase 5 — Make rate limiting correct under concurrency

**Outcome:** A documented, atomic, distributed limiter with predictable headers and policy scopes.

**Request flow:** Protected request -> authenticate hashed key -> resolve cached policy -> build a namespaced key containing environment, policy scope, route, and key/user identifier -> one Redis Lua invocation removes expired entries, conditionally inserts a unique request member, counts entries, and sets TTL -> script returns allowed/count/reset -> middleware sets standard headers -> handler runs or returns 429.

**Work:** Preserve the current sliding-window behavior first, then implement it atomically with Lua and a unique request ID. Define whether rejected attempts consume capacity, whether limits are global per key or include IP/route, and how weighted requests work. Add Redis key TTLs and versioned namespaces. Cache policies briefly with safe invalidation. Document a deliberate Redis outage policy: fail closed for sensitive/expensive endpoints; optionally fail open with local emergency limits for low-risk endpoints. Do not pretend in-process memory is globally consistent across replicas.

**Concepts to learn:** Race conditions, atomicity, Redis Lua, sorted sets, TTL, distributed systems, consistency, hot keys, clock behavior, algorithm/time-memory trade-offs, horizontal scaling.

**Tests:** Deterministic unit tests for boundary/reset math; real-Redis integration tests for TTL and Lua results; parallel request test proving the limit cannot be exceeded; same-millisecond requests remain distinct; separate keys/policies/routes do not collide; rejected-attempt behavior; Redis timeout/outage behavior; load test with k6 or Artillery reporting p50/p95/p99 latency and error rate.

**Suggested commit:** `feat: enforce atomic distributed rate limits with Redis`

**Interview questions:** Why was the original multi-command sequence racy? Why can timestamp members lose requests? Compare fixed window, sliding log, sliding counter, token bucket, and leaky bucket. What happens with multiple API replicas? What is a hot key? When should a limiter fail open?

## Phase 6 — Add production API design, analytics, and operational safety

**Outcome:** A versioned API with stable contracts, useful usage views, safer defaults, and predictable operations.

**Request flow:** Request ID enters at the edge -> security and size limits run -> authentication/authorization -> validation -> limiter -> route/service -> response envelope and standard headers -> structured log/metric emitted. Usage events are buffered or queued and aggregated separately from the decision path.

**Work:** Add `/api/v1`, OpenAPI documentation, request/response schemas, pagination, consistent error codes, payload limits, Helmet security headers, trusted-proxy configuration, timeouts, and explicit allowed origins. Add daily/hourly usage aggregates and dashboard charts. Add idempotency keys only to endpoints where retries can duplicate an operation. Define retention and deletion policies.

**Concepts to learn:** REST contracts, API versioning, OpenAPI, validation, pagination, idempotency, reverse proxies, security headers, asynchronous analytics, privacy and retention.

**Tests:** OpenAPI/schema contract tests; malformed and oversized body tests; pagination boundaries; authorization matrix; proxy/IP behavior; idempotent retry; aggregate accuracy; security-header checks; dependency timeout handling.

**Suggested commit:** `feat: version the API and add usage analytics`

**Interview questions:** Where should validation happen? How do idempotency keys differ from rate limits? Why trust only known proxies? How would analytics avoid slowing requests? When should an API introduce a new version?

## Phase 7 — Containerize local development and production builds

**Outcome:** One command starts web, API, PostgreSQL, and Redis locally; production images are small, non-root, and health-checked.

**Request flow:** Browser reaches the web container/reverse proxy -> `/api` is forwarded to the API container -> API uses service DNS to reach PostgreSQL and Redis -> health checks control readiness. In production, TLS terminates at the cloud load balancer or managed edge.

**Work:** Add multi-stage Dockerfiles, `.dockerignore`, and Compose services with named volumes and health checks. Run migrations as an explicit release job, not independently in every API replica. Use unprivileged users, pinned base-image versions/digests where practical, and runtime secrets rather than baking configuration into images. Provide development overrides with hot reload without changing production images.

**Concepts to learn:** Images versus containers, layers, build cache, multi-stage builds, networks, volumes, health checks, PID 1/signals, secret injection, immutable artifacts.

**Tests:** `docker compose config`; clean build; full-stack startup from an empty volume; readiness waits for dependencies; migration/seed smoke test; API/web end-to-end smoke test; graceful stop; image vulnerability scan.

**Suggested commit:** `build: containerize the full stack with Docker Compose`

**Interview questions:** Why use multi-stage builds? Why not put secrets in an image or Compose file? Why should migrations be a release job? What data survives container replacement? How does service discovery work in Compose?

## Phase 8 — Build a layered test strategy and GitHub Actions pipeline

**Outcome:** Every pull request gets fast, repeatable evidence that types, behavior, integration points, security basics, and builds are sound.

**Request flow (CI):** Push/PR -> install from lockfile -> lint/type-check/unit tests in parallel -> start PostgreSQL and Redis service containers -> run migrations and integration tests -> build web/API -> run selected Playwright smoke tests -> upload reports/artifacts -> dependency/image scans -> protected branch can merge only when required checks pass.

**Work:** Define unit, component, integration, contract, end-to-end, and load-test boundaries. Use isolated test databases and unique Redis prefixes. Add coverage thresholds based on risk, not a vanity 100%. Configure dependency caching, concurrency cancellation, least-privilege workflow permissions, pinned action versions, Dependabot/Renovate, CodeQL, secret scanning, and container scanning. Keep deployment in a separate workflow gated on successful CI and environment approval.

**Concepts to learn:** Test pyramid, test isolation, fakes versus real dependencies, deterministic clocks, CI caching, artifacts, supply-chain security, branch protection, deployment gates.

**Tests:** The pipeline itself runs lint, format check, strict type-check, unit/component tests, PostgreSQL/Redis integration tests, production builds, migration check, Playwright smoke test, dependency audit, CodeQL, and container scan. Run load tests on demand or nightly, not on every PR.

**Suggested commit:** `ci: add layered tests and GitHub Actions checks`

**Interview questions:** What should be mocked and what should be real? Why use service containers in CI? What makes a test flaky? Why pin GitHub Actions? Which checks should block a merge? Why keep load tests out of the normal PR path?

## Phase 9 — Deploy to cloud with safe releases

**Outcome:** A documented staging and production deployment using managed PostgreSQL and Redis, HTTPS, secrets management, backups, and rollback.

**Request flow:** DNS -> CDN/load balancer with TLS -> static React assets and/or web service -> API replicas -> managed PostgreSQL/Redis on private connections where supported. Deployment builds one immutable image, runs migration/release checks, rolls out healthy replicas, then performs a smoke test.

**Work:** Choose a simple platform such as Render, Railway, Fly.io, or AWS based on the interview target and budget; avoid adding Kubernetes merely for résumé keywords. Provision separate staging/production resources, secret management, database backups and point-in-time recovery where available, Redis eviction policy, TLS, custom domain, and budget alerts. Configure trusted proxy count correctly. Document rollback and restoration drills. Never use production credentials in CI pull-request jobs.

**Concepts to learn:** Twelve-factor configuration, managed services, TLS/DNS, private networking, horizontal scaling, zero/low-downtime deploys, migrations, backups, recovery objectives, infrastructure cost.

**Tests:** Staging migration and smoke test; health/readiness during rollout; HTTPS and CORS checks; key creation plus protected request end-to-end; backup restore drill; rollback rehearsal; replica/concurrency test; dependency failure drill.

**Suggested commit:** `ops: add staging and production deployment configuration`

**Interview questions:** Why managed PostgreSQL and Redis? How do you deploy schema changes safely? What is the rollback plan after a bad migration? What are RPO and RTO? Why is Kubernetes unnecessary here? How would you scale the API independently of Redis/PostgreSQL?

## Phase 10 — Add monitoring, alerting, and incident evidence

**Outcome:** Operators can answer: Is it up? Is it fast? Why was a request rejected? Which dependency is failing? Are credentials being attacked?

**Request flow:** Each request receives/carries a correlation ID -> API emits structured redacted logs, metrics, and traces -> telemetry collector/provider stores them -> dashboard shows traffic, latency, errors, saturation, 429s, Redis latency, and database-pool health -> alert routes to the chosen notification channel with a runbook link.

**Work:** Add Pino structured logs, OpenTelemetry traces/metrics, and an error tracker such as Sentry. Track request rate, error rate, duration, 429 decision count, policy lookup/cache behavior, Redis command latency/errors, PostgreSQL pool saturation, authentication failures, and key creation/revocation events. Do not label metrics with raw API keys, user IDs, IPs, or request IDs because that leaks data and creates high cardinality. Define SLOs and actionable alerts, dashboards, audit events, and short runbooks.

**Concepts to learn:** Logs/metrics/traces, RED and USE methods, correlation, cardinality, sampling, SLI/SLO/error budget, alert fatigue, audit logging, incident response.

**Tests:** Telemetry smoke test in staging; log-redaction regression; trace spans connect HTTP -> Redis/PostgreSQL; metric-label cardinality review; synthetic uptime check; force controlled Redis/database errors and verify alerts/runbooks; confirm monitoring failure does not break requests.

**Suggested commit:** `observability: add telemetry dashboards and alerts`

**Interview questions:** When do you use logs, metrics, or traces? Why are API keys dangerous metric labels? What would your first three alerts be? What is an SLO? How do you investigate a sudden rise in 429 responses? What should an audit log contain?

## Phase 11 (optional) — Add semantic/vector search only when it serves a feature

**Outcome:** Users can search API documentation, runbooks, or their own safe usage/error explanations semantically. This is an extension, not part of the rate-limit decision path.

**Request flow:** Admin ingests an allowed document -> worker chunks and embeds it -> text, metadata, ownership, and vector are stored in PostgreSQL with `pgvector` -> user query is authenticated and authorized -> query is embedded -> filtered similarity search returns only permitted rows -> API returns cited snippets. Rate-limit this endpoint separately because embeddings can be costly.

**Work:** Enable `pgvector` rather than adding a separate vector database at this scale. Store embedding model/version and content hash, process ingestion asynchronously, and re-embed safely when models change. Apply tenant/ownership filters inside the query, not after retrieval. Defend against prompt injection if an LLM later summarizes results. Keep raw secrets, API keys, passwords, and sensitive logs out of embeddings. Provide keyword or hybrid-search fallback and cost/latency metrics.

**Concepts to learn:** Embeddings, chunking, cosine distance, approximate nearest-neighbor indexes, recall versus latency, hybrid search, multi-tenant filtering, prompt injection, model/version migrations, evaluation.

**Tests:** Chunking and deduplication; tenant isolation; deleted/revoked documents disappear; deterministic retrieval evaluation set with recall@k/MRR; index versus exact-search comparison; model-version reindex path; injection/adversarial documents; embedding provider timeout and budget limits.

**Suggested commit:** `feat: add tenant-safe semantic documentation search`

**Interview questions:** Why use `pgvector` here instead of a dedicated vector database? How do chunk size and overlap affect retrieval? How do you prevent cross-tenant leaks? How do you measure retrieval quality? Why must vector search stay outside the limiter's critical path?

## Core data model proposal

| Table | Purpose | Important fields/constraints |
| --- | --- | --- |
| `users` | Account identity | unique normalized email, Argon2id password hash, role/status, timestamps |
| `sessions` | Revocable browser login | hashed session ID, user ID, expiry, last-used time; delete/revoke on logout |
| `plans` | Named commercial/default limits | unique name, active flag, display metadata |
| `rate_limit_policies` | Limit rules | plan ID, route/method/scope, algorithm, capacity, window/refill, priority |
| `api_keys` | Safe credential metadata | user ID, unique prefix, key digest, pepper version, name, last four, status, expiry, last used, revoked time |
| `usage_aggregates` | Dashboard analytics | key/policy ID, time bucket, allowed/rejected counts, optional latency totals; unique composite bucket |
| `audit_events` | Security/account history | actor, action, target, time, safe metadata; immutable/retained by policy |
| `documents` / `document_chunks` (optional) | Semantic search | owner, source, content hash, safe text, metadata, embedding model/version/vector |

Do not store raw passwords, raw API-key secrets, session tokens, or unnecessary full IP addresses. If abuse analysis needs IP data, define a short retention period and consider storing a keyed pseudonymous digest.

## Definition of done for the portfolio project

- A new developer can clone the repository and start the full stack with documented commands.
- Registration, login, logout, API-key create/list/revoke, the protected demo route, and usage dashboard work end to end.
- Raw API keys are shown once and are absent from the database, logs, repository, browser persistence, monitoring labels, and URLs.
- Parallel integration tests prove the Redis decision is atomic and bounded.
- PostgreSQL migrations, Redis key behavior, and failure modes are documented and tested.
- Type-check, lint, unit, component, integration, contract, and selected end-to-end tests pass in GitHub Actions.
- Production images run as non-root and the deployed app uses HTTPS, managed secrets, health checks, backups, and a tested rollback path.
- Dashboards and alerts cover latency, errors, traffic, 429s, Redis/PostgreSQL health, and authentication abuse without leaking sensitive data.
- The README contains an architecture diagram, setup instructions, API examples, design trade-offs, threat model, test strategy, live demo link, screenshots, and a short incident/runbook section.
- Optional vector search is clearly separated, authorized per tenant, evaluated for retrieval quality, and removable without changing the core limiter.

## Recommended delivery order

Complete Phases 0–5 first; together they demonstrate the strongest core engineering story. Then add production API polish and containers (Phases 6–7), CI and deployment (Phases 8–9), and monitoring (Phase 10). Add Phase 11 only if there is time and a convincing user-facing search use case. A reliable, well-tested limiter is a stronger interview project than a broad but fragile feature list.

No implementation should begin until this proposal is reviewed and approved.
