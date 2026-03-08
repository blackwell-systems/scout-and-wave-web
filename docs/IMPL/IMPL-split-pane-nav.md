### Suitability Assessment

Verdict: SUITABLE
test_command: `cd web && npm test -- --run`
lint_command: none

The feature decomposes cleanly into three disjoint ownership domains: (1) a new
`ImplList` sidebar component with no existing file to conflict, (2) a new
`ResizableDivider` hook/component with no existing file to conflict, and (3)
modifications to `App.tsx` to wire the split-pane shell together. `ReviewScreen`
is read-only from agents A and B's perspective — Agent C owns it for a targeted
adaptation. All three agents work on different files with zero overlap. The
interface contracts (selected slug as prop, divider width as state, list grouping
logic lifted from App) can be fully defined before implementation. Build + test
cycle is `npm test` with Vitest (fast, but non-trivial React rendering tests
add value from parallelism). Estimated time savings: ~8 minutes.

Estimated times:
- Scout phase: ~10 min (codebase reading + IMPL doc writing)
- Agent execution: ~15 min (3 agents × ~5 min avg, parallel)
- Merge & verification: ~5 min
Total SAW time: ~30 min

Sequential baseline: ~45 min (3 agents × 15 min sequential)
Time savings: ~15 min (33% faster)

Recommendation: Clear speedup. Proceed with 3-agent single-wave execution.

---

### Pre-Mortem

| Scenario | Likelihood | Impact | Mitigation |
|----------|-----------|--------|------------|
| Drag events captured by inner scroll containers in ReviewScreen, breaking divider drag | Medium | Medium | Attach `onMouseMove` / `onMouseUp` to `document` in the `useResizableDivider` hook, not to a div — standard pattern for drag handles |
| Min-width constraint (180px) not enforced during fast drags, causing left pane to collapse | Low | Low | Clamp width in the mousemove handler: `Math.max(180, Math.min(viewportFraction * 0.4, raw))` |
| ReviewScreen sticky toolbar (`sticky top-0`) bleeds outside right pane bounds in split view | Medium | Medium | Right pane must be `overflow-y-auto` with its own scroll context; sticky then sticks to pane top, not viewport top — no CSS change needed in ReviewScreen itself |
| WaveBoard screen still uses full-screen layout; split pane should not apply to it | Low | Low | Keep the `screen === 'wave'` branch in App.tsx rendering WaveBoard full-screen outside the split shell |
| `isStuck` IntersectionObserver sentinel in ReviewScreen misbehaves inside a scrollable pane | Low | Low | Sentinel already works relative to its own scroll container; no change needed — confirmed by reading ReviewScreen |
| Tests for ReviewScreen break because wrapper now passes `className` or layout props | Low | Low | Agent C adds a targeted test for the new `ImplList` component; ReviewScreen tests are unchanged |

---

### Scaffolds

No scaffolds needed — agents have independent type ownership. All shared types
(slug string, list entries) already exist in `web/src/types.ts` and are not
modified. The `useResizableDivider` hook is fully owned by Agent B with no
cross-agent type dependency.

---

### Known Issues

- `ReviewScreen`'s sticky toolbar uses negative viewport-relative margins
  (`marginLeft: 'calc(-50vw + 50%)'`) to bleed edge-to-edge. In the new split
  layout the right pane is a constrained scroll container, so this bleed
  calculation will no longer reach the viewport edge — it will bleed to the
  pane edge instead, which is the correct behavior. No fix needed, but agents
  should be aware this is an intentional behavior shift, not a regression.
- No pre-existing test failures identified via source inspection.

---

### Dependency Graph

```
web/src/types.ts  (unchanged, read-only)
web/src/api.ts    (unchanged, read-only)
         |
         v
web/src/components/ImplList.tsx          [Agent A — new file]
web/src/hooks/useResizableDivider.ts     [Agent B — new file]
         |                                        |
         +------------------+--------------------+
                            |
                            v
web/src/App.tsx              [Agent C — modify]
         |
         v
web/src/components/ReviewScreen.tsx      [Agent C — minor modify]
```

