# IMPL: add-caching-layer

**Feature:** Add an in-memory caching layer to reduce redundant database reads
**Suitability:** suitable
**Test command:** `go test ./...`

---

## Wave 1 — Cache infrastructure

Two agents work in parallel. Agent A owns the cache interface and in-memory implementation; Agent B owns the integration into the existing data layer.

### Agent A — Cache interface and implementation

**Goal:** Define the `Cache` interface and provide an in-memory LRU implementation.

**Owned files:**
| File | Action |
|------|--------|
| `pkg/cache/cache.go` | create |
| `pkg/cache/lru.go` | create |
| `pkg/cache/cache_test.go` | create |

**Interface contracts:**
```go
// Cache is the storage abstraction used by the data layer.
type Cache interface {
    Get(key string) (value any, ok bool)
    Set(key string, value any, ttl time.Duration)
    Delete(key string)
}

// NewLRU returns an LRU-backed Cache with the given capacity.
func NewLRU(capacity int) Cache
```

**Dependencies:** none

**Out of scope:** HTTP-level caching, cache warming, persistence

---

### Agent B — Data layer integration

**Goal:** Wire the `Cache` interface into the existing `Store` so reads check the cache before hitting the database.

**Owned files:**
| File | Action |
|------|--------|
| `pkg/store/store.go` | modify |
| `pkg/store/store_test.go` | modify |

**Interface contracts:**

Consumes `cache.Cache` (defined by Agent A). `Store` constructor gains an optional cache parameter:

```go
// New returns a Store. If c is nil, no caching is performed.
func New(db *sql.DB, c cache.Cache) *Store
```

**Dependencies:** Agent A (pkg/cache)

**Out of scope:** Cache eviction policy, metrics

---

### Agent A — Completion Report

**Status:** complete

**Files changed:**
- `pkg/cache/cache.go` (created, +42/-0 lines)
- `pkg/cache/lru.go` (created, +88/-0 lines)
- `pkg/cache/cache_test.go` (created, +61/-0 lines)

**Interface deviations:** none

**Verification:**
- [x] Build passed: `go build ./...`
- [x] Tests passed: `go test ./pkg/cache/`

**Commits:**
- `a1b2c3d`: implement Cache interface and LRU backend

---

### Agent B — Completion Report

**Status:** complete

**Files changed:**
- `pkg/store/store.go` (modified, +18/-3 lines)
- `pkg/store/store_test.go` (modified, +34/-0 lines)

**Interface deviations:** none

**Verification:**
- [x] Build passed: `go build ./...`
- [x] Tests passed: `go test ./pkg/store/`

**Commits:**
- `d4e5f6a`: wire cache into Store, add cache-hit tests
