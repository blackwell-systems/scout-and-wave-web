import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import MarkdownContent from './MarkdownContent'

interface AgentPrompt {
  agent: string
  wave: number
  prompt: string
}

interface AgentPromptsPanelProps {
  agentPrompts?: AgentPrompt[]
}

export default function AgentPromptsPanel({ agentPrompts }: AgentPromptsPanelProps): JSX.Element {
  if (!agentPrompts || agentPrompts.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Agent Prompts</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No agent prompts available</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent Prompts</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {agentPrompts.map((ap, idx) => (
          <Card key={idx} className="bg-muted/50">
            <details className="group">
              <summary className="cursor-pointer px-6 py-4 font-medium hover:bg-muted/80 transition-colors list-none">
                <div className="flex items-center justify-between">
                  <span>Agent {ap.agent} — Wave {ap.wave}</span>
                  <span className="text-muted-foreground group-open:rotate-180 transition-transform">▼</span>
                </div>
              </summary>
              <CardContent className="pt-0">
                <MarkdownContent>{ap.prompt}</MarkdownContent>
              </CardContent>
            </details>
          </Card>
        ))}
      </CardContent>
    </Card>
  )
}
