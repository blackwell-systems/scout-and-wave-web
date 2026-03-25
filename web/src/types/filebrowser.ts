// File browser API types (shared across frontend components)

export interface FileNode {
  name: string
  path: string
  isDir: boolean
  children?: FileNode[]
  gitStatus?: 'M' | 'A' | 'U' | 'D' | null
}

export interface FileTreeResponse {
  repo: string
  root: FileNode
}

export interface FileContentResponse {
  repo: string
  path: string
  content: string
  language: string
  size: number
}

export interface GitStatusResponse {
  repo: string
  files: Array<{
    path: string
    status: 'M' | 'A' | 'U' | 'D'
  }>
}

export interface FileResolveResponse {
  repo: string
  path: string
  found: boolean
}
