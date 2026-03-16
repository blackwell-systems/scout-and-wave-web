import { useState, useEffect, useRef } from 'react'
import { Terminal, Cloud, Sparkles, Bot, Server, MonitorPlay, ChevronDown, Check } from 'lucide-react'

interface ModelPickerProps {
  value: string
  onChange: (value: string) => void
  label: string
  id: string
}

const PROVIDERS = [
  { value: 'cli', label: 'CLI (Bedrock or Max Plan)', icon: Terminal, color: 'text-slate-600 dark:text-slate-400' },
  { value: 'bedrock', label: 'Bedrock API (direct)', icon: Cloud, color: 'text-orange-600 dark:text-orange-400' },
  { value: 'anthropic', label: 'Anthropic API (Max Plan)', icon: Sparkles, color: 'text-purple-600 dark:text-purple-400' },
  { value: 'openai', label: 'OpenAI', icon: Bot, color: 'text-green-600 dark:text-green-400' },
  { value: 'ollama', label: 'Ollama (local)', icon: Server, color: 'text-blue-600 dark:text-blue-400' },
  { value: 'lmstudio', label: 'LM Studio (local)', icon: MonitorPlay, color: 'text-cyan-600 dark:text-cyan-400' },
]

const MODEL_SUGGESTIONS: Record<string, string[]> = {
  cli: ['claude-sonnet-4-5', 'claude-opus-4-6', 'claude-haiku-4-5'],
  bedrock: ['claude-sonnet-4-5', 'claude-opus-4-6', 'claude-haiku-4-5'],
  anthropic: ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'o1', 'o1-mini'],
  ollama: ['qwen2.5-coder:32b', 'qwen2.5-coder:14b', 'deepseek-coder-v2', 'llama3.1:70b', 'granite3.1-dense:8b'],
  lmstudio: ['local-model'],
}

/** Shared dropdown used for both provider and model selection. */
function Dropdown({ trigger, children, open, onToggle }: {
  trigger: React.ReactNode
  children: React.ReactNode
  open: boolean
  onToggle: (open: boolean) => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onToggle(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open, onToggle])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => onToggle(!open)}
        className="flex items-center gap-2 w-full h-[34px] text-sm px-2.5 py-1.5 rounded-md border border-border bg-background text-foreground hover:bg-muted focus:outline-none focus:ring-1 focus:ring-ring transition-colors cursor-pointer"
      >
        {trigger}
        <ChevronDown size={12} className="ml-auto text-muted-foreground shrink-0" />
      </button>
      {open && (
        <div className="absolute top-[calc(100%+4px)] left-0 z-50 min-w-full w-max max-h-[280px] overflow-y-auto rounded-lg border border-border bg-popover shadow-2xl py-1 animate-in fade-in slide-in-from-top-1 duration-150">
          {children}
        </div>
      )}
    </div>
  )
}

function DropdownItem({ selected, onClick, children }: {
  selected?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 w-full text-left text-sm px-3 py-1.5 hover:bg-muted transition-colors ${selected ? 'bg-muted/60 font-medium' : ''}`}
    >
      <span className="w-4 shrink-0">{selected && <Check size={14} className="text-primary" />}</span>
      {children}
    </button>
  )
}

export default function ModelPicker({ value, onChange, label, id }: ModelPickerProps): JSX.Element {
  const [providerOpen, setProviderOpen] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [customInput, setCustomInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Parse value into provider + model
  const [selectedProvider, selectedModel] = value.includes(':')
    ? value.split(':', 2)
    : ['anthropic', value]

  function emitChange(provider: string, model: string) {
    const full = provider === 'anthropic' && !model.includes(':') ? model : `${provider}:${model}`
    onChange(full)
  }

  function handleProviderSelect(p: string) {
    setProviderOpen(false)
    emitChange(p, selectedModel)
  }

  function handleModelSelect(m: string) {
    setModelOpen(false)
    setCustomInput('')
    emitChange(selectedProvider, m)
  }

  // Focus custom input when model dropdown opens
  useEffect(() => {
    if (modelOpen) {
      setTimeout(() => inputRef.current?.focus(), 50)
    } else {
      setCustomInput('')
    }
  }, [modelOpen])

  const currentProvider = PROVIDERS.find(p => p.value === selectedProvider)
  const ProviderIcon = currentProvider?.icon ?? Sparkles
  const suggestions = MODEL_SUGGESTIONS[selectedProvider] || []
  const filteredSuggestions = customInput
    ? suggestions.filter(s => s.toLowerCase().includes(customInput.toLowerCase()))
    : suggestions

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs text-muted-foreground" htmlFor={id}>
        {label}
      </label>
      <div className="flex gap-2 items-center">
        {/* Provider dropdown */}
        <div className="w-48">
          <Dropdown trigger={
            <>
              <ProviderIcon size={15} className={`shrink-0 ${currentProvider?.color ?? ''}`} />
              <span className="truncate">{currentProvider?.label ?? selectedProvider}</span>
            </>
          } open={providerOpen} onToggle={setProviderOpen}>
            {PROVIDERS.map(p => {
              const Icon = p.icon
              return (
                <DropdownItem key={p.value} selected={p.value === selectedProvider} onClick={() => handleProviderSelect(p.value)}>
                  <Icon size={15} className={`shrink-0 ${p.color}`} />
                  <span>{p.label}</span>
                </DropdownItem>
              )
            })}
          </Dropdown>
        </div>

        {/* Model dropdown */}
        <div className="flex-1">
          <Dropdown trigger={
            <>
              <Sparkles size={15} className="shrink-0 text-purple-600 dark:text-purple-400" />
              <span className="truncate font-mono">{selectedModel || 'Select model'}</span>
            </>
          } open={modelOpen} onToggle={setModelOpen}>
            <div className="px-2 py-1.5 border-b border-border">
              <input
                ref={inputRef}
                id={id}
                value={customInput}
                onChange={e => setCustomInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && customInput.trim()) {
                    handleModelSelect(customInput.trim())
                  }
                }}
                placeholder="Type custom model or select below"
                className="w-full text-sm px-2 py-1 rounded border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            {customInput.trim() && !filteredSuggestions.includes(customInput.trim()) && (
              <DropdownItem onClick={() => handleModelSelect(customInput.trim())}>
                <span className="text-muted-foreground">Use:</span>
                <span className="font-mono">{customInput.trim()}</span>
              </DropdownItem>
            )}
            {filteredSuggestions.map(m => (
              <DropdownItem key={m} selected={m === selectedModel} onClick={() => handleModelSelect(m)}>
                <span className="font-mono">{m}</span>
              </DropdownItem>
            ))}
          </Dropdown>
        </div>
      </div>
    </div>
  )
}