**Roots (no new dependencies):** `ImplList.tsx`, `useResizableDivider.ts`
**Dependents:** `App.tsx` imports both; `ReviewScreen.tsx` gets one prop removed
(`onRefreshImpl` stays, but the back-navigation pattern is replaced by list
selection)

**Cascade candidates (files that are NOT changing but reference semantics
that shift):** `ReviewScreen.test.tsx` — the test renders `ReviewScreen` in
isolation and will continue to pass unchanged because the component interface
is not modified. No cascade failures expected.

---

### Interface Contracts

**`ImplList` component (`web/src/components/ImplList.tsx`)**

```typescript
interface ImplListProps {
  entries: IMPLListEntry[]        // from web/src/types.ts
  selectedSlug: string | null
  onSelect: (slug: string) => void
  loading: boolean
}

export default function ImplList(props: ImplListProps): JSX.Element
```

Behavior:
- Renders active entries (where `e.doc_status !== 'complete'`) above a divider.
- Renders completed entries (where `e.doc_status === 'complete'`) below a
  "Completed" label, with `opacity-60` styling and a `✓` prefix — matching
  the current App.tsx grouping logic verbatim.
- The entry matching `selectedSlug` receives a distinct selected highlight
  (e.g. `bg-accent border-l-2 border-primary`).
- The component is scroll-independent: it does not set its own height. The
  parent left-pane div controls overflow.
- `loading` disables all entry buttons.

**`useResizableDivider` hook (`web/src/hooks/useResizableDivider.ts`)**

```typescript
interface ResizableDividerOptions {
  initialWidthPx?: number   // default: 260
  minWidthPx?: number       // default: 180
  maxFraction?: number      // default: 0.40 (40% of viewport width)
}

interface ResizableDividerResult {
  leftWidthPx: number
  dividerProps: {
    onMouseDown: (e: React.MouseEvent) => void
    style: React.CSSProperties
    className: string
  }
}

export function useResizableDivider(
  options?: ResizableDividerOptions
): ResizableDividerResult
```

Implementation notes:
- On `mousedown` on the divider, attach `mousemove` and `mouseup` listeners
  to `document` (not to a React element) so drag works even when the cursor
  leaves the divider strip.
- `mousemove` handler: `leftWidthPx = Math.max(minWidthPx, Math.min(e.clientX, window.innerWidth * maxFraction))`
- `mouseup` handler: remove document listeners.
- Clean up document listeners in the hook's `useEffect` return.
- `dividerProps.className` must include `cursor-col-resize select-none` so the
  cursor signals resizeability and text selection is suppressed during drag.
- `dividerProps.style` should include `{ width: '4px', flexShrink: 0 }` so the
  strip is always exactly 4px wide regardless of Tailwind resets.

**`App.tsx` split-pane shell (modified)**

The `screen` state type narrows: the `'input'` screen is eliminated. On mount,
App shows the split-pane layout immediately (left pane = `ImplList`, right pane
= empty/placeholder until an IMPL is selected). The `'wave'` screen remains a
full-page escape hatch.

New state shape in App:

```typescript
// Replaces: const [screen, setScreen] = useState<Screen>('input')
// Keep 'wave' as an escape; 'review' becomes the default split-pane state
type Screen = 'split' | 'wave'
const [screen, setScreen] = useState<Screen>('split')

// selectedSlug replaces the old 'slug' string used for the input field
const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
```

The manual slug input form (currently in the `'input'` screen Card) moves into
the left pane below the list — it stays as a small text input for power users.

Props passed to `ReviewScreen` do not change structurally:

```typescript
<ReviewScreen
  slug={selectedSlug!}
  impl={impl}
  onApprove={handleApprove}
  onReject={handleReject}
  onRefreshImpl={handleSelect}
/>
```

`ReviewScreen` itself does not receive new props. Its outer wrapper class
(`min-h-screen`) must be changed to `h-full` so it fits inside the right pane
scroll container — this is the only change to `ReviewScreen.tsx`.

---

### File Ownership

