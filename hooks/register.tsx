import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import type {
  Diff,
  Git,
  GitFile,
  Layout,
  PanelProps,
  Plan,
  PlanSearch,
  PlanSection,
  PlanSource,
  PlanTask,
  Settings,
} from '../types'

const PANE = 'cc-reviewer'
const REPO_FILE = '.claude/cc-reviewer.json'
const REFRESH_MS = 4000
const BODY_LINES = 40
const BRANCH_PLANS = 'branchPlans'
const DEFAULT_BRANCHES = ['main', 'master']
const DIFF_LINES = 200
const GIT = ['git', '--no-optional-locks']
const BASE_REFS = ['origin/main', 'main', 'origin/master', 'master']
const LOG_FORMAT = ['--format=%h%x09%s', '-n', '20']
const SHA = /^[0-9a-f]{4,40}$/i

const plan = atom({ plugin: 'cc-reviewer', key: 'plan' } as const, null)
const git = atom({ plugin: 'cc-reviewer', key: 'git' } as const, null)
const settings = atom({ plugin: 'cc-reviewer', key: 'settings' } as const, {
  layout: 'outline',
  nerdFont: false,
})
const search = atom({ plugin: 'cc-reviewer', key: 'search' } as const, null)
const active = atom({ plugin: 'cc-reviewer', key: 'active' } as const, null)
const bound = atom({ plugin: 'cc-reviewer', key: 'bound' } as const, null)
const diffs = atom({ plugin: 'cc-reviewer', key: 'diffs' } as const, {})
const runningSince = atom({ plugin: 'cc-reviewer', key: 'runningSince' } as const, null)

type Dollar = Parameters<Hook<'session.start'>>[0]
type Folder = { label: string; path: string | null; source: PlanSource }

const LAYOUTS: Layout[] = ['outline', 'powerline', 'focus']
const CHECK = /^\s*[-*]\s+\[([^\]])\]\s*(.*)$/

const clean = (text: string) =>
  text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_]{1,3}/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const isAbsolute = (path: string) => /^([/\\]|[A-Za-z]:[\\/])/.test(path)

const normalize = (path: string) => {
  const parts: string[] = []
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }

  return `${/^[/\\]/.test(path) ? '/' : ''}${parts.join('/')}`
}

const resolvePath = (cwd: string, path: string) =>
  normalize(isAbsolute(path) || cwd === '' ? path : `${cwd}/${path}`)

const childOf = (dir: string, path: string) => {
  const prefix = `${dir}/`
  if (!path.startsWith(prefix)) return null
  const name = path.slice(prefix.length)

  return name !== '' && !name.includes('/') && name.endsWith('.md') ? name : null
}

const trimmed = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const matchesBranch = (branch: string, name: string) => {
  const base = slug(name.replace(/\.md$/, ''))
  if (base === '') return false
  if (slug(branch) === base || slug(branch.split('/').pop() ?? '') === base) return true
  const ticket = /[A-Za-z]+-\d+/.exec(branch)

  return ticket !== null && new RegExp(`^${ticket[0]}(?!\\d)`, 'i').test(name)
}

const bodyLines = (lines: string[]) => {
  const out: string[] = []
  for (const line of lines) {
    if (/^\s*```/.test(line) || line.trim() === '') continue
    const bullet = /^(\s*)[-*]\s+(.*)$/.exec(line)
    const text = bullet ? `• ${clean(bullet[2] ?? '')}` : clean(line)
    out.push(`${bullet && (bullet[1]?.length ?? 0) > 1 ? '  ' : ''}${text}`)
    if (out.length >= BODY_LINES) break
  }

  return out
}

const parseTasks = (lines: string[]): PlanTask[] => {
  const tasks: PlanTask[] = []
  for (const line of lines) {
    const match = CHECK.exec(line)
    if (!match) continue
    const raw = clean(match[2] ?? '')
    const labelled = /^(T\d+[a-z]?)\s*[:.-]\s*(.*)$/i.exec(raw)
    const mark = match[1] ?? ' '
    tasks.push({
      id: labelled ? labelled[1]! : `#${tasks.length + 1}`,
      text: labelled ? labelled[2]! : raw,
      status: /[xX]/.test(mark) ? 'done' : /[~>/]/.test(mark) ? 'running' : 'todo',
    })
  }

  return tasks
}

