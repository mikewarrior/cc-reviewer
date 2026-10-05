import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import type {
  Git,
  GitFile,
  Layout,
  PanelProps,
  Plan,
  PlanSection,
  PlanTask,
  Settings,
} from '../types'

const PANE = 'odd-tasks'
const DIR = 'odd/tasks'
const REFRESH_MS = 4000
const BODY_LINES = 40

const plan = atom({ plugin: 'odd-tasks', key: 'plan' } as const, null)
const git = atom({ plugin: 'odd-tasks', key: 'git' } as const, null)
const settings = atom({ plugin: 'odd-tasks', key: 'settings' } as const, {
  layout: 'outline',
  nerdFont: false,
})
const active = atom({ plugin: 'odd-tasks', key: 'active' } as const, null)
const runningSince = atom({ plugin: 'odd-tasks', key: 'runningSince' } as const, null)

type Dollar = Parameters<Hook<'session.start'>>[0]

const LAYOUTS: Layout[] = ['outline', 'powerline', 'focus']
const CHECK = /^\s*[-*]\s+\[([^\]])\]\s*(.*)$/

const clean = (text: string) =>
  text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_]{1,3}/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const nameOf = (path: string) => {
  const match = /(?:^|\/)odd\/tasks\/([^/]+)\.md$/.exec(path)

  return match ? match[1]! : null
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

const parsePlan = (name: string, markdown: string): Plan => {
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
    file: `${DIR}/${name}.md`,
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

async function run($: Dollar, argv: string[]) {
  try {
    const ran = await $.process.run(argv)

    return ran.exitCode === 0 ? ran.stdout : null
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

async function refresh($: Dollar) {
  let found: Plan | null = null
  try {
    const entries = await $.fs.list(DIR)
    const files = entries
      .filter(entry => entry.kind === 'file' && entry.name.endsWith('.md'))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
    const wanted = await read($, active)
    const file = files.find(one => one.name === `${wanted}.md`) ?? files[0]
    if (file) {
      const text = await $.fs.read(`${DIR}/${file.name}`)
      found = parsePlan(file.name.replace(/\.md$/, ''), text)
    }
  } catch {
    found = null
  }
  await setPlan($, found)

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

  const status = await run($, ['git', '--no-optional-locks', 'status', '--porcelain=v1', '--branch'])
  if (status === null) {
    await setGit($, null)

    return
  }
  const [worktree, cached, log, others] = await Promise.all([
    run($, ['git', '--no-optional-locks', 'diff', '--numstat']),
    run($, ['git', '--no-optional-locks', 'diff', '--cached', '--numstat']),
    run($, ['git', '--no-optional-locks', 'log', '@{u}..HEAD', '--format=%h%x09%s', '-n', '20']),
    run($, ['git', '--no-optional-locks', 'ls-files', '--others', '--exclude-standard']),
  ])
  await setGit($, parseGit(status, worktree ?? '', cached ?? '', log ?? '', others ?? ''))
}

async function touch($: Dollar, path: string) {
  const name = nameOf(path)
  if (name !== null) await update($, active, () => name)
  await refresh($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'odd-tasks',
      description: "Show this session's ODD plan and git changes in a pane",
    })
    const saved = (await $.store.get('settings')) as Partial<Settings> | undefined
    if (saved) {
      const layout = LAYOUTS.includes(saved.layout as Layout) ? (saved.layout as Layout) : 'outline'
      await update($, settings, () => ({ layout, nerdFont: saved.nerdFont === true }))
    }
    await refresh($)
    $.clock.every(REFRESH_MS, () => refresh($))
    void $.ui.open({ id: PANE, title: 'ODD' })

    return next(e)
  })

  on('command.run', { command: 'odd-tasks' }, async $ => {
    await refresh($)
    await $.ui.open({ id: PANE, title: 'ODD' })

    return { text: 'ODD pane opened.' }
  })

  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    const ran = await next(e)
    await touch($, e.file_path)

    return ran
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    await touch($, e.file_path)

    return ran
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    await touch($, e.file_path)

    return ran
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    await refresh($)

    return ran
  })

  on('ui.message', async ($, e, next) => {
    const data = e.data as { type?: string; layout?: Layout; nerdFont?: boolean } | null
    if (data?.type === 'settings' && data.layout && LAYOUTS.includes(data.layout)) {
      const chosen: Settings = { layout: data.layout, nerdFont: data.nerdFont === true }
      await $.store.set('settings', chosen)
      await update($, settings, () => chosen)
    } else if (data?.type === 'close') {
      await $.ui.close({ id: PANE })
    }

    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Client } = $.ui.resolve(e)
    const props: PanelProps = {
      columns: e.props.bodyColumns,
      rows: e.viewport?.rows ?? 24,
      settings: await read($, settings),
      plan: await read($, plan),
      git: await read($, git),
      runningSince: await read($, runningSince),
    }

    return <Client key="panel" module="./panel.tsx" props={props} width="100%" height="100%" />
  })
}