```yaml type=impl-file-ownership
| File | Agent | Wave | Depends On |
|------|-------|------|------------|
| `web/src/components/ImplList.tsx` (new) | A | 1 | — |
| `web/src/hooks/useResizableDivider.ts` (new) | B | 1 | — |
| `web/src/App.tsx` | C | 1 | A, B |
| `web/src/components/ReviewScreen.tsx` | C | 1 | — |
```

Note: Agent C owns both `App.tsx` and `ReviewScreen.tsx`. These two files are
coupled by the same conceptual change (wiring split-pane layout) and must be
touched together. No other agent needs either file.

---

### Wave Structure

All three agents are independent. Agent C depends on interfaces defined by A and
B, but those interfaces are fully specified in this IMPL doc — C does not need to
read A's or B's output files to implement against them. All three run in parallel.

```yaml type=impl-wave-structure
Wave 1: [A] [B] [C]
```

---

### Agent Prompts

---

#### Agent A — `ImplList` component

```
agent: A
wave: 1
title: Create ImplList sidebar component
branch: wave1-agent-a-impllist
worktree_path: /tmp/saw-split-pane-agent-a
```

**Context**

You are implementing a new React component for the Scout and Wave web UI. The
app is a Vite + React + TypeScript + Tailwind CSS project located at
`/Users/dayna.blackwell/code/scout-and-wave-go/web`. No routing library is
used — the app is fully state-driven.

You will create one new file. Do not modify any existing files.

**Your file**

`web/src/components/ImplList.tsx` — new file

**What to build**

A sidebar list component that displays all IMPL docs grouped by status (active
vs. completed). This replaces the list currently inline in `App.tsx`'s `'input'`
screen Card, but is now a standalone persistent component.

**Props interface (binding contract — implement exactly)**

```typescript
import { IMPLListEntry } from '../types'

interface ImplListProps {
  entries: IMPLListEntry[]
  selectedSlug: string | null
  onSelect: (slug: string) => void
  loading: boolean
}

export default function ImplList(props: ImplListProps): JSX.Element
```

**Behavior requirements**

1. Active entries: entries where `e.doc_status !== 'complete'`. Render each as
   a button. No section label needed (they appear first).
2. Completed entries: entries where `e.doc_status === 'complete'`. Render a
   small label "Completed" (same style as the current App.tsx: `text-xs
   font-medium uppercase tracking-wider text-muted-foreground pt-2`), then each
   entry as a button with `opacity-60 hover:opacity-100` and a `✓` prefix.
3. Selected highlight: the button whose slug matches `selectedSlug` gets
   `bg-accent border-l-2 border-primary` added. Remove `opacity-60` from the
   selected entry even if it is in the completed group.
4. Empty state: if `entries.length === 0`, render:
   ```
   <p className="text-muted-foreground text-xs px-2">
     No IMPL docs found. Run <code className="bg-muted px-1 rounded">saw scout</code> first.
   </p>
   ```
5. All buttons are `disabled={loading}`.
6. The component does NOT set its own height or overflow. The parent container
   controls scrolling.
7. Manual slug input form: below the list (separated by a `border-t mt-4 pt-4`
   divider), render a small form:
   - Label: `<p className="text-muted-foreground text-xs mb-2">Or enter a slug manually:</p>`
   - An `<input>` with `type="text"` and a "Go" button. The form's `onSubmit`
     should call `onSelect(inputValue)` with the trimmed input value.
   - Input styling (match existing App.tsx): `border border-input bg-background
     text-foreground rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2
     focus:ring-ring w-full mb-2`
   - Button styling: use the `Button` component from `./ui/button` with
     `type="submit"` and `disabled={loading}`.

**Tailwind layout note**

The component root should be `<div className="flex flex-col gap-1 p-2">` so
entries stack vertically with minimal gap and the parent can control sizing.

**Button styling for list entries**

Use the `Button` component from `./ui/button` with `variant="ghost"` and
`size="sm"`, adding `w-full justify-start font-mono text-xs` class. For the
selected state, append `bg-accent border-l-2 border-primary rounded-none`.

**Verification gate**

```bash
cd /Users/dayna.blackwell/code/scout-and-wave-go/web
npm run build 2>&1 | tail -20
npm test -- --run --reporter=verbose 2>&1 | tail -30
```

