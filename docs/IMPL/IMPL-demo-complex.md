# IMPL: demo-complex

### Suitability Assessment

Verdict: SUITABLE

test_command: `echo "Demo IMPL - no actual tests"`

lint_command: `echo "Demo IMPL - no linting"`

This is a demonstration IMPL doc designed to showcase SAW's UI capabilities with a complex multi-wave structure, intricate dependency graphs, and rich metadata across all sections.

The work decomposes into 3 waves with 11 total agents:
- **Wave 1** (4 agents): Core infrastructure - database schema, API foundation, auth middleware, cache layer
- **Wave 2** (4 agents): Feature modules depending on Wave 1 - user profiles (→A), payment processing (→A,B), notifications (→B), analytics (→C)
- **Wave 3** (3 agents): Integration layer - admin dashboard (→E,F,G), mobile API (→E,H), webhooks (→F,G,H)

Pre-implementation scan results:
- Total estimated time: ~87 min (3 waves × ~29 min avg, accounting for dependencies)
- Parallelism efficiency: 47% (11 agents would take ~121 min sequentially)
- Critical path: Wave 1[A] → Wave 2[E] → Wave 3[I] (longest dependency chain)

Recommendation: Clear win. The complex dependency structure still allows significant parallelism within each wave. Proceed.

---

### Scaffolds

| File | Contents | Import path | Status |
|------|----------|-------------|--------|
| `pkg/types/entities.go` | User, Payment, Notification, Event entity types | `github.com/example/demo/pkg/types` | committed |
| `pkg/api/contracts.go` | Request/response types for all API endpoints | `github.com/example/demo/pkg/api` | committed |
| `web/src/types/api.ts` | TypeScript interfaces matching Go API contracts | `@/types/api` | committed |

---

### Known Issues

**Database migration performance**
- Status: Pre-existing
- Description: Large-scale schema migrations (>1M rows) can cause table locks lasting 30+ seconds
- Workaround: Agent A should use `ALTER TABLE ... LOCK=NONE` for MySQL or `CREATE INDEX CONCURRENTLY` for Postgres

**Redis connection pooling**
- Status: Pre-existing
- Description: The existing cache client doesn't handle connection pool exhaustion gracefully under high load
- Workaround: Agent D should implement circuit breaker pattern with exponential backoff

**TypeScript strict mode violations**
- Status: Pre-existing
- Description: Legacy code has ~47 `@ts-ignore` comments that need gradual cleanup
- Workaround: Agents working on frontend should add proper types incrementally rather than fixing all at once

---

### Dependency Graph

```yaml type=impl-dep-graph
Wave 1 (4 parallel agents, all roots):

    [A] pkg/db/schema.go + migrations/
         (database schema: users, payments, notifications, events tables)
         ✓ root (no dependencies)

    [B] pkg/api/server.go + routes.go
         (API server foundation: routing, middleware chain, error handling)
         ✓ root (no dependencies)

    [C] pkg/auth/middleware.go
         (JWT validation, session management, RBAC helpers)
         ✓ root (no dependencies)

    [D] pkg/cache/redis.go
         (Redis client wrapper: get/set/delete with TTL, circuit breaker)
         ✓ root (no dependencies)

Wave 2 (4 parallel agents, depends on Wave 1):

    [E] pkg/users/profiles.go + web/src/pages/ProfilePage.tsx
         (user profile CRUD: bio, avatar, preferences)
         depends on: [A] (users table schema)

    [F] pkg/payments/stripe.go + webhook handlers
         (Stripe integration: checkout, subscriptions, invoice sync)
         depends on: [A] (payments table), [B] (API routes)

    [G] pkg/notify/email.go + push.go
         (notification delivery: email via SendGrid, push via FCM)
         depends on: [B] (API endpoints for send/status)

    [H] pkg/analytics/events.go
         (event tracking: capture, batch, send to Mixpanel)
         depends on: [C] (user context from auth middleware)

Wave 3 (3 parallel agents, depends on Wave 2):

    [I] web/src/pages/AdminDashboard.tsx + components/
         (admin UI: user list, payment reports, notification logs)
         depends on: [E] (profile API), [F] (payment API), [G] (notification API)

    [J] pkg/api/mobile/v1/
         (mobile-optimized endpoints: compressed responses, offline sync)
         depends on: [E] (profiles), [H] (analytics events)

    [K] pkg/webhooks/incoming.go + outgoing.go
         (webhook system: receive from Stripe, send to customer URLs)
         depends on: [F] (payment events), [G] (notification callbacks), [H] (analytics hooks)
```

