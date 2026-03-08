import AgentPromptsPanel from './AgentPromptsPanel'
import AgentContextToggle from './AgentContextToggle'
import { IMPLDocResponse } from '../../types'

interface AgentContextPanelProps {
  slug: string
  impl: IMPLDocResponse
}

/**
 * AgentContextPanel wraps AgentPromptsPanel with per-agent context toggle buttons.
 * Downstream action required: ReviewScreen.tsx (owned by Agent I in Wave 3) should
 * import and render AgentContextPanel instead of AgentPromptsPanel directly for the
 * 'agent-prompts' panel slot.
 *
 * Usage in ReviewScreen:
 *   import AgentContextPanel from './review/AgentContextPanel'
 *   // replace: <AgentPromptsPanel agentPrompts={(impl as any).agent_prompts} />
 *   // with:    <AgentContextPanel slug={slug} impl={impl} />
 */
export default function AgentContextPanel({ slug, impl }: AgentContextPanelProps): JSX.Element {
  const agentPrompts = (impl as any).agent_prompts as Array<{ wave: number; agent: string; prompt: string }> | undefined

  return (
    <div>
      <AgentPromptsPanel agentPrompts={agentPrompts} />
      {agentPrompts && agentPrompts.length > 0 && (
        <div className="mt-2 space-y-2">
          {agentPrompts.map(ap => (
            <AgentContextToggle
              key={`${ap.wave}-${ap.agent}`}
              slug={slug}
              agent={ap.agent}
              wave={ap.wave}
            />
          ))}
        </div>
      )}
    </div>
  )
}
