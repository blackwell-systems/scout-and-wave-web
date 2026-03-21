import { useState, useRef, useEffect } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from './ui/card'
import { sawClient } from '../lib/apiClient'

// ─── Types ───────────────────────────────────────────────────────────────────

interface InterviewQuestionEvent {
  phase: string
  question_num: number
  max_questions: number
  text: string
  hint?: string
}

// The interview namespace is added to sawClient by Agent A (wave2-agent-A).
// We cast to access it here until the type definition is merged.
interface InterviewClient {
  start(description: string, opts?: { maxQuestions?: number; projectPath?: string }): Promise<{ runId: string }>
  subscribeEvents(runId: string): EventSource
  answer(runId: string, answer: string): Promise<void>
}

function getInterviewClient(): InterviewClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (sawClient as any).interview as InterviewClient
}

// ─── Constants ───────────────────────────────────────────────────────────────

const inputCls =
  'w-full bg-muted border border-border rounded px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring disabled:opacity-50'

const PHASES = ['Goals', 'Scope', 'Users', 'Constraints', 'Integration', 'Quality']

// ─── Component ───────────────────────────────────────────────────────────────

interface InterviewLauncherProps {
  onLaunchScout?: (description: string) => void
}

export default function InterviewLauncher({ onLaunchScout }: InterviewLauncherProps): JSX.Element {
  // Form state
  const [description, setDescription] = useState('')
  const [maxQuestions, setMaxQuestions] = useState(12)
  const [projectPath, setProjectPath] = useState('')
  const [showProjectPath, setShowProjectPath] = useState(false)

  // Interview session state
  const [runId, setRunId] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [hint, setHint] = useState<string | undefined>(undefined)
  const [phase, setPhase] = useState('')
  const [questionNum, setQuestionNum] = useState(0)
  const [maxQ, setMaxQ] = useState(0)
  const [isComplete, setIsComplete] = useState(false)
  const [requirementsPath, setRequirementsPath] = useState<string | null>(null)

  // UI state
  const [answer, setAnswer] = useState('')
  const [loading, setLoading] = useState(false)
  const [waitingForQuestion, setWaitingForQuestion] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const esRef = useRef<EventSource | null>(null)

  // Cleanup SSE on unmount
  useEffect(() => {
    return () => {
      esRef.current?.close()
    }
  }, [])

  // ── Start interview ──────────────────────────────────────────────────────

  async function handleStart() {
    if (!description.trim() || loading) return
    setLoading(true)
    setError(null)

    let newRunId: string
    try {
      const result = await getInterviewClient().start(description.trim(), {
        maxQuestions,
        projectPath: projectPath.trim() || undefined,
      })
      newRunId = result.runId
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setLoading(false)
      return
    }

    setRunId(newRunId)
    setWaitingForQuestion(true)

    const es = getInterviewClient().subscribeEvents(newRunId)
    esRef.current = es

    es.addEventListener('question', (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data) as InterviewQuestionEvent
        setQuestion(payload.text)
        setHint(payload.hint)
        setPhase(payload.phase)
        setQuestionNum(payload.question_num)
        setMaxQ(payload.max_questions)
        setAnswer('')
        setWaitingForQuestion(false)
        setLoading(false)
      } catch {
        setError('Failed to parse question event')
        setLoading(false)
      }
    })

    es.addEventListener('answer_recorded', () => {
      setWaitingForQuestion(true)
    })

    es.addEventListener('phase_complete', (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data) as { phase: string }
        setPhase(payload.phase)
      } catch {
        // non-fatal
      }
    })

    es.addEventListener('complete', (e: MessageEvent) => {
      es.close()
      esRef.current = null
      setIsComplete(true)
      setWaitingForQuestion(false)
      setLoading(false)
      try {
        const payload = JSON.parse(e.data) as { requirements_path?: string }
        setRequirementsPath(payload.requirements_path ?? null)
      } catch {
        // non-fatal
      }
    })

    es.addEventListener('error', (e: MessageEvent) => {
      es.close()
      esRef.current = null
      setWaitingForQuestion(false)
      setLoading(false)
      try {
        const payload = JSON.parse(e.data) as { message?: string }
        setError(payload.message ?? 'Interview error')
      } catch {
        setError('Interview error')
      }
    })

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        esRef.current = null
        setWaitingForQuestion(false)
        setLoading(false)
        setError(prev => prev ?? 'Connection lost')
      }
    }
  }

  // ── Submit answer ────────────────────────────────────────────────────────

  async function handleAnswer() {
    if (!runId || !answer.trim() || loading || waitingForQuestion) return
    setLoading(true)
    setError(null)
    setWaitingForQuestion(true)
    try {
      await getInterviewClient().answer(runId, answer.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setLoading(false)
      setWaitingForQuestion(false)
    }
  }

  // ── Cancel interview ─────────────────────────────────────────────────────

  function handleCancel() {
    esRef.current?.close()
    esRef.current = null
    setRunId(null)
    setQuestion('')
    setPhase('')
    setQuestionNum(0)
    setMaxQ(0)
    setAnswer('')
    setIsComplete(false)
    setRequirementsPath(null)
    setWaitingForQuestion(false)
    setLoading(false)
    setError(null)
  }

  // ── Phase progress ───────────────────────────────────────────────────────

  const phaseIndex = PHASES.findIndex(p => p.toLowerCase() === phase.toLowerCase())
  const currentPhaseNum = phaseIndex >= 0 ? phaseIndex + 1 : 1
  const totalPhases = PHASES.length

  // ── Render ───────────────────────────────────────────────────────────────

  // Completion screen
  if (isComplete) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Requirements Interview Complete</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg px-4 py-3">
            <p className="text-sm font-medium text-green-800 dark:text-green-400">
              Interview complete &#10003;
            </p>
            {requirementsPath && (
              <p className="text-xs text-green-700 dark:text-green-500 mt-1 font-mono break-all">
                {requirementsPath}
              </p>
            )}
            <p className="text-xs text-green-600/70 dark:text-green-600 mt-1">
              Requirements document generated. You can now launch Scout to plan implementation.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {onLaunchScout && (
              <button
                onClick={() => onLaunchScout(description)}
                className="text-sm font-medium px-4 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white transition-colors"
              >
                Launch Scout
              </button>
            )}
            <button
              onClick={handleCancel}
              className="text-sm font-medium px-4 py-1.5 rounded-md border border-border bg-background hover:bg-muted text-foreground transition-colors"
            >
              Start New Interview
            </button>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Active interview
  if (runId) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Requirements Interview</CardTitle>
            <button
              onClick={handleCancel}
              className="text-xs text-muted-foreground hover:text-destructive transition-colors"
            >
              Cancel
            </button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Phase progress bar */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                Phase {currentPhaseNum}/{totalPhases}: {phase || 'Starting...'}
              </span>
              {maxQ > 0 && (
                <span className="text-xs text-muted-foreground">
                  Q {questionNum}/{maxQ}
                </span>
              )}
            </div>
            <div className="w-full bg-muted rounded-full h-1.5">
              <div
                className="bg-primary h-1.5 rounded-full transition-all duration-300"
                style={{ width: `${(currentPhaseNum / totalPhases) * 100}%` }}
              />
            </div>
            <div className="flex justify-between">
              {PHASES.map((p, i) => (
                <span
                  key={p}
                  className={`text-[10px] ${i + 1 <= currentPhaseNum ? 'text-primary' : 'text-muted-foreground'}`}
                >
                  {p}
                </span>
              ))}
            </div>
          </div>

          {/* Current question */}
          <div className="space-y-2">
            {waitingForQuestion && !question ? (
              <div className="flex items-center gap-2 py-4">
                <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                <span className="text-sm text-muted-foreground animate-pulse">Generating question...</span>
              </div>
            ) : question ? (
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground leading-relaxed">{question}</p>
                {hint && (
                  <p className="text-xs text-muted-foreground italic">{hint}</p>
                )}
              </div>
            ) : null}
          </div>

          {/* Answer input */}
          <div className="space-y-2">
            <textarea
              className={`${inputCls} resize-none min-h-[80px]`}
              placeholder={waitingForQuestion ? 'Waiting for next question...' : 'Type your answer...'}
              value={answer}
              onChange={e => setAnswer(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  handleAnswer()
                }
              }}
              disabled={loading || waitingForQuestion || !question}
            />
            {error && (
              <p className="text-xs text-destructive">{error}</p>
            )}
          </div>

          {/* Submit */}
          <div className="flex justify-end">
            <button
              onClick={handleAnswer}
              disabled={loading || waitingForQuestion || !answer.trim() || !question}
              className="text-sm font-medium px-4 py-1.5 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {waitingForQuestion ? (
                <span className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
                  Processing...
                </span>
              ) : 'Submit Answer'}
            </button>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Launch form
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Requirements Interview</CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          Answer structured questions to generate a requirements document before running Scout.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Feature description */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="interview-description">
            What would you like to build?
          </label>
          <textarea
            id="interview-description"
            className={`${inputCls} resize-none min-h-[80px]`}
            placeholder="e.g. 'A feature that lets users export their data as CSV or JSON with filtering options.'"
            value={description}
            onChange={e => setDescription(e.target.value)}
            disabled={loading}
          />
        </div>

        {/* Max questions */}
        <div className="flex items-center gap-3">
          <label className="text-xs font-medium text-muted-foreground whitespace-nowrap" htmlFor="interview-max-q">
            Max questions
          </label>
          <input
            id="interview-max-q"
            type="number"
            min={3}
            max={30}
            value={maxQuestions}
            onChange={e => setMaxQuestions(Number(e.target.value))}
            className="w-20 bg-muted border border-border rounded px-3 py-1.5 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
            disabled={loading}
          />
        </div>

        {/* Project path (optional) */}
        <div>
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setShowProjectPath(v => !v)}
          >
            {showProjectPath ? '- Hide project path' : '+ Project path (optional)'}
          </button>
          {showProjectPath && (
            <input
              type="text"
              className={`mt-2 ${inputCls}`}
              placeholder="/path/to/project"
              value={projectPath}
              onChange={e => setProjectPath(e.target.value)}
              disabled={loading}
            />
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-lg px-4 py-3 text-destructive text-sm">
            <span className="font-medium">Error:</span> {error}
          </div>
        )}

        {/* Start button */}
        <div className="flex justify-end">
          <button
            onClick={handleStart}
            disabled={loading || !description.trim()}
            className="text-sm font-medium px-4 py-1.5 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
                Starting...
              </span>
            ) : 'Start Interview'}
          </button>
        </div>
      </CardContent>
    </Card>
  )
}