Roots: [A], [B], [C], [D] (can start immediately)

Wave 2 dependencies:
- [E] → [A]
- [F] → [A], [B]
- [G] → [B]
- [H] → [C]

Wave 3 dependencies:
- [I] → [E], [F], [G]
- [J] → [E], [H]
- [K] → [F], [G], [H]

Leaf nodes: [I], [J], [K] (no downstream dependencies)

Cascade candidates (files that reference changed interfaces but are NOT in any agent's scope):
- `cmd/server/main.go` — wires together API server (Agent B), auth middleware (Agent C), and cache (Agent D)
- `pkg/jobs/worker.go` — background job system that uses notification (Agent G) and analytics (Agent H) APIs

---

### Interface Contracts

#### Database Schema (Agent A produces, Wave 2 consumes)

```go
// pkg/db/schema.go (Agent A creates)
package db

import "time"

type User struct {
    ID        int64     `db:"id" json:"id"`
    Email     string    `db:"email" json:"email"`
    Bio       string    `db:"bio" json:"bio"`
    AvatarURL string    `db:"avatar_url" json:"avatar_url"`
    CreatedAt time.Time `db:"created_at" json:"created_at"`
}

type Payment struct {
    ID             int64     `db:"id" json:"id"`
    UserID         int64     `db:"user_id" json:"user_id"`
    StripeID       string    `db:"stripe_id" json:"stripe_id"`
    AmountCents    int       `db:"amount_cents" json:"amount_cents"`
    Status         string    `db:"status" json:"status"` // pending, succeeded, failed
    CreatedAt      time.Time `db:"created_at" json:"created_at"`
}

type Notification struct {
    ID        int64     `db:"id" json:"id"`
    UserID    int64     `db:"user_id" json:"user_id"`
    Type      string    `db:"type" json:"type"` // email, push
    Title     string    `db:"title" json:"title"`
    Body      string    `db:"body" json:"body"`
    SentAt    *time.Time `db:"sent_at" json:"sent_at"`
    CreatedAt time.Time `db:"created_at" json:"created_at"`
}
```

#### API Routes (Agent B produces, Wave 2 consumes)

```go
// pkg/api/server.go (Agent B creates)
package api

import "net/http"

type Server struct {
    router *http.ServeMux
}

// RegisterRoutes allows other agents to register endpoint handlers
func (s *Server) RegisterRoutes(path string, handler http.HandlerFunc)

// WithAuth wraps a handler with JWT authentication (uses Agent C's middleware)
func (s *Server) WithAuth(handler http.HandlerFunc) http.HandlerFunc
```

#### Auth Middleware (Agent C produces, Wave 2 consumes)

```go
// pkg/auth/middleware.go (Agent C creates)
package auth

import (
    "context"
    "net/http"
)

type UserContext struct {
    UserID int64
    Email  string
    Roles  []string
}

// ExtractUser pulls authenticated user from request context
func ExtractUser(ctx context.Context) (*UserContext, error)

// RequireRole returns middleware that checks for specific role
func RequireRole(role string) func(http.Handler) http.Handler
```

#### Cache Interface (Agent D produces, Wave 2 consumes)

```go
// pkg/cache/redis.go (Agent D creates)
package cache

import (
    "context"
    "time"
)

type Client interface {
    Get(ctx context.Context, key string) (string, error)
    Set(ctx context.Context, key string, value string, ttl time.Duration) error
    Delete(ctx context.Context, key string) error
}

// NewClient creates a Redis client with connection pooling and circuit breaker
func NewClient(addr string) (Client, error)
```

#### Profile API (Agent E produces, Wave 3 consumes)

```go
// pkg/users/profiles.go (Agent E creates)
package users

type ProfileService interface {
    GetProfile(ctx context.Context, userID int64) (*Profile, error)
    UpdateProfile(ctx context.Context, userID int64, updates ProfileUpdate) error
}

type Profile struct {
    ID        int64  `json:"id"`
    Email     string `json:"email"`
    Bio       string `json:"bio"`
    AvatarURL string `json:"avatar_url"`
}
```

```typescript
// web/src/types/api.ts (Agent E creates - TypeScript side)
export interface Profile {
  id: number
  email: string
  bio: string
  avatar_url: string
}

export interface ProfileUpdate {
  bio?: string
  avatar_url?: string
}
```

#### Payment API (Agent F produces, Wave 3 consumes)

```go
// pkg/payments/stripe.go (Agent F creates)
package payments

type PaymentService interface {
    CreateCheckout(ctx context.Context, userID int64, amountCents int) (*CheckoutSession, error)
    ListPayments(ctx context.Context, userID int64) ([]Payment, error)
}
```

#### Notification API (Agent G produces, Wave 3 consumes)

```go
// pkg/notify/email.go (Agent G creates)
package notify

type NotificationService interface {
    SendEmail(ctx context.Context, userID int64, subject, body string) error
    SendPush(ctx context.Context, userID int64, title, body string) error
    GetHistory(ctx context.Context, userID int64) ([]Notification, error)
}
```

#### Analytics API (Agent H produces, Wave 3 consumes)

```go
// pkg/analytics/events.go (Agent H creates)
package analytics

type EventTracker interface {
    Track(ctx context.Context, userID int64, event string, properties map[string]interface{}) error
    Flush(ctx context.Context) error
}
```

---

### File Ownership

| File | Agent | Wave | Depends On |
|------|-------|------|------------|
| `pkg/types/entities.go` | Scaffold | 0 | - |
| `pkg/api/contracts.go` | Scaffold | 0 | - |
| `web/src/types/api.ts` | Scaffold | 0 | - |
| `pkg/db/schema.go` | A | 1 | - |
| `migrations/001_create_users.sql` | A | 1 | - |
| `migrations/002_create_payments.sql` | A | 1 | - |
| `migrations/003_create_notifications.sql` | A | 1 | - |
| `pkg/api/server.go` | B | 1 | - |
| `pkg/api/routes.go` | B | 1 | - |
| `pkg/api/errors.go` | B | 1 | - |
| `pkg/auth/middleware.go` | C | 1 | - |
| `pkg/auth/jwt.go` | C | 1 | - |
| `pkg/auth/rbac.go` | C | 1 | - |
| `pkg/cache/redis.go` | D | 1 | - |
| `pkg/cache/circuit.go` | D | 1 | - |
| `pkg/users/profiles.go` | E | 2 | A |
| `pkg/users/handlers.go` | E | 2 | A |
| `web/src/pages/ProfilePage.tsx` | E | 2 | A |
| `web/src/components/ProfileForm.tsx` | E | 2 | A |
| `pkg/payments/stripe.go` | F | 2 | A, B |
| `pkg/payments/webhooks.go` | F | 2 | A, B |
| `pkg/payments/handlers.go` | F | 2 | A, B |
| `pkg/notify/email.go` | G | 2 | B |
| `pkg/notify/push.go` | G | 2 | B |
| `pkg/notify/handlers.go` | G | 2 | B |
| `pkg/analytics/events.go` | H | 2 | C |
| `pkg/analytics/mixpanel.go` | H | 2 | C |
| `pkg/analytics/handlers.go` | H | 2 | C |
| `web/src/pages/AdminDashboard.tsx` | I | 3 | E, F, G |
| `web/src/components/UserList.tsx` | I | 3 | E, F, G |
| `web/src/components/PaymentReports.tsx` | I | 3 | E, F, G |
| `web/src/components/NotificationLogs.tsx` | I | 3 | E, F, G |
| `pkg/api/mobile/v1/profiles.go` | J | 3 | E, H |
| `pkg/api/mobile/v1/sync.go` | J | 3 | E, H |
| `pkg/api/mobile/v1/compress.go` | J | 3 | E, H |
| `pkg/webhooks/incoming.go` | K | 3 | F, G, H |
| `pkg/webhooks/outgoing.go` | K | 3 | F, G, H |
| `pkg/webhooks/handlers.go` | K | 3 | F, G, H |

---

### Wave Structure

```yaml type=impl-wave-structure
Wave 1:  [A] [B] [C] [D]    <- 4 parallel agents (all roots)
         |   |   |   |
       schema API auth cache

Wave 2:  [E] [F] [G] [H]    <- 4 parallel agents
         |   |   |   |
     profiles pay notify analytics
     ↑[A]  ↑[A,B] ↑[B] ↑[C]

Wave 3:  [I] [J] [K]         <- 3 parallel agents (all leaves)
         |   |   |
      admin mobile webhooks
      ↑[E,F,G] ↑[E,H] ↑[F,G,H]

(All agents in each wave complete, merge all N, verify, then proceed to next wave)
```

---

### Agent Prompts

#### Agent A — Database Schema & Migrations

**Role & mission:** You are Wave 1 Agent A. Design and implement the database schema for the platform's four core tables: `users`, `payments`, `notifications`, and `events`.

**Files you own:**
- `pkg/db/schema.go` — table structs and GORM model tags
- `migrations/001_initial_schema.sql` — idempotent migration with `IF NOT EXISTS`
- `migrations/002_indexes.sql` — composite indexes for common query patterns

**Key requirements:**
1. All tables must include `id` (UUID), `created_at`, `updated_at`, and `deleted_at` (soft delete) columns
2. Use `LOCK=NONE` for MySQL or `CREATE INDEX CONCURRENTLY` for Postgres to avoid table locks (see Known Issues)
3. Foreign keys: `payments.user_id → users.id`, `notifications.user_id → users.id`, `events.user_id → users.id`
4. The `events` table needs a JSONB `metadata` column for flexible event payloads

**Interface contracts:** Export the types defined in `pkg/db/entities.go` (scaffold). Wave 2 agents (E, F, G, H) will import these directly. Do not modify the scaffold file — implement against the interface it defines.

**Verification:** `go test ./pkg/db/... && go vet ./pkg/db/...`

#### Agent B — API Server Foundation

**Role & mission:** You are Wave 1 Agent B. Build the core HTTP server with routing, middleware chain, structured error responses, and health/readiness endpoints.

**Files you own:**
- `pkg/api/server.go` — server struct, `NewServer()`, `ListenAndServe()`
- `pkg/api/routes.go` — route registration, group prefixes (`/api/v1/`)
- `pkg/api/middleware.go` — logging, recovery, request ID, CORS
- `pkg/api/errors.go` — standard error response format `{error, code, request_id}`

**Key requirements:**
1. Use `chi` router for HTTP mux — lightweight, stdlib-compatible
2. Middleware chain order: RequestID → Logger → Recovery → CORS → (auth injected per-route by Wave 2)
3. Health endpoint `GET /healthz` returns `200` with `{"status":"ok","version":"..."}`
4. All error responses must include the `X-Request-ID` header for traceability
5. Graceful shutdown on SIGINT/SIGTERM with 30s timeout for in-flight requests

**Interface contracts:** Implement the `RouteRegistrar` interface from `pkg/api/contracts.go` (scaffold). Wave 2 agents will register their routes via this interface.

**Verification:** `go test ./pkg/api/... && go vet ./pkg/api/...`

#### Agent C — Auth Middleware

**Role & mission:** You are Wave 1 Agent C. Implement JWT token validation, session management, and role-based access control helpers.

**Files you own:**
- `pkg/auth/middleware.go` — `AuthRequired()` and `RoleRequired(roles ...string)` middleware
- `pkg/auth/jwt.go` — token parsing, claims extraction, key rotation support
- `pkg/auth/session.go` — session store interface with Redis-backed implementation
- `pkg/auth/rbac.go` — role definitions and permission checking

**Key requirements:**
1. JWT validation must support both HS256 (dev) and RS256 (production) algorithms
2. Claims must include: `sub` (user ID), `roles` (string array), `exp`, `iat`
3. Middleware injects `auth.UserContext` into request context via `context.WithValue`
4. Session store uses Redis with 24h TTL; supports explicit revocation
5. RBAC roles: `admin`, `user`, `viewer` — hierarchical (admin > user > viewer)

**Interface contracts:** Export `UserContext` and `AuthMiddleware` types defined in `pkg/auth/contracts.go` (scaffold). Agent H depends on `UserContext` for analytics event attribution.

**Verification:** `go test ./pkg/auth/... -count=1`

#### Agent D — Redis Cache Client

**Role & mission:** You are Wave 1 Agent D. Create the shared Redis client wrapper with connection pooling, circuit breaker, and typed get/set operations.

**Files you own:**
- `pkg/cache/redis.go` — client struct, connection pool, `Get`, `Set`, `Delete`, `SetWithTTL`
- `pkg/cache/circuit.go` — circuit breaker (closed → open → half-open state machine)
- `pkg/cache/options.go` — functional options pattern for client configuration

**Key requirements:**
1. Connection pool: min 5, max 50 connections, with health checks every 30s
2. Circuit breaker: opens after 5 consecutive failures, half-open after 10s, closes after 3 successes
3. All operations accept `context.Context` for cancellation/timeout propagation
4. Implement exponential backoff for reconnection (see Known Issues on pool exhaustion)
5. Support key namespacing via configurable prefix

**Interface contracts:** Implement the `CacheClient` interface from `pkg/cache/contracts.go` (scaffold). Wave 2 agents may use this for session caching and query result caching.

**Verification:** `go test ./pkg/cache/... -race`

#### Agent E — User Profiles

**Role & mission:** You are Wave 2 Agent E. Build user profile CRUD operations on the backend and the `ProfilePage` React component on the frontend.

**Files you own:**
- `pkg/users/profiles.go` — `ProfileService` with Create, Read, Update, Delete
- `pkg/users/handlers.go` — HTTP handlers wired to `ProfileService`
- `web/src/pages/ProfilePage.tsx` — profile view/edit form with avatar upload
- `web/src/hooks/useProfile.ts` — React Query hook for profile data

**Dependencies:** Agent A (users table schema), scaffold types from `pkg/db/entities.go`

**Key requirements:**
1. Profile fields: display name, bio (max 500 chars), avatar URL, preferences (JSON)
2. Avatar upload: accept PNG/JPEG up to 2MB, store via presigned S3 URL
3. Frontend form validates locally before submit; optimistic updates via React Query
4. Rate limit profile updates to 10/minute per user

**Verification:** `go test ./pkg/users/... && cd web && npx tsc --noEmit`

#### Agent F — Payment Processing

**Role & mission:** You are Wave 2 Agent F. Integrate Stripe for checkout sessions, subscription management, and webhook processing.

**Files you own:**
- `pkg/payments/stripe.go` — Stripe client wrapper, checkout session creation
- `pkg/payments/subscriptions.go` — plan management, upgrade/downgrade logic
- `pkg/payments/webhooks.go` — Stripe webhook signature verification and event routing
- `pkg/payments/handlers.go` — HTTP handlers for payment endpoints

**Dependencies:** Agent A (payments table), Agent B (API route registration)

**Key requirements:**
1. Webhook endpoint must verify Stripe signature before processing any event
2. Handle events: `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`
3. All payment mutations must be idempotent (use Stripe's `idempotency_key`)
4. Store payment records in the `payments` table with Stripe event ID for audit trail
5. Subscription tiers: `free`, `pro`, `team` — map to Stripe price IDs from config

**Verification:** `go test ./pkg/payments/... -run TestWebhook`

#### Agent G — Notifications

**Role & mission:** You are Wave 2 Agent G. Implement multi-channel notification delivery via email (SendGrid) and push (Firebase Cloud Messaging).

**Files you own:**
- `pkg/notify/email.go` — SendGrid client, template rendering, send queue
- `pkg/notify/push.go` — FCM client, device token management, payload builder
- `pkg/notify/dispatcher.go` — unified dispatch interface, channel routing logic
- `pkg/notify/handlers.go` — HTTP handlers for notification preferences and history

**Dependencies:** Agent B (API endpoints for send/status)

**Key requirements:**
1. `Dispatcher.Send(ctx, notification)` routes to email, push, or both based on user preferences
2. Email templates use Go `html/template` with precompiled template cache
3. Push notifications include deep link URLs for mobile navigation
4. All sends are async via goroutine pool (max 50 concurrent sends)
5. Record delivery status in `notifications` table: `queued → sent → delivered | failed`

**Verification:** `go test ./pkg/notify/... -count=1`

#### Agent H — Analytics Events

**Role & mission:** You are Wave 2 Agent H. Build the event tracking pipeline: capture user actions, batch them, and forward to Mixpanel.

**Files you own:**
- `pkg/analytics/events.go` — event types, `Track()` function, batching buffer
- `pkg/analytics/mixpanel.go` — Mixpanel API client, batch upload
- `pkg/analytics/middleware.go` — auto-track middleware for API requests
- `pkg/analytics/handlers.go` — admin endpoints for event replay and debugging

**Dependencies:** Agent C (auth middleware for user context extraction)

**Key requirements:**
1. Events include: `user_id` (from auth context), `event_name`, `properties` (map), `timestamp`
2. Batch buffer: flush every 30s or when buffer reaches 100 events, whichever comes first
3. Auto-track middleware logs: endpoint, method, status code, latency, user ID
4. Mixpanel client retries failed uploads 3x with exponential backoff
5. Event replay endpoint `POST /api/v1/analytics/replay` re-sends events for a time range

**Verification:** `go test ./pkg/analytics/... -race`

#### Agent I — Admin Dashboard

**Role & mission:** You are Wave 3 Agent I. Build the admin dashboard frontend with user management, payment reports, and notification audit logs.

**Files you own:**
- `web/src/pages/AdminDashboard.tsx` — main layout with sidebar navigation
- `web/src/components/admin/UserList.tsx` — searchable, paginated user table
- `web/src/components/admin/PaymentReports.tsx` — revenue charts, subscription breakdown
- `web/src/components/admin/NotificationLogs.tsx` — delivery status timeline

**Dependencies:** Agent E (profile API), Agent F (payment API), Agent G (notification API)

**Key requirements:**
1. Dashboard accessible only to `admin` role — redirect non-admins to 403 page
2. User list: search by name/email, sort by created date, bulk actions (suspend, delete)
3. Payment reports: MRR chart (last 12 months), churn rate, plan distribution pie chart
4. Notification logs: filter by channel (email/push), status (sent/failed), date range
5. All data fetched via React Query with 30s stale time; loading skeletons during fetch

**Verification:** `cd web && npx tsc --noEmit && npx vitest run`

#### Agent J — Mobile API

**Role & mission:** You are Wave 3 Agent J. Build mobile-optimized API endpoints with compressed responses, field selection, and offline sync support.

**Files you own:**
- `pkg/api/mobile/v1/profiles.go` — mobile profile endpoint with field selection
- `pkg/api/mobile/v1/sync.go` — delta sync endpoint using `updated_at` watermarks
- `pkg/api/mobile/v1/middleware.go` — gzip compression, ETag caching, API versioning

**Dependencies:** Agent E (profiles), Agent H (analytics events)

**Key requirements:**
1. All responses support `?fields=` parameter for sparse fieldsets (reduce payload size)
2. Delta sync: `GET /api/mobile/v1/sync?since=<timestamp>` returns only changed records
3. ETag-based conditional requests — return 304 if content unchanged
4. Response compression: gzip for payloads > 1KB
5. Track API usage via Agent H's analytics events (endpoint, device type, latency)

**Verification:** `go test ./pkg/api/mobile/... -run TestSync`

#### Agent K — Webhook System

**Role & mission:** You are Wave 3 Agent K. Implement bidirectional webhook system: receive events from Stripe and send events to customer-configured URLs.

**Files you own:**
- `pkg/webhooks/incoming.go` — receive and validate incoming webhooks (Stripe, GitHub)
- `pkg/webhooks/outgoing.go` — customer webhook delivery with retry queue
- `pkg/webhooks/registry.go` — webhook URL registration, secret management
- `pkg/webhooks/handlers.go` — CRUD endpoints for webhook configuration

**Dependencies:** Agent F (payment events), Agent G (notification callbacks), Agent H (analytics hooks)

**Key requirements:**
1. Incoming: verify signatures per provider (Stripe HMAC, GitHub SHA-256)
2. Outgoing: deliver to customer URLs with HMAC-SHA256 signature in `X-Webhook-Signature` header
3. Retry policy: 3 attempts with exponential backoff (1s, 10s, 60s), then mark failed
4. Webhook logs: store request/response for last 30 days, searchable by event type
5. Secret rotation: support two active secrets during rotation window

**Verification:** `go test ./pkg/webhooks/... -count=1`

---

### Orchestrator Post-Merge Checklist

**After Wave 1 completes (A + B + C + D):**

- [ ] Read all 4 agent completion reports — confirm all `status: complete`
- [ ] Conflict prediction — expect zero conflicts (disjoint file ownership)
- [ ] Merge Agent A: `git merge --no-ff wave1-agent-A -m "Merge wave1-agent-A: database schema"`
- [ ] Merge Agent B: `git merge --no-ff wave1-agent-B -m "Merge wave1-agent-B: API server foundation"`
- [ ] Merge Agent C: `git merge --no-ff wave1-agent-C -m "Merge wave1-agent-C: auth middleware"`
- [ ] Merge Agent D: `git merge --no-ff wave1-agent-D -m "Merge wave1-agent-D: Redis cache client"`
- [ ] Worktree cleanup: `git worktree remove` + `git branch -d` for each agent
- [ ] Post-merge verification: `echo "Demo IMPL - verification passed"`
- [ ] Tick A, B, C, D in Status table
- [ ] Proceed to Wave 2

**After Wave 2 completes (E + F + G + H):**

- [ ] Read all 4 agent completion reports
- [ ] Merge Agent E, F, G, H
- [ ] Verify cascade candidates: check `cmd/server/main.go` and `pkg/jobs/worker.go` still compile
- [ ] Tick E, F, G, H in Status table
- [ ] Proceed to Wave 3

**After Wave 3 completes (I + J + K):**

- [ ] Read all 3 agent completion reports
- [ ] Merge Agent I, J, K
- [ ] Final verification: full build + test suite
- [ ] Tick I, J, K in Status table
- [ ] Mark IMPL complete with E15 tag

---

### Status

| Wave | Agent | Description | Status |
|------|-------|-------------|--------|
| 1 | A | Database schema + migrations | TO-DO |
| 1 | B | API server foundation | TO-DO |
| 1 | C | Auth middleware (JWT, RBAC) | TO-DO |
| 1 | D | Redis cache client | TO-DO |
| 2 | E | User profiles (API + UI) | TO-DO |
| 2 | F | Payment processing (Stripe) | TO-DO |
| 2 | G | Notifications (email + push) | TO-DO |
| 2 | H | Analytics (Mixpanel) | TO-DO |
| 3 | I | Admin dashboard UI | TO-DO |
| 3 | J | Mobile API endpoints | TO-DO |
| 3 | K | Webhook system | TO-DO |
| — | Orch | Post-merge verification | TO-DO |
