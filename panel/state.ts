// The panel's state, and what survives a reload: each workspace's view and its last list.
import type { OpenMenu } from './menu.ts'
import { messages } from '../src/i18n.ts'
import type { JsonValue } from 'orca'
import { details } from './data.ts'
import { resetShown } from './views/list.ts'

export const t = () => messages(orca.locale || 'en')

type Problem = { problem?: BeadsProblem; error?: string }

export type ListAnswer = { workspace: string | null; beads: Bead[]; ready: string[]; version?: string; unchanged?: boolean; me?: string; statuses?: CustomStatus[]; types?: string[]; closedDays?: number; closedTotal?: number; epics?: Record<string, { done: number; total: number }> } & Problem

export type ShowAnswer = { bead: BeadDetail | null } & Problem

export type Ref = { id: string; title: string }

export type Form = { kind: 'create'; parent: Ref | null } | { kind: 'launch'; bead: Ref } | { kind: 'edit'; bead: Ref }

type Tab = 'all' | 'ready' | 'epics'

type Targets = { workspaces: LaunchTarget[]; agents: { id: string; name: string }[]; current?: string | null; defaultAgent?: string | null }

const DEFAULT_UI = () => ({
  tab: 'all' as Tab,
  query: '',
  openId: null as string | null,
  form: null as Form | null,
  draft: { title: '', type: 'task', priority: '2', description: '', parent: '', labels: '', due: '', estimate: '' },
  editDraft: { title: '', type: 'task', description: '', acceptance: '', design: '', notes: '' },
  launch: { agent: '', target: '', name: '', prompt: '' },
  launched: {} as Record<string, string>,
  /** Groups the person folded or unfolded; the others follow `foldedByDefault`. */
  collapsed: {} as Record<string, boolean>,
  epicsOpen: {} as Record<string, boolean>,
  /** The memory view is open, over the list or a task. */
  memory: false,
  /** The big view's view, and the filters narrowing it. */
  view: 'board' as 'list' | 'board' | 'epics',
  /** How many days of closed tasks load: 7, 30, 90, or 0 for all. */
  closedDays: 7,
  filters: {} as { status?: string; priority?: number; assignee?: string; label?: string; epic?: string; ready?: boolean }
})

type Ui = ReturnType<typeof DEFAULT_UI>

export type Detail = { id: string; answer: ShowAnswer }

export const state = {
  /** The workspace path the view and its cache belong to; undefined until one is known. */
  ws: undefined as string | null | undefined,
  ui: DEFAULT_UI(),
  list: null as ListAnswer | null,
  loadedAt: null as number | null,
  detail: null as Detail | null,
  targets: null as Targets | null,
  reloading: 0,
  busy: false,
  outcome: null as ({ notice?: string } & Problem) | null,
  closing: null as { reason: string } | null,
  releasing: null as string | null,
  deleting: null as string | null,
  comment: '',
  cursor: null as string | null,
  secs: {} as Record<string, boolean>,
  /** The open popup menu, if any. */
  menu: null as OpenMenu | null,
  memories: null as { memories: { key: string; value: string }[]; problem?: BeadsProblem; error?: string } | null,
  /** The memory being written: `key` null for a new one. */
  memEdit: null as { key: string | null; value: string; newKey: string } | null,
  forgetting: null as string | null,
  memQuery: '',
  /** Closed tasks older than the loaded window that match the search, asked of bd. */
  olderHits: null as { q: string; beads: Bead[] } | null
}

/** Which view the main area shows; a form covers the memory view, which covers a task or the list. */
export type Route = 'list' | 'detail' | 'form' | 'memory'

export const routeOf = (): Route => (state.ui.form ? 'form' : state.ui.memory ? 'memory' : state.ui.openId ? 'detail' : 'list')

// Each workspace keeps its own view and its last answers, so the panel opens on them at once.
/** In the middle of Orca: board.html, the editor's page, marks itself wide; panels and editors get the same API, so nothing else tells them apart. */
export const WIDE = document.documentElement.dataset.layout === 'wide'
// The big view keeps its own view (tab, open task) apart from the panel's.
const CACHE_KEY = WIDE ? 'cache:board' : 'cache'

type Saved = { ui: Ui; list: ListAnswer | null; loadedAt: number | null; detail: Detail | null }

let cache: { last: string | null; byWs: Record<string, Saved> } = { last: null, byWs: {} }

let saveTimer: ReturnType<typeof setTimeout> | undefined

export function save() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    if (state.ws === undefined) return
    cache.last = state.ws
    const here = state.ws ?? ''
    // Re-inserted last, so the oldest workspace comes first; the list itself lives under its own key.
    delete cache.byWs[here]
    cache.byWs[here] = { ui: state.ui, list: null, loadedAt: state.loadedAt, detail: state.detail }
    // shortcut: keeps the 8 most recent workspaces; enough for one person's day.
    const keys = Object.keys(cache.byWs)
    for (const k of keys.slice(0, Math.max(0, keys.length - 8))) {
      delete cache.byWs[k]
      orca.storage.delete(listKey(k)).catch(() => {})
    }
    orca.storage.set(CACHE_KEY, cache as unknown as JsonValue).catch(() => {})
  }, 300)
}

const listKey = (ws: string) => `list:${ws}`
/** Changes when the tasks do: a large list is written only then, not on every press. */

/** The worker's version of the list, or a cheap stand-in for a list saved before versions existed. */
const signature = (a: ListAnswer) => a.version ?? `${a.problem ?? ''}|${a.beads.length}|${a.ready.length}|${a.beads.reduce((m, b) => (b.updated_at > m ? b.updated_at : m), '')}`

let storedSignature = ''

export function storeList() {
  const a = state.list
  if (!a || state.ws === undefined) return
  const sig = signature(a)
  if (sig === storedSignature) return
  storedSignature = sig
  orca.storage.set(listKey(state.ws ?? ''), a as unknown as JsonValue).catch(() => {})
}

export function useWorkspace(ws: string | null) {
  if (ws === state.ws) return false
  if (state.ws !== undefined) cache.byWs[state.ws ?? ''] = { ui: state.ui, list: state.list, loadedAt: state.loadedAt, detail: state.detail }
  const saved = cache.byWs[ws ?? '']
  state.ws = ws
  state.ui = { ...DEFAULT_UI(), ...(saved?.ui ?? {}) }
  state.list = saved?.list ?? null
  state.loadedAt = saved?.loadedAt ?? null
  state.detail = saved?.detail ?? null
  state.closing = state.releasing = state.menu = null
  state.comment = ''
  state.cursor = null
  resetShown()
  details.clear()
  return true
}

/** Opens on the last workspace's view and list, as they were saved. */
export async function restore() {
  try {
    const saved = await orca.storage.get(CACHE_KEY)
    if (saved && typeof saved === 'object' && 'byWs' in saved) cache = saved as unknown as typeof cache
  } catch {
    // No cache: the panel loads as on a first run.
  }
  if (cache.last === null || cache.last === undefined) return
  useWorkspace(cache.last)
  try {
    const list = await orca.storage.get(listKey(cache.last))
    if (list && typeof list === 'object' && 'beads' in list) state.list = list as unknown as ListAnswer
    if (state.list) storedSignature = signature(state.list)
  } catch {
    // No stored list: the skeleton shows until bd answers.
  }
}
