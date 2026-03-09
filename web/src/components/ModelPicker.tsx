import { useState, useEffect } from 'react'
import { Terminal, Cloud, Sparkles, Bot, Server, MonitorPlay } from 'lucide-react'

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

export default function ModelPicker({ value, onChange, label, id }: ModelPickerProps): JSX.Element {
  // Parse the value into provider and model
  const [provider, modelName] = value.includes(':')
    ? value.split(':', 2)
    : ['anthropic', value] // default to anthropic if no prefix

  const [selectedProvider, setSelectedProvider] = useState(provider)
  const [selectedModel, setSelectedModel] = useState(modelName)
  const [inputValue, setInputValue] = useState(modelName)
  const [originalModel, setOriginalModel] = useState(modelName)

  // Update internal state when external value changes
  useEffect(() => {
    const [p, m] = value.includes(':') ? value.split(':', 2) : ['anthropic', value]
    setSelectedProvider(p)
    setSelectedModel(m)
    setInputValue(m)
    setOriginalModel(m)
  }, [value])

  function handleProviderChange(newProvider: string) {
    setSelectedProvider(newProvider)
    // Keep the same model name, but update the full value
    const fullValue = newProvider === 'anthropic' && !selectedModel.includes(':')
      ? selectedModel // anthropic is the default, no prefix needed
      : `${newProvider}:${selectedModel}`
    onChange(fullValue)
  }

  function handleModelChange(newModel: string) {
    setInputValue(newModel)
    setSelectedModel(newModel)
    // Update the full value with current provider
    const fullValue = selectedProvider === 'anthropic' && !newModel.includes(':')
      ? newModel
      : `${selectedProvider}:${newModel}`
    onChange(fullValue)
  }

  function handleInputFocus() {
    // Clear input on focus to show suggestions
    setInputValue('')
  }

  function handleInputBlur() {
    // Restore original value if input is empty
    if (inputValue === '') {
      setInputValue(originalModel)
    }
  }

  const suggestions = MODEL_SUGGESTIONS[selectedProvider] || []

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs text-muted-foreground" htmlFor={id}>
        {label}
      </label>
      <div className="flex gap-2">
        <div className="relative w-48">
          <select
            value={selectedProvider}
            onChange={e => handleProviderChange(e.target.value)}
            className="w-full text-sm pl-9 pr-3 py-1.5 rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer appearance-none"
          >
            {PROVIDERS.map(p => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          {(() => {
            const current = PROVIDERS.find(p => p.value === selectedProvider)
            if (!current) return null
            const Icon = current.icon
            return <Icon size={16} className={`absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none ${current.color}`} />
          })()}
        </div>
        <div className="flex-1">
          <input
            id={id}
            list={`${id}-suggestions`}
            value={inputValue}
            onChange={e => handleModelChange(e.target.value)}
            onFocus={handleInputFocus}
            onBlur={handleInputBlur}
            className="w-full text-sm px-3 py-1.5 rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="Model name"
          />
          <datalist id={`${id}-suggestions`}>
            {suggestions.map(s => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
      </div>
    </div>
  )
}
