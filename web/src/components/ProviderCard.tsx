import { useState } from 'react'
import { Eye, EyeOff, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { Button } from './ui/button'

/** Provider-specific credential configuration. */
export interface ProviderFieldDef {
  key: string
  label: string
  type: 'text' | 'password'
  optional?: boolean
}

export interface ProviderValidationResponse {
  valid: boolean
  error?: string
  identity?: string
}

interface ProviderCardProps {
  provider: string
  label: string
  fields: ProviderFieldDef[]
  config: Record<string, string>
  onChange: (config: Record<string, string>) => void
  onValidate: () => Promise<ProviderValidationResponse>
}

export default function ProviderCard({
  provider,
  label,
  fields,
  config,
  onChange,
  onValidate,
}: ProviderCardProps): JSX.Element {
  const [visibleFields, setVisibleFields] = useState<Record<string, boolean>>({})
  const [validating, setValidating] = useState(false)
  const [validationResult, setValidationResult] = useState<ProviderValidationResponse | null>(null)

  function toggleVisibility(key: string) {
    setVisibleFields(prev => ({ ...prev, [key]: !prev[key] }))
  }

  function handleFieldChange(key: string, value: string) {
    onChange({ ...config, [key]: value })
    // Clear validation when fields change
    setValidationResult(null)
  }

  async function handleValidate() {
    setValidating(true)
    setValidationResult(null)
    try {
      const result = await onValidate()
      setValidationResult(result)
    } catch (err) {
      setValidationResult({
        valid: false,
        error: err instanceof Error ? err.message : 'Connection test failed',
      })
    } finally {
      setValidating(false)
    }
  }

  // Check if any credential field has a value (to enable test button)
  const hasAnyValue = fields.some(f => (config[f.key] ?? '').trim() !== '')

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">{label}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleValidate}
          disabled={validating || !hasAnyValue}
          className="text-xs h-6 px-2"
        >
          {validating ? (
            <>
              <Loader2 size={12} className="animate-spin mr-1" />
              Testing...
            </>
          ) : (
            'Test Connection'
          )}
        </Button>
      </div>

      {fields.map(field => (
        <div key={field.key} className="flex flex-col gap-1">
          <label
            className="text-xs text-muted-foreground"
            htmlFor={`${provider}-${field.key}`}
          >
            {field.label}{field.optional ? ' (optional)' : ''}
          </label>
          <div className="relative">
            <input
              id={`${provider}-${field.key}`}
              type={field.type === 'password' && !visibleFields[field.key] ? 'password' : 'text'}
              value={config[field.key] ?? ''}
              onChange={e => handleFieldChange(field.key, e.target.value)}
              placeholder={field.optional ? 'Optional' : ''}
              className="w-full text-xs font-mono px-2 py-1.5 rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring pr-8"
            />
            {field.type === 'password' && (
              <button
                type="button"
                onClick={() => toggleVisibility(field.key)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                title={visibleFields[field.key] ? 'Hide' : 'Show'}
              >
                {visibleFields[field.key] ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            )}
          </div>
        </div>
      ))}

      {/* Validation result */}
      {validationResult && (
        <div className={`flex items-start gap-1.5 text-xs mt-1 ${validationResult.valid ? 'text-green-600 dark:text-green-400' : 'text-destructive'}`}>
          {validationResult.valid ? (
            <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
          ) : (
            <XCircle size={14} className="mt-0.5 shrink-0" />
          )}
          <span>
            {validationResult.valid
              ? `Connected${validationResult.identity ? ` as ${validationResult.identity}` : ''}`
              : validationResult.error ?? 'Validation failed'}
          </span>
        </div>
      )}
    </div>
  )
}
