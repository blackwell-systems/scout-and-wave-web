# useWaveEvents Refactoring Summary

## Objective
Refactored `web/src/hooks/useWaveEvents.ts` to use a reducer pattern, extracting state management logic into a separate `waveEventsReducer.ts` file.

## Changes Made

### 1. Created `web/src/hooks/waveEventsReducer.ts` (371 lines)
- **Exported types**: `AppWaveState`, `WaveMergeState`, `WaveTestState`, `StageEntry`, `StaleBranchesInfo`, `WaveAction`
- **Action union type**: `WaveAction` with 30+ discriminated action types covering all SSE events
- **Reducer function**: `waveEventsReducer(state, action)` containing all state transition logic
- **Helper functions**: 
  - `buildWaves(agents, prevWaves)` - rebuilds wave structures from agents
  - `upsertAgent(state, agent, wave, update)` - internal helper for agent updates
- **Initial state**: `initialWaveState` constant

### 2. Refactored `web/src/hooks/useWaveEvents.ts` (278 lines, down from 457)
- **Replaced `useState` with `useReducer`**: Using `waveEventsReducer` and `initialWaveState`
- **Re-exported types**: All types are re-exported from `waveEventsReducer` for backward compatibility
- **Converted all setState calls to dispatch calls**: Each SSE event handler now dispatches a typed action
- **Preserved EventSource setup**: Connection management stays in the hook
- **Maintained public API**: Same signature `useWaveEvents(slug: string): AppWaveState`

### 3. Created `web/src/hooks/useWaveEvents.test.ts` (365 lines)
Comprehensive integration tests covering:
- Initial state rendering
- Connection state (CONNECT/DISCONNECT)
- Agent lifecycle events (started, complete, failed, output, tool_call)
- Run lifecycle (run_complete, run_failed)
- Scaffold events (started, output, complete, failed)
- Merge events (started, output, complete, failed, conflict resolution)
- Test events (started, output, complete, failed)
- Wave completion
- Disk status seeding
- EventSource cleanup on unmount

## Benefits

1. **Separation of concerns**: State logic separated from side-effects
2. **Testability**: Reducer can be tested independently
3. **Maintainability**: Clear action types, easier to add new events
4. **Type safety**: Discriminated union ensures all actions are handled
5. **Performance**: useReducer dispatch is stable (no new function on each render)
6. **Code organization**: 457 lines → 278 lines in hook, logic moved to reducer

## Backward Compatibility

✅ All existing consumers work without changes:
- `WaveBoard.tsx` - imports `useWaveEvents`, `AppWaveState`, `WaveMergeState`, `WaveTestState`
- `StageTimeline.tsx` - imports `StageEntry`
- `useExecutionSync.ts` - imports `useWaveEvents`, `AppWaveState`

## Verification

### TypeScript
```bash
cd web && npx tsc --noEmit
✓ No errors
```

### Tests
```bash
cd web && npx vitest run src/hooks/useWaveEvents.test.ts src/hooks/useExecutionSync.test.ts
✓ 25/25 tests passed
```

### Build
```bash
cd web && npx vite build
✓ Production build successful (1.9 MB bundle)
```

## Files Modified
- `web/src/hooks/useWaveEvents.ts` (modified, -179 lines)
- `web/src/hooks/waveEventsReducer.ts` (new, +371 lines)
- `web/src/hooks/useWaveEvents.test.ts` (new, +365 lines)

## Migration Notes

For future developers:
- To add a new SSE event, add an action type to `WaveAction` union and handle it in the reducer switch
- The reducer is pure and easily testable with simple unit tests
- EventSource connection logic remains in `useWaveEvents.ts` (not moved to reducer)
- All types are re-exported from `useWaveEvents.ts` for consumer convenience
