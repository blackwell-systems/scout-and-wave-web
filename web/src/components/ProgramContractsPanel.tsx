import { useState, useEffect } from 'react'
import { fetchProgramContracts } from '../programApi'
import type { ContractStatus } from '../types/program'

interface ProgramContractsPanelProps {
  programSlug: string
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

export default function ProgramContractsPanel({ programSlug }: ProgramContractsPanelProps): JSX.Element {
  const [contracts, setContracts] = useState<ContractStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadContracts = async () => {
      try {
        const data = await fetchProgramContracts(programSlug)
        setContracts(data)
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    }
    void loadContracts()

    // Subscribe to contract freeze events
    const eventSource = new EventSource('/api/program/events')
    
    const handleContractFrozen = (e: MessageEvent) => {
      const data = JSON.parse(e.data)
      if (data.program_slug === programSlug) {
        // Refetch contracts when one is frozen
        void loadContracts()
      }
    }

    eventSource.addEventListener('program_contract_frozen', handleContractFrozen)

    return () => {
      eventSource.close()
    }
  }, [programSlug])

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