The build must succeed with zero TypeScript errors. Existing tests must pass
(you are not adding new tests — your component has no test yet; that is fine).

**Completion report template**

```yaml
agent: A
wave: 1
status: complete          # or partial / blocked
branch: wave1-agent-a-impllist
files_changed:
  - web/src/components/ImplList.tsx
interface_deviations: []  # list any departures from the contracted interface
downstream_action_required: false
notes: ""
```

---

#### Agent B — `useResizableDivider` hook

```
agent: B
wave: 1
title: Create useResizableDivider hook
branch: wave1-agent-b-divider
worktree_path: /tmp/saw-split-pane-agent-b
```

**Context**

You are implementing a custom React hook for the Scout and Wave web UI. The app
is a Vite + React + TypeScript + Tailwind CSS project at
`/Users/dayna.blackwell/code/scout-and-wave-go/web`. No external resize library
is available or wanted — implement with React state and native DOM events.

You will create one new file. Do not modify any existing files.

**Your file**

`web/src/hooks/useResizableDivider.ts` — new file

**What to build**

A hook that manages the left-pane pixel width for a horizontal split-pane layout
and returns props to spread onto the divider `<div>`. The divider must be
draggable with the mouse.

**Return type (binding contract — implement exactly)**

```typescript
interface ResizableDividerOptions {
  initialWidthPx?: number   // default: 260
  minWidthPx?: number       // default: 180
  maxFraction?: number      // default: 0.40
}

interface ResizableDividerResult {
  leftWidthPx: number
  dividerProps: {
    onMouseDown: (e: React.MouseEvent) => void
    style: React.CSSProperties
    className: string
  }
}

export function useResizableDivider(
  options?: ResizableDividerOptions
): ResizableDividerResult
```

**Implementation requirements**

1. `leftWidthPx` state: initialized to `options?.initialWidthPx ?? 260`.

2. `onMouseDown` on the divider:
   - Call `e.preventDefault()` to prevent text selection.
   - Attach a `mousemove` handler to `document`.
   - Attach a `mouseup` handler to `document` that removes both handlers.

3. `mousemove` handler:
   ```typescript
   const newWidth = Math.max(
     minWidthPx,
     Math.min(e.clientX, window.innerWidth * maxFraction)
   )
   setLeftWidthPx(newWidth)
   ```

4. `useEffect` cleanup: if the component unmounts during a drag, remove any
   lingering document listeners. Store handler references in refs so the
   cleanup closure captures the correct instances.

5. `dividerProps.className`:
   ```
   "cursor-col-resize select-none bg-border hover:bg-primary/30 transition-colors"
   ```

6. `dividerProps.style`:
   ```typescript
   { width: '4px', flexShrink: 0, alignSelf: 'stretch' }
   ```
   (`alignSelf: 'stretch'` ensures the 4px strip fills the full height of the
   flex row that contains the split pane.)

7. The hook must have zero side-effects when not dragging. Do not add any
   global `mousemove` listener until `mousedown` fires.

**Verification gate**

```bash
cd /Users/dayna.blackwell/code/scout-and-wave-go/web
npm run build 2>&1 | tail -20
npm test -- --run --reporter=verbose 2>&1 | tail -30
```

TypeScript must compile with zero errors. Existing tests must pass.

**Completion report template**

```yaml
agent: B
wave: 1
status: complete
branch: wave1-agent-b-divider
files_changed:
  - web/src/hooks/useResizableDivider.ts
interface_deviations: []
downstream_action_required: false
notes: ""
```

---

#### Agent C — App.tsx split-pane shell + ReviewScreen adaptation

```
agent: C
wave: 1
title: Refactor App.tsx to split-pane layout, adapt ReviewScreen
branch: wave1-agent-c-app-shell
worktree_path: /tmp/saw-split-pane-agent-c
```

**Context**

You are refactoring the main app shell of the Scout and Wave web UI from a
two-screen navigation flow to a single split-pane layout. The project is at
`/Users/dayna.blackwell/code/scout-and-wave-go/web`.

