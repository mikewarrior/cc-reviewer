import type { ClientKeyEvent, ClientModule, ClientPointerEvent, ClientSurface } from 'claude-code'

import type { GitFile, Layout, PanelProps, PlanSource, PlanTask, Settings } from '../types'

type Seg = {
  t: string
  fg?: string
  bg?: string
  bold?: boolean
  dim?: boolean
  inv?: boolean
  ul?: boolean
  act?: string
}
type Line = Seg[]
type Tab = 'plan' | 'changes'
type State = {
  tab: Tab
  cursor: number
  top: number
  fold: Record<string, boolean>
  settingsOpen: boolean
  sCursor: number
  settings: Settings
  frame: number
}
type Row = {
  id: string
  kind: 'section' | 'body' | 'task' | 'group' | 'file' | 'commit' | 'gap'
  parent?: string
  open?: boolean
  foldable?: boolean
  title?: string
  color?: string
  count?: number
  done?: number
  total?: number
  preview?: string
  text?: string
  task?: PlanTask
  file?: GitFile
  sha?: string
  isTasks?: boolean
}

const SURFACE = 'ansi256(236)'
const SEL = 'ansi256(237)'
const DIM = 'gray'
const SPINNER = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
const LAYOUTS: Layout[] = ['outline', 'powerline', 'focus']
const LAYOUT_INFO: Record<Layout, [string, string]> = {
  outline: ['Outline', 'refined list'],
  powerline: ['Powerline', 'status bars'],
  focus: ['Focus', 'current task first'],
}
const STATUS_COLOR: Record<string, string> = {
  M: 'yellow',
  T: 'yellow',
  A: 'green',
  D: 'red',
  U: 'red',
  R: 'cyan',
  C: 'cyan',
  '?': 'cyan',
}

const icons = (nerd: boolean) =>
  nerd
    ? {
        ticket: '',
        branch: '',
        file: '',
        tasks: '',
        check: '',
        todo: '',
        sep: '',
        up: '',
        down: '',
        arrow: '',
        gear: '',
      }
    : {
        ticket: '#',
        branch: '⎇',
        file: '›',
        tasks: '≡',
        check: '✓',
        todo: '○',
        sep: '',
        up: '↑',
        down: '↓',
        arrow: '→',
        gear: '⚙',
      }

let current: PanelProps
let lastLines: Line[] = []
let listHeight = 1
let modalRect = { x: 0, y: 0, w: 0, h: 0 }

const len = (line: Line) => line.reduce((n, seg) => n + seg.t.length, 0)

const slice = (line: Line, from: number, to = Infinity): Line => {
  const out: Line = []
  let pos = 0
  for (const seg of line) {
    const a = Math.max(from - pos, 0)
    const b = Math.min(to - pos, seg.t.length)
    if (b > a) out.push({ ...seg, t: seg.t.slice(a, b) })
    pos += seg.t.length
  }

  return out
}

const withBg = (line: Line, bg?: string): Line =>
  bg ? line.map(seg => (seg.bg || seg.inv ? seg : { ...seg, bg })) : line

const fit = (line: Line, width: number, bg?: string): Line => {
  const n = len(line)
  if (n > width) {
    const cut = slice(line, 0, Math.max(0, width - 1))
    const last = cut[cut.length - 1]
    if (width > 0) cut.push({ t: '…', fg: last?.fg, bg: last?.bg, dim: last?.dim })

    return cut
  }

  return n < width ? [...line, { t: ' '.repeat(width - n), bg }] : line
}

const lr = (left: Line, right: Line, width: number, bg?: string): Line => {
  const room = Math.max(0, width - len(right) - (right.length > 0 ? 1 : 0))

  return [...fit(left, room, bg), ...(right.length > 0 ? [{ t: ' ', bg }, ...right] : [])]
}

const wrap = (text: string, width: number): string[] => {
  const indent = /^\s*/.exec(text)?.[0] ?? ''
  const hang = indent + (text.trimStart().startsWith('• ') ? '  ' : '')
  const out: string[] = []
  let line = ''
  for (const word of text.trim().split(/\s+/)) {
    let rest = word
    while (indent.length + rest.length > width && width > 4) {
      if (line !== '') {
        out.push(line)
        line = ''
      }
      out.push((out.length === 0 ? indent : hang) + rest.slice(0, width - hang.length))
      rest = rest.slice(width - hang.length)
    }
    const next = line === '' ? (out.length === 0 ? indent : hang) + rest : `${line} ${rest}`
    if (next.length > width && line !== '') {
      out.push(line)
      line = hang + rest
    } else {
      line = next
    }
  }
  if (line.trim() !== '') out.push(line)

  return out
}

