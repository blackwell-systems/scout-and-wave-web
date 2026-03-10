import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { validateManifest, ValidationError } from '../lib/manifest'

interface ManifestValidationProps {
  slug: string
}

export default function ManifestValidation({ slug }: ManifestValidationProps): JSX.Element {
  const [validating, setValidating] = useState(false)
  const [result, setResult] = useState<{ valid: boolean; errors: ValidationError[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleValidate = async () => {
    setValidating(true)
    setError(null)
    setResult(null)

    try {
      const validationResult = await validateManifest(slug)
      setResult(validationResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation failed')
    } finally {
      setValidating(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Manifest Validation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Button
            onClick={handleValidate}
            disabled={validating}
            variant="default"
          >
            {validating ? 'Validating...' : 'Validate Manifest'}
          </Button>
        </div>

        {error && (
          <div className="p-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          </div>
        )}

        {result && (
          <div className="space-y-3">
            {result.valid ? (
              <div className="flex items-center gap-2 p-4 bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800 rounded-lg">
                <svg
                  className="w-5 h-5 text-green-600 dark:text-green-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                <span className="text-sm font-medium text-green-700 dark:text-green-400">
                  Manifest valid
                </span>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-lg">
                  <svg
                    className="w-5 h-5 text-red-600 dark:text-red-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                  <span className="text-sm font-medium text-red-700 dark:text-red-400">
                    Validation failed ({result.errors.length} error{result.errors.length !== 1 ? 's' : ''})
                  </span>
                </div>

                <div className="space-y-2">
                  {result.errors.map((err, i) => (
                    <div
                      key={i}
                      className="p-3 bg-background border border-border rounded-lg"
                    >
                      <div className="flex items-start gap-2">
                        <code className="px-1.5 py-0.5 text-xs font-mono bg-muted text-muted-foreground rounded">
                          {err.code}
                        </code>
                        {err.field && (
                          <code className="px-1.5 py-0.5 text-xs font-mono bg-muted text-muted-foreground rounded">
                            {err.field}
                          </code>
                        )}
                      </div>
                      <p className="mt-2 text-sm text-foreground">{err.message}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
