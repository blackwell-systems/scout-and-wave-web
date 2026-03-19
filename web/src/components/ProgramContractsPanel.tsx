import { useState, useEffect, useCallback } from 'react'
import { fetchProgramContracts } from '../programApi'
import type { ContractStatus } from '../types/program'

interface ProgramContractsPanelProps {
  programSlug: string
  /**
   * Called by the parent when a program_contract_frozen SSE event fires.
   * The parent owns the SSE connection and passes this callback so the
   * component can refetch without opening its own EventSource.
   *
   * Usage: <ProgramContractsPanel
   *   programSlug={slug}
   *   onContractFrozen={handleContractFrozen}
   * />
   * where handleContractFrozen calls loadContracts (obtained via the
   * onRefresh ref exposed by this component, or via a refreshKey prop).
   */
  onContractFrozen?: () => void
}

function getContractStatusBadge(frozen: boolean): JSX.Element {
  if (frozen) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-lg">🔒</span>
        <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 font-medium">
          Frozen
        </span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-lg">🔓</span>
      <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-400 border border-yellow-200 dark:border-yellow-800 font-medium">
        Pending
      </span>
    </div>
  )
}

export default function ProgramContractsPanel({ programSlug, onContractFrozen }: ProgramContractsPanelProps): JSX.Element {
  const [contracts, setContracts] = useState<ContractStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Incrementing this tick causes the fetch effect to re-run, refreshing contracts.
  // The parent wires this by passing onContractFrozen as a stable callback that
  // calls the setter: e.g. onContractFrozen={() => setRefreshTick(t => t + 1)}
  // where refreshTick is a state variable in the parent (not here), or by
  // passing a new function reference each time a freeze event occurs.
  const [refreshTick, setRefreshTick] = useState(0)

  const loadContracts = useCallback(async () => {
    try {
      const data = await fetchProgramContracts(programSlug)
      setContracts(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [programSlug])

  // Fetch on mount and whenever programSlug changes or a refresh is requested.
  useEffect(() => {
    void loadContracts()
  }, [loadContracts, refreshTick])

  // When the parent detects a program_contract_frozen SSE event it calls
  // onContractFrozen(). We bump refreshTick to trigger a contract refetch.
  // No standalone EventSource is opened here — the parent owns the SSE connection.
  useEffect(() => {
    if (onContractFrozen === undefined) return

    // Store the bump function for the parent to call via the passed prop.
    // Since we cannot mutate the prop (it's passed in), we intercept it here:
    // whenever the parent provides a new onContractFrozen reference, we treat
    // that as a signal to refetch. The canonical pattern for future integration
    // is: parent holds `contractFrozenCounter` in state, wraps it in useCallback,
    // and passes () => setContractFrozenCounter(c => c + 1) — each new counter
    // value produces a new callback reference, bumping refreshTick here.
    setRefreshTick(t => t + 1)
  }, [onContractFrozen])

  if (loading) {
    return (
      <div className="p-4">
        <div className="text-sm text-muted-foreground">Loading contracts...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="text-sm text-destructive">Error loading contracts: {error}</div>
      </div>
    )
  }

  if (contracts.length === 0) {
    return (
      <div className="p-4">
        <div className="text-sm text-muted-foreground">No cross-IMPL contracts defined</div>
      </div>
    )
  }

  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold text-foreground mb-4">Cross-IMPL Contracts</h2>
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2 text-xs font-medium">Name</th>
              <th className="text-left px-4 py-2 text-xs font-medium">Location</th>
              <th className="text-left px-4 py-2 text-xs font-medium">Freeze At</th>
              <th className="text-left px-4 py-2 text-xs font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {contracts.map((contract) => (
              <tr
                key={contract.name}
                className="hover:bg-muted/50 transition-colors"
              >
                <td className="px-4 py-3">
                  <span className="text-sm font-medium text-foreground">{contract.name}</span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs font-mono text-muted-foreground">{contract.location}</span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs text-muted-foreground">{contract.freeze_at}</span>
                  {contract.frozen_at_tier !== undefined && (
                    <span className="ml-2 text-xs text-green-600 dark:text-green-400">
                      (Tier {contract.frozen_at_tier})
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {getContractStatusBadge(contract.frozen)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 text-xs text-muted-foreground">
        <p>
          Contracts are frozen at specified milestones to ensure cross-IMPL interface stability.
          Frozen contracts cannot be modified by later IMPLs.
        </p>
      </div>
    </div>
  )
}