You will modify two existing files. Read both before writing any changes.

**Your files**

- `web/src/App.tsx` — primary change: replace two-screen flow with split-pane
- `web/src/components/ReviewScreen.tsx` — minor change: one CSS class swap

**Important:** Agents A and B are building `ImplList` and `useResizableDivider`
in parallel. Their files will not exist in your worktree yet. Import them by
path — the TypeScript compiler will report errors, and that is expected during
your agent session. Your verification gate must pass after the merge, not in
isolation. You can verify your work by running `tsc --noEmit` and checking that
the only errors are "cannot find module" for the two new files.

**Interfaces you are building against (from IMPL doc — do not deviate)**

```typescript
// ImplList — from web/src/components/ImplList.tsx (Agent A)
interface ImplListProps {
  entries: IMPLListEntry[]
  selectedSlug: string | null
  onSelect: (slug: string) => void
  loading: boolean
}

// useResizableDivider — from web/src/hooks/useResizableDivider.ts (Agent B)
function useResizableDivider(options?: {
  initialWidthPx?: number
  minWidthPx?: number
  maxFraction?: number
}): {
  leftWidthPx: number
  dividerProps: {
    onMouseDown: (e: React.MouseEvent) => void
    style: React.CSSProperties
    className: string
  }
}
```

**Changes to `web/src/App.tsx`**

Read the current file at `/Users/dayna.blackwell/code/scout-and-wave-go/web/src/App.tsx`
before making changes.

1. Remove the `Screen` type and `screen` state. Replace with:
   ```typescript
   type AppMode = 'split' | 'wave'
   const [appMode, setAppMode] = useState<AppMode>('split')
   ```

2. Remove the `slug` string state (used for the manual input field). The slug
   is now tracked as `selectedSlug`:
   ```typescript
   const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
   ```

3. Add imports:
   ```typescript
   import ImplList from './components/ImplList'
   import { useResizableDivider } from './hooks/useResizableDivider'
   ```

4. Call the hook at the top of the component body:
   ```typescript
   const { leftWidthPx, dividerProps } = useResizableDivider({
     initialWidthPx: 260,
     minWidthPx: 180,
     maxFraction: 0.40,
   })
   ```

5. Update `handleSelect` to use `selectedSlug`:
   ```typescript
   async function handleSelect(selected: string) {
     setSelectedSlug(selected)
     setLoading(true)
     setError(null)
     try {
       const data = await fetchImpl(selected)
       setImpl(data)
     } catch (err) {
       setError(err instanceof Error ? err.message : String(err))
     } finally {
       setLoading(false)
     }
   }
   ```
   Note: no `setScreen('review')` call — the right pane renders from `impl`
   state, not from screen state.

6. Update `handleApprove` to use `setAppMode('wave')` instead of
   `setScreen('wave')`, and use `selectedSlug` instead of `slug`.

7. Update `handleReject` to use `selectedSlug` instead of `slug`.

8. The `appMode === 'wave'` branch remains a full-page escape — keep it
   structurally identical, just update the variable name:
   ```typescript
   if (appMode === 'wave') {
     return (
       <>
         <div className="fixed top-4 right-4 z-50"><DarkModeToggle /></div>
         <WaveBoard slug={selectedSlug!} />
       </>
     )
   }
   ```