const elapsed = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`

  return `${s}s`
}

const SOURCE_NOTE: Record<PlanSource, string> = {
  repo: 'set in .claude/cc-reviewer.json',
  global: 'set in the planDir plugin option',
  settings: 'the plansDirectory setting',
  default: "Claude's own plan folder",
}

const emptyPlan = (search: PanelProps['search']) => {
  const dir = search?.dir ?? 'the plan folder'
  const found = search?.source === 'default' ? `No plan for this session in ${dir}.` : `No plan found in ${dir}.`
  const note = search ? ` (${SOURCE_NOTE[search.source]})` : ''

  return [
    `${found.slice(0, -1)}${note}.`,
    'To read another folder, set "planDir" in .claude/cc-reviewer.json, for example { "planDir": "odd/tasks" }.',
  ]
}

const tasksOf = (props: PanelProps) =>
  props.plan?.sections.flatMap(section => section.tasks ?? []) ?? []

const initial = (props: PanelProps): State => ({
  tab: 'plan',
  cursor: 0,
  top: 0,
  fold: {},
  settingsOpen: false,
  sCursor: 0,
  settings: props.settings,
  frame: 0,
})

const fileCount = (props: PanelProps) =>
  new Set(
    [...(props.git?.staged ?? []), ...(props.git?.unstaged ?? []), ...(props.git?.untracked ?? [])].map(
      file => file.path,
    ),
  ).size

const buildRows = (props: PanelProps, st: State, width: number): Row[] => {
  const rows: Row[] = []
  if (st.tab === 'plan') {
    for (const section of props.plan?.sections ?? []) {
      const id = `s:${section.title}`
      const isTasks = section.tasks !== null
      const open = st.fold[id] ?? isTasks
      const tasks = section.tasks ?? []
      if (rows.length > 0) rows.push({ id: `gap:${id}`, kind: 'gap' })
      rows.push({
        id,
        kind: 'section',
        foldable: true,
        open,
        isTasks,
        title: section.title,
        done: tasks.filter(task => task.status === 'done').length,
        total: tasks.length,
        preview: section.lines[0]?.replace(/^•\s*/, ''),
      })
      if (!open) continue
      if (isTasks) {
        for (const task of tasks) rows.push({ id: `t:${task.id}`, kind: 'task', parent: id, task })
      } else {
        section.lines.forEach((line, i) => {
          for (const part of wrap(line, Math.max(8, width - 6))) {
            rows.push({ id: `b:${section.title}:${i}:${rows.length}`, kind: 'body', parent: id, text: part })
          }
        })
      }
    }
  } else {
    const git = props.git
    const groups: [string, string, string, GitFile[] | null][] = [
      ['commits', 'Commits', 'yellow', null],
      ['staged', 'Staged', 'green', git?.staged ?? []],
      ['unstaged', 'Unstaged', 'yellow', git?.unstaged ?? []],
      ['untracked', 'Untracked', 'cyan', git?.untracked ?? []],
    ]
    for (const [key, title, color, files] of groups) {
      const count = files ? files.length : (git?.commits.length ?? 0)
      if (count === 0) continue
      const id = `g:${key}`
      const open = st.fold[id] ?? true
      rows.push({ id, kind: 'group', foldable: true, open, title, color, count })
      if (!open) continue
      if (files) {
        for (const file of files) rows.push({ id: `f:${key}:${file.path}`, kind: 'file', parent: id, file })
      } else {
        for (const commit of git?.commits ?? []) {
          rows.push({ id: `c:${commit.sha}`, kind: 'commit', parent: id, sha: commit.sha, text: commit.subject })
        }
      }
    }
  }

  return rows
}

const hint = (pairs: [string, string][], bg?: string): Line =>
  pairs.flatMap(([key, label], i) => [
    { t: i === 0 ? ' ' : '  ', bg },
    { t: key, bold: true, bg },
    { t: ` ${label}`, fg: DIM, bg },
  ])

const gearSeg = (ic: ReturnType<typeof icons>, bg?: string): Seg => ({
  t: ic.gear,
  fg: DIM,
  bg,
  act: 'gear',
})

const boxLines = (lines: Line[], width: number): Line[] =>
  lines.map(line => [
    { t: ' ' },
    ...fit([{ t: ' ', bg: SURFACE }, ...withBg(line, SURFACE)], width - 3, SURFACE),
    { t: ' ', bg: SURFACE },
    { t: ' ' },
  ])

const progressOf = (props: PanelProps) => {
  const tasks = tasksOf(props)
  const done = tasks.filter(task => task.status === 'done').length

  return { tasks, done, total: tasks.length, pct: tasks.length ? Math.round((done / tasks.length) * 100) : 0 }
}

const header = (props: PanelProps, st: State, width: number): Line[] => {
  const ic = icons(st.settings.nerdFont)
  const layout = st.settings.layout
  const ticket = props.plan?.ticket ?? ''
  const branch = props.git?.branch ?? ''
  const { tasks, done, total, pct } = progressOf(props)
  const count = fileCount(props)
  const git = props.git
  const out: Line[] = []

  const rightSide = (bg?: string): Line => [
    ...(ticket ? [{ t: ticket, fg: 'magenta', bold: true, bg }] : []),
    { t: ' ', bg },
    gearSeg(ic, bg),
    { t: ' ', bg },
  ]

  if (layout === 'powerline') {
    const seg = (tab: Tab, label: string): Line => {
      const isOn = st.tab === tab
      const act = `tab:${tab}`

      return [
        isOn
          ? { t: ` ${label} `, fg: 'blue', inv: true, bold: true, act }
          : { t: ` ${label} `, fg: DIM, bg: SURFACE, act },
        ...(ic.sep ? [{ t: ic.sep, fg: isOn ? 'blue' : SURFACE, bg: SURFACE }] : []),
      ]
    }
    const left = [
      ...seg('plan', `${ic.tasks} PLAN`),
      ...seg('changes', `${ic.branch} CHANGES${count > 0 ? ` ${count}` : ''}`),
    ]
    out.push(lr(left, rightSide(SURFACE), width, SURFACE))
  } else if (layout === 'focus') {
    const tab = (id: Tab, n: string, label: string): Line => [
      st.tab === id
        ? { t: `${n} ${label}`, fg: 'blue', bold: true, ul: true, act: `tab:${id}` }
        : { t: `${n} ${label}`, fg: DIM, act: `tab:${id}` },
    ]
    out.push(
      lr([{ t: ' ' }, ...tab('plan', '1', 'Plan'), { t: '  ' }, ...tab('changes', '2', 'Changes')], rightSide(), width),
    )
  } else {
    const chip = (id: Tab, label: string, extra: string): Line => {
      const isOn = st.tab === id
      const act = `tab:${id}`

      return isOn
        ? [{ t: ` ${label}${extra} `, fg: 'blue', inv: true, bold: true, act }]
        : [
            { t: ` ${label}`, fg: DIM, bg: SURFACE, bold: true, act },
            ...(extra ? [{ t: extra, fg: 'yellow', bg: SURFACE, act }] : []),
            { t: ' ', bg: SURFACE, act },
          ]
    }
    out.push(
      lr(
        [{ t: ' ' }, ...chip('plan', 'Plan', ''), { t: ' ' }, ...chip('changes', 'Changes', count > 0 ? ` ${count}` : '')],
        rightSide(),
        width,
      ),
    )
  }

  out.push([{ t: ' ' }])

  const branchSeg: Seg = { t: `${ic.branch} ${branch}`, fg: layout === 'focus' && st.tab === 'changes' ? 'blue' : DIM }
  const titleLines = wrap(props.plan?.title ?? 'No plan found', Math.max(8, width - 6)).slice(0, 2)
  const topRow: Line =
    layout === 'powerline'
      ? [{ t: ` ${ticket} `, fg: 'magenta', inv: true, bold: true }, { t: ' ' }, branchSeg]
      : [{ t: `${ic.ticket} ${ticket}`, fg: 'magenta', bold: true }, { t: ' ' }, branchSeg]
  const boxed: Line[] = []

  if (st.tab === 'changes') {
    if (layout !== 'powerline') {
      boxed.push([{ t: ticket ? `${ic.ticket} ${ticket}` : '', fg: 'magenta', bold: true }, { t: ' ' }, branchSeg])
    } else {
      boxed.push(topRow)
    }
    const stats: Line = [
      { t: `${count} file${count === 1 ? '' : 's'}` },
      { t: '  ' },
      { t: `+${git?.add ?? 0}`, fg: 'green' },
      { t: ' ' },
      { t: `−${git?.del ?? 0}`, fg: 'red' },
    ]
    if (git && (git.ahead > 0 || git.behind > 0)) {
      stats.push({ t: '  ' })
      if (git.ahead > 0) stats.push({ t: `${ic.up}${git.ahead}`, fg: 'green' })
      if (git.behind > 0) stats.push({ t: `${ic.down}${git.behind}`, fg: 'red' })
      if (layout === 'focus' && git.tracking) stats.push({ t: ` vs ${git.tracking}`, fg: DIM })
    }
    boxed.push(stats)
    out.push(...boxLines(boxed, width), [{ t: ' ' }])

    return out
  }

  boxed.push(topRow)
  if (layout !== 'focus') {
    for (const part of titleLines) boxed.push([{ t: part, bold: true }])
    if (layout === 'outline') boxed.push([{ t: `${ic.file} ${props.plan?.file ?? ''}`, fg: DIM }])
  }

  if (layout === 'outline') {
    const label: Line = [{ t: `${done}`, fg: 'green' }, { t: `/${total}`, fg: DIM }]
    const bar = Math.max(4, width - 6 - 1 - len(label) - 1)
    const filled = total ? Math.round((done / total) * bar) : 0
    boxed.push([
      { t: ' ' },
      { t: '━'.repeat(filled), fg: 'green' },
      { t: '─'.repeat(bar - filled), fg: DIM },
      { t: ' ' },
      ...label,
    ])
  } else if (layout === 'powerline') {
    const running = tasks.findIndex(task => task.status === 'running')
    const blocks: Line = tasks.map((task, i) =>
      task.status === 'done'
        ? { t: '■', fg: 'green' }
        : i === running
          ? { t: '▣', fg: 'yellow' }
          : { t: '□', fg: DIM },
    )
    boxed.push(lr(blocks, [{ t: `${done} of ${total} · ${pct}%`, fg: DIM }], width - 6, SURFACE))
  } else {
    const now = tasks.find(task => task.status === 'running')
    const next = tasks.find(task => task.status === 'todo')
    const rail: Seg = { t: '│ ', fg: 'yellow' }
    const spin = SPINNER[st.frame % SPINNER.length]!
    boxed.push(
      now
        ? lr(
            [rail, { t: spin, fg: 'yellow' }, { t: ' NOW ', fg: 'yellow', bold: true }, { t: now.id, fg: DIM }],
            props.runningSince ? [{ t: elapsed(Date.now() - props.runningSince), fg: 'yellow' }] : [],
            width - 6,
            SURFACE,
          )
        : [rail, { t: tasks.length ? `${ic.check} all tasks done` : 'no tasks', fg: DIM }],
    )
    if (now) boxed.push([rail, { t: now.text, bold: true }])
    if (next) boxed.push([rail, { t: `next ${ic.arrow} ${next.id} ${next.text}`, fg: DIM }])
    const bar = Math.max(4, width - 6 - 8 - 5)
    const filled = total ? Math.round((done / total) * bar) : 0
    boxed.push([
      { t: 'tasks ', fg: DIM },
      { t: '[', fg: DIM },
      { t: '='.repeat(filled), fg: 'green' },
      { t: ' '.repeat(bar - filled) },
      { t: '] ', fg: DIM },
      { t: `${pct}%` },
    ])
  }
  out.push(...boxLines(boxed, width), [{ t: ' ' }])

  return out
}

const footer = (st: State, width: number, hasRunning: boolean): Line[] => {
  const layout = st.settings.layout
  const spin = SPINNER[st.frame % SPINNER.length]!
  const ic = icons(st.settings.nerdFont)
  if (layout === 'powerline') {
    const chip: Line = hasRunning
      ? [{ t: ` ${spin} LIVE `, fg: 'green', inv: true, bold: true }]
      : [{ t: ' IDLE ', fg: DIM, bg: SURFACE }]
    const sep: Line = ic.sep ? [{ t: ic.sep, fg: hasRunning ? 'green' : SURFACE, bg: SURFACE }] : []

    return [
      fit(
        [...chip, ...sep, ...hint([['j/k', 'move'], ['⏎', 'fold'], ['tab', 'switch'], ['s', 'settings'], ['q', 'close']], SURFACE)],
        width,
        SURFACE,
      ),
    ]
  }
  if (layout === 'focus') {
    return [
      lr(
        hint([['j k', 'move'], ['h l', 'fold'], ['1 2', 'tabs'], ['s', 'set']]),
        hasRunning ? [{ t: spin, fg: 'yellow' }, { t: ' ' }] : [],
        width,
      ),
    ]
  }

  return [
    [{ t: '─'.repeat(width), fg: SURFACE }],
    fit(hint([['j/k', 'move'], ['⏎', 'fold'], ['tab', 'switch'], ['s', 'settings'], ['q', 'close']]), width),
  ]
}

const rowLine = (
  row: Row,
  index: number,
  st: State,
  props: PanelProps,
  width: number,
  isCursor: boolean,
): Line => {
  if (row.kind === 'gap') return [{ t: ' ' }]
  const layout = st.settings.layout
  const ic = icons(st.settings.nerdFont)
  const bg = isCursor ? SEL : undefined
  const spin = SPINNER[st.frame % SPINNER.length]!
  const act = `row:${index}`
  const body = width - 1
  let gutter = layout === 'powerline' ? SURFACE : 'blue'
  let left: Line = []
  let right: Line = []

  if (row.kind === 'section') {
    gutter = row.isTasks ? 'yellow' : row.open ? 'blue' : SURFACE
    left = [{ t: `${row.open ? '▾' : '▸'} ${row.title}`, bold: row.open }]
    if (row.isTasks) {
      right = [{ t: `${row.done}`, fg: 'green' }, { t: `/${row.total}`, fg: DIM }]
    } else if (layout === 'focus' && !row.open && row.preview) {
      left.push({ t: `  ${row.preview}`, fg: DIM })
    }
  } else if (row.kind === 'body') {
    gutter = SURFACE
    left = [{ t: `  ${row.text}`, fg: DIM }]
  } else if (row.kind === 'task' && row.task) {
    const task = row.task
    const isRunning = task.status === 'running'
    gutter = task.status === 'done' ? 'green' : isRunning ? 'yellow' : SURFACE
    const glyph: Seg =
      task.status === 'done'
        ? { t: ic.check, fg: 'green' }
        : isRunning
          ? { t: spin, fg: 'yellow' }
          : { t: ic.todo, fg: DIM }
    const id: Seg =
      layout === 'powerline'
        ? { t: ` ${task.id} `, fg: DIM, bg: SURFACE }
        : { t: task.id, fg: DIM }
    left = [
      { t: '  ' },
      glyph,
      { t: ' ' },
      id,
      { t: '  ' },
      { t: task.text, fg: task.status === 'done' ? DIM : undefined, bold: isRunning },
    ]
    if (isRunning && props.runningSince) right = [{ t: elapsed(Date.now() - props.runningSince), fg: 'yellow' }]
  } else if (row.kind === 'group') {
    gutter = row.color ?? SURFACE
    left = [
      { t: `${row.open ? '▾' : '▸'} ${row.title}`, fg: row.color, bold: true },
      { t: ` ${row.count}`, fg: DIM },
    ]
  } else if (row.kind === 'file' && row.file) {
    const file = row.file
    const color = STATUS_COLOR[file.st] ?? 'white'
    gutter = color
    const slash = file.path.replace(/\/$/, '').lastIndexOf('/')
    const dir = slash >= 0 ? file.path.slice(0, slash + 1) : ''
    const name = file.path.slice(slash + 1)
    const stat: Seg =
      layout === 'powerline'
        ? { t: ` ${file.st} `, fg: color, inv: true, bold: true }
        : { t: file.st, fg: color, bold: true }
    left = [{ t: '  ' }, stat, { t: ' ' }, { t: name }, ...(dir ? [{ t: ` ${dir}`, fg: DIM }] : [])]
    if (file.count !== null) {
      right = [{ t: `${file.count} files`, fg: DIM }]
    } else if (file.add !== null || file.del !== null) {
      const add = file.add ?? 0
      const del = file.del ?? 0
      if (layout === 'focus') {
        const scale = Math.max(1, Math.min(8, add + del))
        const plus = add + del === 0 ? 0 : Math.round((add / (add + del)) * scale)
        right = [
          { t: '+'.repeat(plus), fg: 'green' },
          { t: '−'.repeat(scale - plus), fg: 'red' },
        ]
      } else {
        right = [
          ...(add ? [{ t: `+${add}`, fg: 'green' }] : []),
          ...(add && del ? [{ t: ' ' }] : []),
          ...(del ? [{ t: `−${del}`, fg: 'red' }] : []),
        ]
      }
    }
  } else if (row.kind === 'commit') {
    gutter = 'yellow'
    left = [{ t: '  ' }, { t: row.sha ?? '', fg: 'yellow' }, { t: ' ' }, { t: row.text ?? '' }]
  }

  const marker: Seg =
    layout === 'powerline'
      ? { t: '▎', fg: isCursor ? 'blue' : gutter, bg }
      : isCursor
        ? { t: '▌', fg: 'blue', bg }
        : { t: ' ' }
  const line = lr(withBg(left, bg), withBg(right, bg), body - 1, bg)

  return [{ ...marker, act }, ...line.map(seg => ({ ...seg, act: seg.act ?? act })), { t: ' ', bg, act }]
}

const modal = (st: State, width: number): { lines: Line[]; w: number } => {
  const w = Math.min(40, Math.max(20, width - 4))
  const inner = w - 2
  const bg = undefined
  const rule: Line = [{ t: '─'.repeat(inner - 4), fg: DIM }]
  const items: Line[] = []
  const blank: Line = [{ t: ' ' }]
  const head = (text: string): Line => [{ t: `  ${text}`, fg: DIM }]
  const option = (i: number, mark: Seg, label: string, note: string, act: string): Line => {
    const isCursor = st.sCursor === i
    const rowBg = isCursor ? SEL : bg
    const line = lr(
      withBg([{ t: ' ' }, mark, { t: ` ${label}` }], rowBg),
      withBg([{ t: note, fg: DIM }, { t: ' ' }], rowBg),
      inner - 1,
      rowBg,
    )

    return [{ t: isCursor ? '▌' : ' ', fg: 'blue', bg: rowBg, act }, ...line.map(s => ({ ...s, act }))]
  }
  items.push(blank)
  items.push(lr([{ t: ` ${icons(st.settings.nerdFont).gear} Settings`, fg: 'blue', bold: true }], [{ t: 's ', fg: DIM }], inner, bg))
  items.push(head('LAYOUT'))
  LAYOUTS.forEach((id, i) => {
    const on = st.settings.layout === id
    items.push(
      option(i, { t: on ? '●' : '○', fg: on ? 'blue' : DIM }, LAYOUT_INFO[id][0], LAYOUT_INFO[id][1], `set:${id}`),
    )
  })
  items.push(head('ICONS'))
  items.push(
    option(
      3,
      { t: st.settings.nerdFont ? '[x]' : '[ ]', fg: st.settings.nerdFont ? 'blue' : DIM },
      'Nerd Font icons',
      'needs patched font',
      'set:nerd',
    ),
  )
  items.push(blank)
  items.push([{ t: '  ' }, ...rule])
  items.push(hint([['j/k', 'move'], ['⏎', 'select'], ['s', 'close']]))
  items.push(blank)

  const boxed: Line[] = [
    [{ t: '╭', fg: 'blue' }, { t: '─'.repeat(inner), fg: 'blue' }, { t: '╮', fg: 'blue' }],
    ...items.map(item => [{ t: '│', fg: 'blue' }, ...fit(item, inner), { t: '│', fg: 'blue' }]),
    [{ t: '╰', fg: 'blue' }, { t: '─'.repeat(inner), fg: 'blue' }, { t: '╯', fg: 'blue' }],
  ]

  return { lines: boxed, w }
}

const scrollTo = (cursor: number, top: number, height: number) =>
  cursor < top ? cursor : cursor >= top + height ? cursor - height + 1 : top

const cursorRows = (props: PanelProps, st: State, width: number) => buildRows(props, st, width)

const move = (surface: ClientSurface<State>, st: State, rows: Row[], to: number) => {
  let cursor = Math.max(0, Math.min(rows.length - 1, to))
  // A gap is only spacing and always sits between two sections, so one step in the direction of travel clears it.
  if (rows[cursor]?.kind === 'gap') cursor += to >= st.cursor ? 1 : -1
  surface.setState({ ...st, cursor, top: scrollTo(cursor, st.top, listHeight) })
}

const toggle = (surface: ClientSurface<State>, st: State, rows: Row[], index: number) => {
  const row = rows[index]
  if (!row) return
  const target = row.foldable ? row : rows.find(one => one.id === row.parent)
  if (!target) return
  const at = rows.indexOf(target)
  surface.setState({
    ...st,
    fold: { ...st.fold, [target.id]: !target.open },
    cursor: at,
    top: scrollTo(at, st.top, listHeight),
  })
}

const setOpen = (surface: ClientSurface<State>, st: State, rows: Row[], index: number, open: boolean) => {
  const row = rows[index]
  if (!row) return
  const target = row.foldable ? row : rows.find(one => one.id === row.parent)
  if (!target || target.open === open) {
    if (!row.foldable && target) move(surface, st, rows, rows.indexOf(target))

    return
  }
  toggle(surface, st, rows, index)
}

const switchTab = (surface: ClientSurface<State>, st: State, tab: Tab) => {
  if (st.tab !== tab) surface.setState({ ...st, tab, cursor: 0, top: 0 })
}

const choose = (surface: ClientSurface<State>, st: State, index: number) => {
  const settings: Settings =
    index < 3
      ? { ...st.settings, layout: LAYOUTS[index]! }
      : { ...st.settings, nerdFont: !st.settings.nerdFont }
  surface.setState({ ...st, settings, sCursor: index })
  surface.post({ type: 'settings', layout: settings.layout, nerdFont: settings.nerdFont })
}

const onKey = (surface: ClientSurface<State>, ev: ClientKeyEvent) => {
  const st = surface.state
  if (!st || ev.ctrl || ev.meta) return
  const key = ev.key
  const width = surface.columns > 0 ? surface.columns : current.columns

  if (st.settingsOpen) {
    if (key === 'j' || key === 'down') surface.setState({ ...st, sCursor: Math.min(3, st.sCursor + 1) })
    else if (key === 'k' || key === 'up') surface.setState({ ...st, sCursor: Math.max(0, st.sCursor - 1) })
    else if (key === 'return' || key === ' ') choose(surface, st, st.sCursor)
    else if (key === 's' || key === ',' || key === 'q') surface.setState({ ...st, settingsOpen: false })

    return
  }

  const rows = cursorRows(current, st, width)
  if (key === 'j' || key === 'down') move(surface, st, rows, st.cursor + 1)
  else if (key === 'k' || key === 'up') move(surface, st, rows, st.cursor - 1)
  else if (key === 'g' || key === 'home') move(surface, st, rows, 0)
  else if (key === 'G' || key === 'end') move(surface, st, rows, rows.length - 1)
  else if (key === 'pagedown') move(surface, st, rows, st.cursor + listHeight)
  else if (key === 'pageup') move(surface, st, rows, st.cursor - listHeight)
  else if (key === 'return' || key === ' ') toggle(surface, st, rows, st.cursor)
  else if (key === 'h' || key === 'left') setOpen(surface, st, rows, st.cursor, false)
  else if (key === 'l' || key === 'right') setOpen(surface, st, rows, st.cursor, true)
  else if (key === 'tab') switchTab(surface, st, st.tab === 'plan' ? 'changes' : 'plan')
  else if (key === '1') switchTab(surface, st, 'plan')
  else if (key === '2') switchTab(surface, st, 'changes')
  else if (key === 's' || key === ',') surface.setState({ ...st, settingsOpen: true, sCursor: LAYOUTS.indexOf(st.settings.layout) })
  else if (key === 'q') surface.post({ type: 'close' })
}

const actAt = (x: number, y: number): string | undefined => {
  const line = lastLines[y]
  if (!line) return undefined
  let pos = 0
  for (const seg of line) {
    if (x >= pos && x < pos + seg.t.length) return seg.act

    pos += seg.t.length
  }

  return undefined
}

const onPointer = (surface: ClientSurface<State>, ev: ClientPointerEvent) => {
  const st = surface.state
  if (!st || ev.type !== 'down' || ev.button !== 'left') return
  const act = actAt(ev.x, ev.y)

  if (st.settingsOpen) {
    const inside =
      ev.x >= modalRect.x && ev.x < modalRect.x + modalRect.w && ev.y >= modalRect.y && ev.y < modalRect.y + modalRect.h
    if (!inside) surface.setState({ ...st, settingsOpen: false })
    else if (act === 'set:outline') choose(surface, st, 0)
    else if (act === 'set:powerline') choose(surface, st, 1)
    else if (act === 'set:focus') choose(surface, st, 2)
    else if (act === 'set:nerd') choose(surface, st, 3)

    return
  }
  if (act === 'tab:plan') switchTab(surface, st, 'plan')
  else if (act === 'tab:changes') switchTab(surface, st, 'changes')
  else if (act === 'gear') surface.setState({ ...st, settingsOpen: true, sCursor: LAYOUTS.indexOf(st.settings.layout) })
  else if (act?.startsWith('row:')) {
    const index = Number(act.slice(4))
    const width = surface.columns > 0 ? surface.columns : current.columns
    const rows = cursorRows(current, st, width)
    if (rows[index]) {
      surface.setState({ ...st, cursor: index })
      toggle(surface, { ...st, cursor: index }, rows, index)
    }
  }
}

const tick = (surface: ClientSurface<State>) => {
  const st = surface.state
  if (!st) return
  if (tasksOf(current).some(task => task.status === 'running') || st.settingsOpen) {
    surface.setState({ ...st, frame: st.frame + 1 })
  }
}

const Panel: ClientModule<PanelProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  current = props
  const width = surface.columns > 0 ? surface.columns : props.columns
  const height = surface.rows > 0 ? Math.min(surface.rows, props.rows) : props.rows
  const first = surface.state === undefined
  const st = surface.state ?? initial(props)
  if (first) {
    surface.setState(st)
    surface.every(100, () => tick(surface))
  }
  surface.onKey(ev => onKey(surface, ev))
  surface.onPointer(ev => onPointer(surface, ev))

  const hasRunning = tasksOf(props).some(task => task.status === 'running')
  const head = header(props, st, width)
  const foot = footer(st, width, hasRunning)
  listHeight = Math.max(1, height - head.length - foot.length)
  const rows = buildRows(props, st, width)
  const cursor = Math.max(0, Math.min(rows.length - 1, st.cursor))
  const top = Math.max(0, Math.min(scrollTo(cursor, st.top, listHeight), Math.max(0, rows.length - listHeight)))

  const list: Line[] = []
  if (rows.length === 0) {
    const messages =
      st.tab === 'plan'
        ? props.plan
          ? ['This plan has no sections.']
          : emptyPlan(props.search)
        : [props.git ? 'Working tree clean.' : 'Not a git repository.']
    const color = st.tab === 'changes' && props.git ? 'green' : DIM
    for (const message of messages) {
      for (const part of wrap(message, Math.max(8, width - 2))) list.push([{ t: ` ${part}`, fg: color }])
    }
  }
  for (let i = top; i < Math.min(rows.length, top + listHeight); i++) {
    list.push(rowLine(rows[i]!, i, st, props, width, i === cursor && !st.settingsOpen))
  }
  while (list.length < listHeight) list.push([{ t: ' ' }])

  let lines = [...head, ...list.slice(0, listHeight), ...foot]
  if (st.settingsOpen) {
    const box = modal(st, width)
    const x = Math.max(0, Math.floor((width - box.w) / 2))
    const y = Math.min(4, Math.max(0, lines.length - box.lines.length))
    modalRect = { x, y, w: box.w, h: box.lines.length }
    lines = lines.map((line, i) => {
      const k = i - y
      const dimmed = fit(line, width).map(seg => ({ ...seg, dim: true }))
      if (k < 0 || k >= box.lines.length) return dimmed

      return [...slice(dimmed, 0, x), ...fit(box.lines[k]!, box.w), ...slice(dimmed, x + box.w)]
    })
  }
  lastLines = lines

  const draw = (line: Line) => (
    <Box>
      {line
        .filter(seg => seg.t !== '')
        .map(seg => (
          <Text
            color={seg.fg}
            backgroundColor={seg.bg}
            bold={seg.bold}
            dimColor={seg.dim}
            inverse={seg.inv}
            underline={seg.ul}
          >
            {seg.t}
          </Text>
        ))}
    </Box>
  )
  const top1 = head.length
  const bottom1 = lines.length - foot.length

  // The list is the only part that gives way, so the footer stays on screen even if the region is shorter than it reports.
  return (
    <Box flexDirection="column" height={height}>
      {lines.slice(0, top1).map(draw)}
      <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
        {lines.slice(top1, bottom1).map(draw)}
      </Box>
      {lines.slice(bottom1).map(draw)}
    </Box>
  )
}

export default Panel
