// Which agents Orca would offer, read the way Orca reads them: its settings, then the CLIs on the login PATH.
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * Orca's agent catalog in its own preference order: id, name, and the commands that mean it is installed
 * (`needs`: extra commands it requires).
 * shortcut: copied from Orca 1.4.251 (tui-agent-config / tui-agent-selection); the plugin API does not expose
 * detected agents yet. Refresh this list when Orca adds agents, or drop it once the API lists them.
 */
export const AGENTS: { id: string; name: string; cmds: string[]; needs?: string[] }[] = [
  { id: 'claude', name: 'Claude', cmds: ['claude'] },
  { id: 'claude-agent-teams', name: 'Claude Agent Teams', cmds: ['orca', 'orca-dev', 'orca-ide'], needs: ['claude'] },
  { id: 'openclaude', name: 'OpenClaude', cmds: ['openclaude'] },
  { id: 'codex', name: 'Codex', cmds: ['codex'] },
  { id: 'grok', name: 'Grok', cmds: ['grok'] },
  { id: 'copilot', name: 'GitHub Copilot', cmds: ['copilot'] },
  { id: 'opencode2', name: 'OpenCode 2', cmds: ['opencode2'] },
  { id: 'opencode', name: 'OpenCode', cmds: ['opencode'] },
  { id: 'mimo-code', name: 'MiMo Code', cmds: ['mimo'] },
  { id: 'ante', name: 'Ante', cmds: ['ante'] },
  { id: 'trae', name: 'Trae', cmds: ['traecli'] },
  { id: 'muse', name: 'Muse', cmds: ['muse'] },
  { id: 'dsh', name: 'DeepSeek Harness', cmds: ['dsh-tui', 'dst'], needs: ['dsh'] },
  { id: 'qoder', name: 'Qoder CLI', cmds: ['qodercli', 'qoder'] },
  { id: 'qoder-cn', name: 'Qoder CLI China', cmds: ['qoderclicn', 'qodercn'] },
  { id: 'zcode', name: 'ZCode', cmds: ['zcode'] },
  { id: 'pi', name: 'Pi', cmds: ['pi'] },
  { id: 'omp', name: 'OMP', cmds: ['omp'] },
  { id: 'prime-agent', name: 'Prime Agent', cmds: ['prime-agent'] },
  { id: 'gemini', name: 'Gemini', cmds: ['gemini'] },
  { id: 'antigravity', name: 'Antigravity', cmds: ['agy'] },
  { id: 'aider', name: 'Aider', cmds: ['aider'] },
  { id: 'goose', name: 'Goose', cmds: ['goose'] },
  { id: 'amp', name: 'Amp', cmds: ['amp'] },
  { id: 'kilo', name: 'Kilocode', cmds: ['kilo'] },
  { id: 'kiro', name: 'Kiro', cmds: ['kiro-cli'] },
  { id: 'crush', name: 'Charm', cmds: ['crush'] },
  { id: 'aug', name: 'Auggie', cmds: ['auggie'] },
  { id: 'autohand', name: 'Autohand Code', cmds: ['autohand'] },
  { id: 'cline', name: 'Cline', cmds: ['cline'] },
  { id: 'codebuff', name: 'Codebuff', cmds: ['codebuff'] },
  { id: 'freebuff', name: 'Freebuff', cmds: ['freebuff'] },
  { id: 'command-code', name: 'Command Code', cmds: ['command-code'] },
  { id: 'continue', name: 'Continue', cmds: ['cn'] },
  { id: 'cursor', name: 'Cursor', cmds: ['cursor-agent'] },
  { id: 'droid', name: 'Droid', cmds: ['droid'] },
  { id: 'kimi', name: 'Kimi', cmds: ['kimi', 'kimi-code'] },
  { id: 'mistral-vibe', name: 'Mistral Vibe', cmds: ['vibe', 'mistral-vibe'] },
  { id: 'qwen-code', name: 'Qwen Code', cmds: ['qwen'] },
  { id: 'rovo', name: 'Rovo Dev', cmds: ['acli'] },
  { id: 'hermes', name: 'Hermes', cmds: ['hermes'] },
  { id: 'devin', name: 'Devin', cmds: ['devin'] },
  { id: 'openclaw', name: 'OpenClaw', cmds: ['openclaw'] },
  { id: 'codebuddy', name: 'CodeBuddy', cmds: ['codebuddy', 'cbc'] },
  { id: 'jcode', name: 'Jcode', cmds: ['jcode'] }
]

type AgentSettings = { defaultTuiAgent?: string | null; disabledTuiAgents?: string[] }

/** Orca's own settings file; missing or unreadable means Orca's defaults. */
async function readSettings(): Promise<AgentSettings> {
  const dir = process.env.ORCA_USER_DATA_PATH || join(homedir(), 'Library', 'Application Support', 'orca')
  try {
    return (JSON.parse(await readFile(join(dir, 'orca-data.json'), 'utf8')).settings ?? {}) as AgentSettings
  } catch {
    return {}
  }
}

/** The commands found on the login shell's PATH, the one Orca's terminals use (the worker's may be shorter). */
async function foundCommands(): Promise<Set<string>> {
  const names = [...new Set(AGENTS.flatMap((a) => [...a.cmds, ...(a.needs ?? [])]))]
  // Names are fixed above, never user input, so they are safe in the script; they also pass as $@.
  const script = 'for c in "$@"; do command -v "$c" >/dev/null 2>&1 && echo "$c"; done; true'
  try {
    const { stdout } = await run(process.env.SHELL || '/bin/zsh', ['-lc', script, 'detect', ...names], { timeout: 10_000 })
    return new Set(stdout.split('\n').filter(Boolean))
  } catch {
    return new Set()
  }
}

/** Orca's pick: its default when installed and enabled, else the first installed and enabled agent. */
export function pickDefault(available: string[], settings: AgentSettings): string | null {
  if (settings.defaultTuiAgent === 'blank') return null
  const d = settings.defaultTuiAgent
  return d && available.includes(d) ? d : (available[0] ?? null)
}

/** Installed and not disabled, in Orca's order, with the default Orca would launch. */
export async function availableAgents(): Promise<{ agents: { id: string; name: string }[]; defaultAgent: string | null }> {
  const [settings, found] = await Promise.all([readSettings(), foundCommands()])
  const disabled = new Set(settings.disabledTuiAgents ?? [])
  const agents = AGENTS.filter(
    (a) => !disabled.has(a.id) && a.cmds.some((c) => found.has(c)) && (a.needs ?? []).every((c) => found.has(c))
  ).map(({ id, name }) => ({ id, name }))
  return { agents, defaultAgent: pickDefault(agents.map((a) => a.id), settings) }
}