9. Replace the old `'input'` screen Card and `'review'` screen branch with a
   single split-pane shell as the default return:

   ```tsx
   return (
     <div className="h-screen flex flex-col bg-background overflow-hidden">
       {/* Top bar */}
       <header className="flex items-center justify-between px-4 py-2 border-b shrink-0">
         <span className="text-sm font-semibold tracking-tight">Scout and Wave</span>
         <DarkModeToggle />
       </header>

       {/* Split pane body */}
       <div className="flex flex-1 min-h-0">
         {/* Left pane */}
         <div
           className="flex flex-col overflow-y-auto shrink-0 border-r"
           style={{ width: leftWidthPx }}
         >
           <ImplList
             entries={entries}
             selectedSlug={selectedSlug}
             onSelect={handleSelect}
             loading={loading}
           />
         </div>

         {/* Draggable divider */}
         <div {...dividerProps} />

         {/* Right pane */}
         <div className="flex-1 overflow-y-auto min-w-0">
           {error && (
             <p className="text-destructive text-sm p-4">{error}</p>
           )}
           {loading && (
             <p className="text-muted-foreground text-sm p-4">Loading...</p>
           )}
           {rejected && (
             <p className="text-orange-600 text-sm p-4">Plan rejected.</p>
           )}
           {!loading && impl !== null && selectedSlug !== null && (
             <ReviewScreen
               slug={selectedSlug}
               impl={impl}
               onApprove={handleApprove}
               onReject={handleReject}
               onRefreshImpl={handleSelect}
             />
           )}
           {!loading && impl === null && !error && (
             <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
               Select a plan from the list to review.
             </div>
           )}
         </div>
       </div>
     </div>
   )
   ```

10. Remove unused imports: `Card`, `CardContent`, `CardHeader`, `CardTitle`
    (no longer used after the Card-based input screen is removed). Keep all
    other imports.

**Changes to `web/src/components/ReviewScreen.tsx`**

Read the file at `/Users/dayna.blackwell/code/scout-and-wave-go/web/src/components/ReviewScreen.tsx`
before making changes.

Find the line:
```tsx
<div className="min-h-screen bg-background">
```
(line 78 at time of writing — confirm by reading)

Change it to:
```tsx
<div className="h-full bg-background">
```

This is the only change to `ReviewScreen.tsx`. It allows `ReviewScreen` to fit
inside the right pane's `flex-1 overflow-y-auto` container rather than forcing
a viewport-height minimum that would break the split layout.

The `max-w-6xl mx-auto px-4 py-8` inner div and all content inside are
unchanged.

**Verification gate**

Because Agent A and B files do not exist in your worktree, run TypeScript in
isolation-check mode:

```bash
cd /Users/dayna.blackwell/code/scout-and-wave-go/web
npx tsc --noEmit 2>&1 | grep -v "Cannot find module './components/ImplList'" | grep -v "Cannot find module './hooks/useResizableDivider'" | head -30
```

The filtered output must be empty (zero TypeScript errors other than the two
expected missing-module errors).

Also run the existing tests to confirm ReviewScreen tests still pass:

```bash
cd /Users/dayna.blackwell/code/scout-and-wave-go/web
npm test -- --run --reporter=verbose 2>&1 | tail -30
```

All existing tests must pass.

**Completion report template**

```yaml
agent: C
wave: 1
status: complete
branch: wave1-agent-c-app-shell
files_changed:
  - web/src/App.tsx
  - web/src/components/ReviewScreen.tsx
interface_deviations: []
downstream_action_required: false
notes: ""
```

---

### Wave Execution Loop

After Wave 1 completes, work through the checklist below in order.

The merge procedure detail is in `saw-merge.md`. Key principles:
- Read completion reports first — a `status: partial` or `status: blocked` blocks
  the merge entirely. No partial merges.
- Interface deviations with `downstream_action_required: true` must be propagated
  before merging dependent agents.
- Post-merge verification is the real gate: individual agents pass in isolation,
  but the merged codebase surfaces cross-import failures (especially Agent C's
  imports of A and B).
- Fix before proceeding. Do not ship a broken build.

### Orchestrator Post-Merge Checklist

After wave 1 completes:

- [ ] Read all agent completion reports — confirm all `status: complete`; if any
      `partial` or `blocked`, stop and resolve before merging
- [ ] Conflict prediction — Agent C touches `App.tsx` and `ReviewScreen.tsx`;
      Agents A and B create new files only. No conflicts expected. Confirm
      `files_changed` lists are disjoint.
- [ ] Review `interface_deviations` — if Agent A or B deviated from the
      contracted interface, update Agent C's merged code before the build gate
- [ ] Merge in order: A first (new file), then B (new file), then C (modifies
      existing files):
      - `git merge --no-ff wave1-agent-a-impllist -m "Merge wave1-agent-a: ImplList component"`
      - `git merge --no-ff wave1-agent-b-divider -m "Merge wave1-agent-b: useResizableDivider hook"`
      - `git merge --no-ff wave1-agent-c-app-shell -m "Merge wave1-agent-c: split-pane App shell"`
