interface ConflictResolutionPanelProps {
  slug: string
  wave: number
  conflictingFiles: string[]
  onResolveStart: () => void
  resolvingFile?: string
  resolvedFiles: string[]
  resolutionError?: string
  failedFile?: string
  isResolving: boolean
}

export default function ConflictResolutionPanel({
  conflictingFiles,
  resolvingFile,
  resolvedFiles,
  resolutionError,
  failedFile,
  isResolving,
}: ConflictResolutionPanelProps): JSX.Element {
  return (
    <div className="mt-3 bg-violet-50 border border-violet-200 rounded-lg px-4 py-3 space-y-2 dark:bg-violet-950 dark:border-violet-800">
      <div className="flex items-center gap-2">
        {isResolving && (
          <div className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
            <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" style={{ animationDelay: '0.2s' }} />
            <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" style={{ animationDelay: '0.4s' }} />
          </div>
        )}
        <p className="text-violet-800 text-sm font-medium dark:text-violet-400">
          AI Resolving Conflicts...
        </p>
      </div>

      {resolutionError && failedFile && (
        <div className="bg-red-50 border border-red-200 rounded px-3 py-2 dark:bg-red-950 dark:border-red-800">
          <p className="text-red-800 text-xs font-medium dark:text-red-400">
            Failed to resolve {failedFile}
          </p>
          <p className="text-red-700 text-xs mt-1 dark:text-red-300">{resolutionError}</p>
        </div>
      )}

      <ul className="space-y-1 text-xs">
        {conflictingFiles.map(file => {
          const resolved = resolvedFiles.includes(file)
          const resolving = resolvingFile === file
          const failed = failedFile === file

          return (
            <li key={file} className="flex items-center gap-2">
              {resolved && (
                <span className="text-green-600 dark:text-green-400">✓</span>
              )}
              {resolving && (
                <span className="text-violet-600 dark:text-violet-400 animate-pulse">⟳</span>
              )}
              {failed && (
                <span className="text-red-600 dark:text-red-400">✗</span>
              )}
              {!resolved && !resolving && !failed && (
                <span className="text-gray-400 dark:text-gray-600">○</span>
              )}
              <span className={`font-mono ${
                resolved
                  ? 'text-green-700 dark:text-green-300'
                  : resolving
                  ? 'text-violet-700 dark:text-violet-300 font-medium'
                  : failed
                  ? 'text-red-700 dark:text-red-300'
                  : 'text-gray-600 dark:text-gray-400'
              }`}>
                {file}
              </span>
            </li>
          )
        })}
      </ul>

      {resolvedFiles.length > 0 && (
        <p className="text-xs text-violet-700 dark:text-violet-300 mt-2">
          {resolvedFiles.length} of {conflictingFiles.length} files resolved
        </p>
      )}
    </div>
  )
}
