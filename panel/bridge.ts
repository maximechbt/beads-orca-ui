// The only way to the worker, which runs `bd`.
import type { PluginRequestInput, PluginRequestOutput, PluginRequests } from 'orca'

// A read sent while the worker restarts can be lost: it is sent once more. Writes never are.
const WRITES: (keyof PluginRequests)[] = ['beads.act', 'beads.create', 'beads.launch']

export async function request<K extends keyof PluginRequests>(name: K, input?: PluginRequestInput<K>, timeoutMs = 60_000): Promise<PluginRequestOutput<K>> {
  // One call shape for every request; the typed overloads cannot take a generic name.
  const call = orca.plugin.request as unknown as (n: K, i: unknown, o: { timeoutMs: number }) => Promise<PluginRequestOutput<K>>
  try {
    return await call(name, input ?? {}, { timeoutMs })
  } catch (err) {
    if (WRITES.includes(name) || !['timeout', 'unavailable'].includes((err as { code?: string })?.code ?? '')) throw err
    return call(name, input ?? {}, { timeoutMs })
  }
}
