import { IMPLDocResponse } from './types'

export async function fetchImpl(slug: string): Promise<IMPLDocResponse> {
  const response = await fetch(`/api/impl/${encodeURIComponent(slug)}`)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  }
  return response.json() as Promise<IMPLDocResponse>
}

export async function approveImpl(slug: string): Promise<void> {
  const response = await fetch(`/api/impl/${encodeURIComponent(slug)}/approve`, {
    method: 'POST',
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  }
}

export async function rejectImpl(slug: string): Promise<void> {
  const response = await fetch(`/api/impl/${encodeURIComponent(slug)}/reject`, {
    method: 'POST',
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  }
}