const parsePlan = (name: string, markdown: string, file: string): Plan => {
  let title = name
  let heading = ''
  let body: string[] = []
  let inFence = false
  let hasTitle = false
  const sections: PlanSection[] = []
  const flush = () => {
    if (heading !== '' || body.some(line => line.trim() !== '')) {
      const label = heading === '' ? 'Overview' : heading
      const isTasks = /^tasks\b/i.test(label)
      sections.push({
        title: label,
        lines: isTasks ? [] : bodyLines(body),
        tasks: isTasks ? parseTasks(body) : null,
      })
    }
    body = []
  }

  for (const line of markdown.split('\n')) {
    if (/^\s*```/.test(line)) inFence = !inFence
    const top = !inFence && !hasTitle && /^#\s+(.*)$/.exec(line)
    const sub = !inFence && /^##\s+(.*)$/.exec(line)
    if (top) {
      title = clean(top[1] ?? name)
      hasTitle = true
    } else if (sub) {
      flush()
      heading = clean(sub[1] ?? '')
    } else {
      body.push(line)
    }
  }
  flush()

  const all = sections.flatMap(section => section.tasks ?? [])
  if (!all.some(task => task.status === 'running')) {
    const first = all.find(task => task.status === 'todo')
    if (first) first.status = 'running'
  }

  const ticket = /^([A-Za-z]+-\d+)/.exec(name) ?? /^([A-Za-z]+-\d+)/.exec(title)

  return {
    ticket: ticket ? ticket[1]!.toUpperCase() : '',
    title: title.replace(/^[A-Za-z]+-\d+\s*[—–:-]*\s*/, '') || title,
    file,
    sections,
  }
}

const numstat = (stdout: string) => {
  const stats = new Map<string, { add: number | null; del: number | null }>()
  for (const line of stdout.split('\n')) {
    const match = /^(\S+)\t(\S+)\t(.*)$/.exec(line)
    if (!match) continue
    const path = (match[3] ?? '')
      .replace(/\{([^}]*) => ([^}]*)\}/, '$2')
      .replace(/\/\//g, '/')
      .replace(/^.* => /, '')
    stats.set(path, {
      add: match[1] === '-' ? null : Number(match[1]),
      del: match[2] === '-' ? null : Number(match[2]),
    })
  }

  return stats
}

const parseGit = (
  status: string,
  worktree: string,
  cached: string,
  log: string,
  others: string,
): Git => {
  const unstagedStats = numstat(worktree)
  const stagedStats = numstat(cached)
  const untrackedFiles = others.split('\n').filter(line => line !== '')
  const result: Git = {
    branch: '',
    tracking: '',
    ahead: 0,
    behind: 0,
    commits: [],
    staged: [],
    unstaged: [],
    untracked: [],
    add: 0,
    del: 0,
  }

  for (const line of status.split('\n')) {
    if (line.startsWith('## ')) {
      const head = line.slice(3)
      const counts = /\s\[(.*)\]$/.exec(head)
      const [branch = '', tracking = ''] = head.replace(/\s\[.*\]$/, '').split('...')
      result.branch = branch.replace(/^No commits yet on /, '')
      result.tracking = tracking
      result.ahead = Number(/ahead (\d+)/.exec(counts?.[1] ?? '')?.[1] ?? 0)
      result.behind = Number(/behind (\d+)/.exec(counts?.[1] ?? '')?.[1] ?? 0)
    } else if (line.length > 3) {
      const x = line[0]!
      const y = line[1]!
      const path = line.slice(3).replace(/^.* -> /, '')
      const file = (st: string, stats?: { add: number | null; del: number | null }): GitFile => ({
        st,
        path,
        add: stats?.add ?? null,
        del: stats?.del ?? null,
        count: null,
      })
      if (x === '?' && y === '?') {
        const isDir = path.endsWith('/')
        result.untracked.push({
          ...file('?'),
          count: isDir ? untrackedFiles.filter(one => one.startsWith(path)).length : null,
        })
      } else {
        if (x !== ' ') result.staged.push(file(x, stagedStats.get(path)))
        if (y !== ' ') result.unstaged.push(file(y, unstagedStats.get(path)))
      }
    }
  }

  for (const file of [...result.staged, ...result.unstaged]) {
    result.add += file.add ?? 0
    result.del += file.del ?? 0
  }

  for (const line of log.split('\n')) {
    const [sha, ...rest] = line.split('\t')
    if (sha) result.commits.push({ sha, subject: rest.join('\t') })
  }

  return result
}

const toDiff = (text: string): Diff => {
  const lines = text === '' ? [] : text.replace(/\r?\n$/, '').split('\n')

  return { lines: lines.slice(0, DIFF_LINES), more: Math.max(0, lines.length - DIFF_LINES) }
}

const diffCommand = (key: string) => {
  const file = /^f:(staged|unstaged|untracked):(.+)$/s.exec(key)
  if (file) {
    const path = file[2]!
    if (file[1] === 'staged') return { argv: [...GIT, 'diff', '--cached', '--no-color', '--', path], ok: [0] }
    if (file[1] === 'unstaged') return { argv: [...GIT, 'diff', '--no-color', '--', path], ok: [0] }
    if (path.endsWith('/')) return null

    return { argv: [...GIT, 'diff', '--no-index', '--no-color', '--', '/dev/null', path], ok: [0, 1] }
  }
  const commit = /^c:(.+)$/s.exec(key)
  if (commit && SHA.test(commit[1]!)) return { argv: [...GIT, 'show', '--no-color', '--format=', commit[1]!], ok: [0] }

  return null
}

const diffShown = (key: string, value: Git) => {
  const file = /^f:(staged|unstaged|untracked):(.+)$/s.exec(key)
  if (file) return value[file[1] as 'staged' | 'unstaged' | 'untracked'].some(one => one.path === file[2])

  return value.commits.some(one => `c:${one.sha}` === key)
}

async function run($: Dollar, argv: string[], ok: number[] = [0]) {
  try {
    const ran = await $.process.run(argv)

    return ok.includes(ran.exitCode) ? ran.stdout : null
  } catch {
    return null
  }
}

async function setPlan($: Dollar, value: Plan | null) {
  const before = await read($, plan)
  if (JSON.stringify(before) !== JSON.stringify(value)) await update($, plan, () => value)
}

async function setGit($: Dollar, value: Git | null) {
  const before = await read($, git)
  if (JSON.stringify(before) !== JSON.stringify(value)) await update($, git, () => value)
}

async function fetchDiff($: Dollar, key: string) {
  const command = diffCommand(key)
  if (command === null) return null

  return toDiff((await run($, command.argv, command.ok)) ?? '')
}

async function openDiff($: Dollar, key: string) {
  const fetched = await fetchDiff($, key)
  if (fetched !== null) await update($, diffs, before => ({ ...before, [key]: fetched }))
}

async function closeDiff($: Dollar, key: string) {
  await update($, diffs, before => {
    if (!(key in before)) return before
    const { [key]: _closed, ...rest } = before

    return rest
  })
}

async function refreshDiffs($: Dollar, value: Git) {
  const before = await read($, diffs)
  const keys = Object.keys(before).filter(key => diffShown(key, value))
  if (keys.length === 0) return
  const fetched = await Promise.all(keys.map(async key => [key, await fetchDiff($, key)] as const))
  const next = { ...before }
  for (const [key, text] of fetched) if (text !== null) next[key] = text
  if (JSON.stringify(next) === JSON.stringify(before)) return
  await update($, diffs, current => {
    const merged = { ...current }
    for (const key of Object.keys(next)) if (key in current) merged[key] = next[key]!

    return merged
  })
}

async function repoDir($: Dollar) {
  try {
    const parsed = JSON.parse(await $.fs.read(REPO_FILE)) as { planDir?: unknown } | null

    return trimmed(parsed?.planDir)
  } catch {
    return ''
  }
}

async function claudeFolder($: Dollar, cwd: string): Promise<Folder> {
  let configured = ''
  try {
    configured = trimmed((await $.settings.read()).plansDirectory)
  } catch {
    configured = ''
  }
  if (configured !== '') {
    return { label: configured, path: resolvePath(cwd, configured), source: 'settings' }
  }
  const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || ''

  return {
    label: '~/.claude/plans',
    path: home === '' ? null : normalize(`${home}/.claude/plans`),
    source: 'default',
  }
}

async function locate($: Dollar, globalDir: string) {
  let cwd = ''
  try {
    cwd = await $.session.cwd()
  } catch {
    cwd = ''
  }
  const configured: [string, PlanSource][] = [
    [await repoDir($), 'repo'],
    [globalDir, 'global'],
  ]
  for (const [dir, source] of configured) {
    if (dir !== '') {
      const folder: Folder = { label: dir, path: resolvePath(cwd, dir), source }

      return { cwd, folder }
    }
  }

  return { cwd, folder: await claudeFolder($, cwd) }
}

async function branchName($: Dollar) {
  const branch = trimmed(await run($, ['git', '--no-optional-locks', 'branch', '--show-current']))

  return DEFAULT_BRANCHES.includes(branch) ? '' : branch
}

async function recall($: Dollar, cwd: string, branch: string) {
  const plans = (await $.store.get(BRANCH_PLANS)) as Record<string, unknown> | undefined
  const path = plans?.[`${cwd}\n${branch}`]

  return typeof path === 'string' ? path : null
}

async function remember($: Dollar, cwd: string, path: string) {
  const branch = await branchName($)
  if (branch === '') return
  const plans = ((await $.store.get(BRANCH_PLANS)) as Record<string, unknown> | undefined) ?? {}
  const key = `${cwd}\n${branch}`
  if (plans[key] !== path) await $.store.set(BRANCH_PLANS, { ...plans, [key]: path })
}

async function refreshPlan($: Dollar, globalDir: string) {
  const { cwd, folder } = await locate($, globalDir)
  let found: Plan | null = null
  try {
    if (folder.path !== null) {
      const dir = folder.path
      const entries = await $.fs.list(dir)
      const files = entries
        .filter(entry => entry.kind === 'file' && entry.name.endsWith('.md'))
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
      const pick = async (path: string | null) => {
        const name = path === null ? null : childOf(dir, path)

        return files.find(one => one.name === name)
      }
      const byBranch = async () => {
        const branch = await branchName($)
        if (branch === '') return undefined

        return (await pick(await recall($, cwd, branch))) ?? files.find(one => matchesBranch(branch, one.name))
      }
      const file =
        (await pick(await read($, bound))) ?? (await pick(await read($, active))) ?? (await byBranch())
      if (file) {
        const text = await $.fs.read(`${dir}/${file.name}`)
        found = parsePlan(
          file.name.replace(/\.md$/, ''),
          text,
          `${folder.label.replace(/[/\\]+$/, '')}/${file.name}`,
        )
      }
    }
  } catch {
    found = null
  }
  await setPlan($, found)
  const searched: PlanSearch = { dir: folder.label, source: folder.source }
  if (JSON.stringify(await read($, search)) !== JSON.stringify(searched)) await update($, search, () => searched)

  const running = found?.sections.flatMap(s => s.tasks ?? []).find(t => t.status === 'running')
  let since: number | null = null
  if (found && running) {
    const key = `${found.file}:${running.id}`
    const saved = (await $.store.get('since')) as { key?: string; at?: number } | undefined
    if (saved?.key === key && typeof saved.at === 'number') {
      since = saved.at
    } else {
      since = await $.clock.now()
      await $.store.set('since', { key, at: since })
    }
  }
  await update($, runningSince, () => since)
}

async function baseRef($: Dollar) {
  const head = trimmed(await run($, [...GIT, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD']))
  for (const ref of head === '' ? BASE_REFS : [head, ...BASE_REFS]) {
    if ((await run($, [...GIT, 'rev-parse', '--verify', '--quiet', ref])) !== null) return ref
  }

  return null
}

async function commitLog($: Dollar) {
  const upstream = await run($, [...GIT, 'log', '@{u}..HEAD', ...LOG_FORMAT])
  if (upstream !== null) return upstream
  const base = await baseRef($)

  return base === null ? '' : ((await run($, [...GIT, 'log', `${base}..HEAD`, ...LOG_FORMAT])) ?? '')
}

async function refresh($: Dollar, globalDir: string) {
  await refreshPlan($, globalDir)

  const status = await run($, ['git', '--no-optional-locks', 'status', '--porcelain=v1', '--branch'])
  if (status === null) {
    await setGit($, null)

    return
  }
  const [worktree, cached, log, others] = await Promise.all([
    run($, ['git', '--no-optional-locks', 'diff', '--numstat']),
    run($, ['git', '--no-optional-locks', 'diff', '--cached', '--numstat']),
    commitLog($),
    run($, ['git', '--no-optional-locks', 'ls-files', '--others', '--exclude-standard']),
  ])
  const parsed = parseGit(status, worktree ?? '', cached ?? '', log, others ?? '')
  await setGit($, parsed)
  await refreshDiffs($, parsed)
}

async function bind($: Dollar, path: string, globalDir: string) {
  if (path === '') return
  await update($, bound, () => path)
  const { cwd, folder } = await locate($, globalDir)
  const absolute = resolvePath(cwd, path)
  if (folder.path !== null && childOf(folder.path, absolute) !== null) await remember($, cwd, absolute)
  await refreshPlan($, globalDir)
}

async function touch($: Dollar, path: string, globalDir: string) {
  const { cwd, folder } = await locate($, globalDir)
  if (folder.path !== null) {
    const absolute = resolvePath(cwd, path)
    if (childOf(folder.path, absolute) !== null) {
      await update($, active, () => absolute)
      await remember($, cwd, absolute)
    }
  }
  await refresh($, globalDir)
}

export const register: Register = (on, options) => {
  const globalDir = trimmed(options.planDir)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'cc-reviewer',
      description: "Show this session's plan and git changes in a pane",
    })
    const saved = (await $.store.get('settings')) as Partial<Settings> | undefined
    if (saved) {
      const layout = LAYOUTS.includes(saved.layout as Layout) ? (saved.layout as Layout) : 'outline'
      await update($, settings, () => ({ layout, nerdFont: saved.nerdFont === true }))
    }
    await refresh($, globalDir)
    $.clock.every(REFRESH_MS, () => refresh($, globalDir))
    void $.ui.open({ id: PANE, title: 'cc-reviewer' })

    return next(e)
  })

  on('command.run', { command: 'cc-reviewer' }, async $ => {
    await refresh($, globalDir)
    await $.ui.open({ id: PANE, title: 'cc-reviewer' })

    return { text: 'cc-reviewer pane opened.' }
  })

  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    const ran = await next(e)
    await touch($, e.file_path, globalDir)

    return ran
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    await touch($, e.file_path, globalDir)

    return ran
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    await touch($, e.file_path, globalDir)

    return ran
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    await refresh($, globalDir)

    return ran
  })

  on('prompt.attachment', { type: 'plan_mode' }, async ($, e, next) => {
    await bind($, trimmed(e.detail?.planFilePath), globalDir)

    return next(e)
  })

  on('prompt.attachment', { type: 'plan_mode_reentry' }, async ($, e, next) => {
    await bind($, trimmed(e.detail?.planFilePath), globalDir)

    return next(e)
  })

  on('prompt.attachment', { type: 'plan_mode_exit' }, async ($, e, next) => {
    await bind($, trimmed(e.detail?.planFilePath), globalDir)

    return next(e)
  })

  on('ui.message', async ($, e, next) => {
    const data = e.data as { type?: string; layout?: Layout; nerdFont?: boolean; key?: string; open?: boolean } | null
    if (data?.type === 'settings' && data.layout && LAYOUTS.includes(data.layout)) {
      const chosen: Settings = { layout: data.layout, nerdFont: data.nerdFont === true }
      await $.store.set('settings', chosen)
      await update($, settings, () => chosen)
    } else if (data?.type === 'diff' && typeof data.key === 'string') {
      if (data.open === true) await openDiff($, data.key)
      else await closeDiff($, data.key)
    } else if (data?.type === 'close') {
      await $.ui.close({ id: PANE })
    }

    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Client } = $.ui.resolve(e)
    const props: PanelProps = {
      columns: e.props.bodyColumns,
      rows: e.props.scroll?.bodyRows || (e.viewport?.rows ? Math.max(8, e.viewport.rows - 6) : 24),
      settings: await read($, settings),
      plan: await read($, plan),
      search: await read($, search),
      git: await read($, git),
      diffs: await read($, diffs),
      runningSince: await read($, runningSince),
    }

    return <Client key="panel" module="./panel.tsx" props={props} width="100%" height={props.rows} />
  })
}