- [ ] Worktree cleanup: `git worktree remove <path>` + `git branch -d <branch>` for each
- [ ] Post-merge verification:
      - [ ] Linter auto-fix pass: n/a (no linter configured)
      - [ ] `cd web && npm run build && npm test -- --run` — must pass with zero errors
- [ ] Fix any cascade failures — check that ReviewScreen tests still pass;
      check that the `min-h-screen` → `h-full` change did not break snapshot tests
- [ ] Tick status checkboxes in this IMPL doc for completed agents
- [ ] Update interface contracts for any deviations logged by agents
- [ ] Feature-specific steps:
      - [ ] Manual smoke test: open the app in browser, verify list appears in left
            pane, selecting an IMPL loads the right pane, divider drag works,
            completed IMPLs show with `✓` prefix and reduced opacity
      - [ ] Verify dark mode toggle still appears in the new top bar (not `fixed top-4 right-4`)
      - [ ] Verify WaveBoard still renders full-screen after Approve
- [ ] Commit: `git commit -m "feat: split-pane nav — persistent IMPL list with resizable divider"`
- [ ] No next wave — this is a single-wave feature

---

### Status

### Agent C - Completion Report

```yaml type=impl-completion-report
status: complete
worktree: wave1-agent-c
branch: wave1-agent-c-app-shell
commit: "84401ce"
files_changed:
  - web/src/App.tsx
  - web/src/components/ReviewScreen.tsx
files_created: []
interface_deviations: none
out_of_scope_deps: []
tests_added: []
verification: "tsc --noEmit (filtered) && npm test -- --run"
notes: "node_modules was not present in the worktree web directory; ran npm install before verification. tsc --noEmit (filtered for ImplList and useResizableDivider missing-module errors) produced zero output. All 5 existing ReviewScreen tests pass."
```

---

### Agent B - Completion Report

**Status:** complete

**Files changed:**
- web/src/hooks/useResizableDivider.ts (created, +70/-0 lines)

**Interface deviations:**
None.

**Out of scope dependencies:**
None.

**Verification:**
- [x] Build passed: `npm run build` (tsc + vite, zero TypeScript errors)
- [x] Tests passed: `npm test -- --run --reporter=verbose` (5/5 passing)
- [x] Manual verification: Hook compiles cleanly; all existing ReviewScreen tests unaffected

**Commits:**
- 7230c00: feat(web): add useResizableDivider hook

**Notes:**
node_modules was not present in the worktree; ran `npm install` before verification. The `React.MouseEvent` and `React.CSSProperties` namespace references work correctly once dependencies are installed. Zero global listeners are added until mousedown fires; cleanup ref pattern ensures no listener leaks on unmount during active drag.

```yaml type=impl-completion-report
status: complete
worktree: wave1-agent-b
branch: wave1-agent-b-divider
commit: "7230c00"
files_changed: []
files_created:
  - web/src/hooks/useResizableDivider.ts
interface_deviations: none
out_of_scope_deps: []
tests_added: []
verification: "npm run build && npm test -- --run"
notes: ""
```

---

### Agent A - Completion Report

```yaml type=impl-completion-report
status: complete
worktree: wave1-agent-a
branch: wave1-agent-a-impllist
commit: "42e3f95"
files_changed: []
files_created:
  - web/src/components/ImplList.tsx
interface_deviations: none
out_of_scope_deps: []
tests_added: []
verification: "npm run build && npm test -- --run"
notes: ""
```

---

```yaml type=impl-status
- wave: 1
  agent: A
  description: "Create ImplList sidebar component"
  status: complete

- wave: 1
  agent: B
  description: "Create useResizableDivider hook"
  status: complete

- wave: 1
  agent: C
  description: "Refactor App.tsx to split-pane shell, adapt ReviewScreen"
  status: TO-DO

- wave: Orch
  agent: Orch
  description: "Post-merge build + test verification, smoke test, commit"
  status: TO-DO
```
