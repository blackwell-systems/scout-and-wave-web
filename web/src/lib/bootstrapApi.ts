// Bootstrap API types and client function.
// Agent G (ScoutLauncher) calls runBootstrap(); Agent B registers the Go endpoint.
export { subscribeScoutEvents } from '../api'
import { sawClient } from './apiClient'

export interface BootstrapRunRequest {
  description: string
  repo?: string
}
export interface BootstrapRunResponse {
  run_id: string
}
export async function runBootstrap(
  description: string,
  repo?: string
): Promise<BootstrapRunResponse> {
  return await sawClient.bootstrap.run(description, repo)
}
