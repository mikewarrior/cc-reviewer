import { expect, test } from 'claude-code/testing'

const PLAN = [
  '# PROJ-1 — Example feature',
  '',
  '## Objective',
  '',
  'Replace the hand-written payloads with a generated client.',
  '',
  '## Tasks',
  '',
  '- [x] T1: Added `thing`',
  '      continuation line',
  '- [ ] T2: Wire the client',
  '- [ ] T3: Write the docs',
  '',
  '## Notes',
  '',
  '```',
  '## not a heading',
  '```',
].join('\n')

const STATUS = [
  '## t/feature...origin/t/feature [ahead 2, behind 1]',
  'M  staged.ts',
  ' M src/unstaged.ts',
  'R  old.ts -> renamed.ts',
  '?? new.ts',
  '?? build/',
  '',
].join('\n')

type On = Parameters<Parameters<typeof test>[1]>[1]
type Dollar = Parameters<Parameters<typeof test>[1]>[0]

type Entry = { name: string; mtimeMs: number }

type Options = {
  git?: boolean
  plan?: boolean
  onSave?: (key: string, value: unknown) => void
  repo?: string | null
  folders?: Record<string, Entry[]>
  contents?: Record<string, string>
  settings?: Record<string, unknown>
  env?: Record<string, string>
  branch?: string | null
  store?: Record<string, unknown>
  diffs?: Record<string, string | { exitCode: number; stdout: string }>
  onRun?: (argv: string) => void
}

const REPO_FILE = '.claude/cc-reviewer.json'

const planOf = (title: string) => `# ${title}\n\n## Tasks\n\n- [ ] T1: Do ${title}`

const stubEngine = (
  on: On,
  {
    git = true,
    plan = true,
    onSave,
    repo = '{ "planDir": "odd/tasks" }',
    folders = plan ? { '/work/odd/tasks': [{ name: 'proj-1-example.md', mtimeMs: 2 }] } : {},
    contents = { '/work/odd/tasks/proj-1-example.md': PLAN },
    settings = {},
    env = {},
    branch = 'feat/proj-1-example',
    store = {},
    diffs = {},
    onRun,
  }: Options = {},
) => {
  on('session.start', () => ({ cwd: '/work' }))
  on('session.cwd', () => ({ value: '/work' }))
  on('settings.read', () => ({ value: settings }))
  on('env.get', (_$, e) => ({ value: env[e.name] }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('store.get', (_$, e) => ({ value: store[e.key] }))
  on('store.set', (_$, e) => {
    store[e.key] = e.value
    onSave?.(e.key, e.value)

    return { value: undefined }
  })
  on('clock.every', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 1_000_000 }))
  on('fs.list', (_$, e) => {
    const entries = folders[e.path]
    if (!entries) throw new Error('ENOENT')

    return {
      value: entries.map(entry => ({ ...entry, kind: 'file', size: 1, isLink: false })),
    }
  })
  on('fs.read', (_$, e) => {
    const text = e.path.endsWith(REPO_FILE) ? repo : contents[e.path]
    if (text === null || text === undefined) throw new Error('ENOENT')

    return { value: text }
  })
  on('prompt.attachment', () => ({ text: null }))
  on('tool.call', () => ({ result: {}, text: 'ok', isReadOnly: true }))
  on('process.run', (_$, e) => {
    if (!git) throw new Error('not a repo')
    const argv = e.argv.join(' ')
    onRun?.(e.argv.slice(2).join(' '))
    const diff = diffs[e.argv.slice(2).join(' ')]
    if (diff !== undefined) {
      const { exitCode, stdout } = typeof diff === 'string' ? { exitCode: 0, stdout: diff } : diff

      return { value: { exitCode, stdout, stderr: '' } }
    }
    if (argv.includes('--show-current')) {
      if (branch === null) return { value: { exitCode: 128, stdout: '', stderr: 'fatal' } }

      return { value: { exitCode: 0, stdout: `${branch}\n`, stderr: '' } }
    }
    const out = argv.includes('status')
      ? STATUS
      : argv.includes('--cached')
        ? '3\t1\tstaged.ts\n'
        : argv.includes('--numstat')
          ? '10\t2\tsrc/unstaged.ts\n'
          : argv.includes('log')
            ? 'abc1234\tAdd the thing\n'
            : argv.includes('ls-files')
              ? 'new.ts\nbuild/a.js\nbuild/b.js\n'
              : ''

    return { value: { exitCode: 0, stdout: out, stderr: '' } }
  })
}

const bindPlan = ($: Dollar, planFilePath: string) =>
  $.prompt.attachment({
    type: 'plan_mode',
    text: 'Plan mode is on.',
    origin: { kind: 'engine' },
    detail: { reminder: 'full', planFilePath, hasPlan: true },
  })

const mountPane = ($: Dollar) =>
  $.ui.mount({
    plugin: 'cc-reviewer',
    surface: 'terminal',
    component: 'Pane',
    props: { title: 'cc-reviewer', isFocused: true, bodyColumns: 60, placement: 'dock' },
    requestId: 'cc-reviewer',
    viewport: { columns: 60, rows: 30 },
  })

const IN = { in: 'panel' } as const

test('Plan tab: header, progress and sections with Tasks open', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: '/work' })
  const ui = await mountPane($)

  expect(await ui.find({ ...IN, text: /PROJ-1/ })).toBeDefined()
  expect(await ui.find({ ...IN, text: /Example feature/ })).toBeDefined()
  expect(await ui.find({ ...IN, text: /odd\/tasks\/proj-1-example\.md/ })).toBeDefined()
  expect(await ui.find({ ...IN, text: /▸ Objective/ })).toBeDefined()
  expect(await ui.find({ ...IN, text: /▾ Tasks/ })).toBeDefined()
  expect(await ui.find({ ...IN, text: /T1/ })).toBeDefined()
  expect(await ui.find({ ...IN, text: /Wire the client/ })).toBeDefined()
  expect(await ui.find({ ...IN, text: /Replace the hand-written/ })).toBeUndefined()
  expect(await ui.find({ ...IN, text: /not a heading/ })).toBeUndefined()
})

test('j/k move the cursor and Enter folds and unfolds a section', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: '/work' })
  const ui = await mountPane($)

  await ui.key({ ...IN, key: 'return' })
  expect(await ui.find({ ...IN, text: /Replace the hand-written/ })).toBeDefined()
  await ui.key({ ...IN, key: 'return' })
  expect(await ui.find({ ...IN, text: /Replace the hand-written/ })).toBeUndefined()

  await ui.key({ ...IN, key: 'j' })
  await ui.key({ ...IN, key: 'return' })
  expect(await ui.find({ ...IN, text: /Wire the client/ })).toBeUndefined()
  await ui.key({ ...IN, key: 'l' })
  expect(await ui.find({ ...IN, text: /Wire the client/ })).toBeDefined()
})

test('Tab and 2 switch to Changes with grouped files and stats', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: '/work' })
  const ui = await mountPane($)

  await ui.key({ ...IN, key: '2' })
  expect(await ui.find({ ...IN, text: /Changes 5/ })).toBeDefined()
  expect(await ui.find({ ...IN, text: /▾ Commits/ })).toBeDefined()
  expect(await ui.find({ ...IN, text: /Add the thing/ })).toBeDefined()
  expect(await ui.find({ ...IN, text: /▾ Staged/ })).toBeDefined()
  expect(await ui.find({ ...IN, text: /▾ Unstaged/ })).toBeDefined()
  expect(await ui.find({ ...IN, text: /▾ Untracked/ })).toBeDefined()
  expect(await ui.find({ ...IN, text: /\+10/ })).toBeDefined()
  expect(await ui.find({ ...IN, text: /\+13 −3/ })).toBeDefined()
  expect(await ui.find({ ...IN, text: /renamed\.ts/ })).toBeDefined()
  expect(await ui.find({ ...IN, text: /2 files/ })).toBeDefined()
  expect(await ui.find({ ...IN, text: /old\.ts/ })).toBeUndefined()

  await ui.key({ ...IN, key: 'tab' })
  expect(await ui.find({ ...IN, text: /▾ Tasks/ })).toBeDefined()
})

test('settings menu switches layout and persists it', async ($, on) => {
  let saved: unknown
  stubEngine(on, { onSave: (key, value) => {
      if (key === 'settings') saved = value
    }, })
  await $.session.start({ cwd: '/work' })
  const ui = await mountPane($)

  await ui.key({ ...IN, key: 's' })
  expect(await ui.find({ ...IN, text: /Settings/ })).toBeDefined()
  expect(await ui.find({ ...IN, text: /Powerline/ })).toBeDefined()
  await ui.key({ ...IN, key: 'j' })
  await ui.key({ ...IN, key: 'return' })
  expect(await ui.find({ ...IN, text: /PLAN/ })).toBeDefined()
  expect(await ui.find({ ...IN, text: /LIVE/ })).toBeDefined()
  await ui.key({ ...IN, key: 'j' })
  await ui.key({ ...IN, key: 'return' })
  expect(saved).toMatchObject({ layout: 'focus' })
  await ui.key({ ...IN, key: 's' })
  expect(await ui.find({ ...IN, text: /NOW/ })).toBeDefined()
  expect(await ui.find({ ...IN, text: /next/ })).toBeDefined()
  expect(await ui.find({ ...IN, text: /Settings/ })).toBeUndefined()
})

test('says so when there is no plan or no git repository', async ($, on) => {
  stubEngine(on, { git: false, plan: false })
  await $.session.start({ cwd: '/work' })
  const ui = await mountPane($)

  expect(await ui.find({ ...IN, text: /No plan found for this session or branch in odd\/tasks/ })).toBeDefined()
  expect(await ui.find({ ...IN, text: /cc-reviewer\.json/ })).toBeDefined()
  await ui.key({ ...IN, key: '2' })
  expect(await ui.find({ ...IN, text: /Not a git repository/ })).toBeDefined()
})

test('the repo file wins over the global option', async ($, on) => {
  stubEngine(on, {
    branch: 'feat/repo',
    folders: {
      '/work/odd/tasks': [{ name: 'repo.md', mtimeMs: 1 }],
      '/work/docs/plans': [{ name: 'global.md', mtimeMs: 9 }],
    },
    contents: {
      '/work/odd/tasks/repo.md': planOf('Repo plan'),
      '/work/docs/plans/global.md': planOf('Global plan'),
    },
  })
  await $.session.start({ cwd: '/work' })
  const ui = await mountPane($)

  expect(await ui.find({ ...IN, text: /Repo plan/ })).toBeDefined()
  expect(await ui.find({ ...IN, text: /odd\/tasks\/repo\.md/ })).toBeDefined()
  expect(await ui.find({ ...IN, text: /Global plan/ })).toBeUndefined()
})

test('the global option is used when the repo has no file', { options: { planDir: 'docs/plans' } }, async ($, on) => {
  stubEngine(on, {
    repo: null,
    branch: 'feat/global',
    folders: { '/work/docs/plans': [{ name: 'global.md', mtimeMs: 9 }] },
    contents: { '/work/docs/plans/global.md': planOf('Global plan') },
  })
  await $.session.start({ cwd: '/work' })
  const ui = await mountPane($)

  expect(await ui.find({ ...IN, text: /Global plan/ })).toBeDefined()
  expect(await ui.find({ ...IN, text: /docs\/plans\/global\.md/ })).toBeDefined()
})

for (const repo of ['{ not json', '{ "planDir": "   " }', '[]']) {
  test(`a repo file holding ${repo} is ignored`, { options: { planDir: 'docs/plans' } }, async ($, on) => {
    stubEngine(on, {
      repo,
      branch: 'feat/global',
      folders: { '/work/docs/plans': [{ name: 'global.md', mtimeMs: 9 }] },
      contents: { '/work/docs/plans/global.md': planOf('Global plan') },
    })
    await $.session.start({ cwd: '/work' })
    const ui = await mountPane($)

    expect(await ui.find({ ...IN, text: /Global plan/ })).toBeDefined()
  })
}

test('the session last touched file wins over the branch match in a configured folder', async ($, on) => {
  stubEngine(on, {
    branch: 'feat/new',
    folders: {
      '/work/odd/tasks': [
        { name: 'old.md', mtimeMs: 1 },
        { name: 'new.md', mtimeMs: 9 },
      ],
    },
    contents: {
      '/work/odd/tasks/old.md': planOf('Old plan'),
      '/work/odd/tasks/new.md': planOf('New plan'),
    },
  })
  await $.session.start({ cwd: '/work' })
  const ui = await mountPane($)
  expect(await ui.find({ ...IN, text: /New plan/ })).toBeDefined()

  await ui.unmount()
  await $.tool.call({ tool: 'Read', file_path: 'odd/tasks/old.md' })
  const again = await mountPane($)
  expect(await again.find({ ...IN, text: /Old plan/ })).toBeDefined()

  await again.unmount()
  await $.tool.call({ tool: 'Read', file_path: '/work/README.md' })
  const last = await mountPane($)
  expect(await last.find({ ...IN, text: /Old plan/ })).toBeDefined()
})

test("Claude's default folder shows only the session plan, never the newest", async ($, on) => {
  stubEngine(on, {
    repo: null,
    branch: 'feat/unrelated',
    env: { HOME: '/home/me' },
    folders: {
      '/home/me/.claude/plans': [
        { name: 'other-project.md', mtimeMs: 9 },
        { name: 'mine.md', mtimeMs: 1 },
      ],
    },
    contents: {
      '/home/me/.claude/plans/other-project.md': planOf('Other project'),
      '/home/me/.claude/plans/mine.md': planOf('My plan'),
    },
  })
  await $.session.start({ cwd: '/work' })
  const ui = await mountPane($)

  expect(await ui.find({ ...IN, text: /Other project/ })).toBeUndefined()
  expect(await ui.find({ ...IN, text: /No plan found for this session or branch in/ })).toBeDefined()
  expect(await ui.find({ ...IN, text: /cc-reviewer\.json/ })).toBeDefined()

  await ui.unmount()
  await bindPlan($, '/home/me/.claude/plans/mine.md')
  const bound = await mountPane($)
  expect(await bound.find({ ...IN, text: /My plan/ })).toBeDefined()
  expect(await bound.find({ ...IN, text: /Other project/ })).toBeUndefined()
})

test('plansDirectory shows the branch match until the session has a plan', async ($, on) => {
  stubEngine(on, {
    repo: null,
    branch: 'feat/new',
    settings: { plansDirectory: '.plans' },
    folders: {
      '/work/.plans': [
        { name: 'old.md', mtimeMs: 1 },
        { name: 'new.md', mtimeMs: 9 },
      ],
    },
    contents: {
      '/work/.plans/old.md': planOf('Old plan'),
      '/work/.plans/new.md': planOf('New plan'),
    },
  })
  await $.session.start({ cwd: '/work' })
  const ui = await mountPane($)
  expect(await ui.find({ ...IN, text: /New plan/ })).toBeDefined()

  await ui.unmount()
  await bindPlan($, '/work/.plans/old.md')
  const bound = await mountPane($)
  expect(await bound.find({ ...IN, text: /Old plan/ })).toBeDefined()
})

const TASKS = '/work/odd/tasks'

const twoPlans = {
  folders: {
    [TASKS]: [
      { name: 'foo.md', mtimeMs: 1 },
      { name: 'bar.md', mtimeMs: 9 },
    ],
  },
  contents: {
    [`${TASKS}/foo.md`]: planOf('Foo plan'),
    [`${TASKS}/bar.md`]: planOf('Bar plan'),
  },
}

test('main shows the empty state even when the folder holds files', async ($, on) => {
  stubEngine(on, { ...twoPlans, branch: 'main' })
  await $.session.start({ cwd: '/work' })
  const ui = await mountPane($)

  expect(await ui.find({ ...IN, text: /No plan found for this session or branch in/ })).toBeDefined()
  expect(await ui.find({ ...IN, text: /Foo plan|Bar plan/ })).toBeUndefined()
})

test('a feature branch shows the file named after it', async ($, on) => {
  stubEngine(on, { ...twoPlans, branch: 'feat/foo' })
  await $.session.start({ cwd: '/work' })
  const ui = await mountPane($)

  expect(await ui.find({ ...IN, text: /Foo plan/ })).toBeDefined()
  expect(await ui.find({ ...IN, text: /Bar plan/ })).toBeUndefined()
})

test('a ticket id in the branch matches the file that starts with it', async ($, on) => {
  stubEngine(on, {
    branch: 'feature/ABC-123-add-login',
    folders: {
      [TASKS]: [
        { name: 'abc-12-other.md', mtimeMs: 9 },
        { name: 'abc-123-login-work.md', mtimeMs: 1 },
      ],
    },
    contents: {
      [`${TASKS}/abc-12-other.md`]: planOf('Other ticket'),
      [`${TASKS}/abc-123-login-work.md`]: planOf('Login ticket'),
    },
  })
  await $.session.start({ cwd: '/work' })
  const ui = await mountPane($)

  expect(await ui.find({ ...IN, text: /Login ticket/ })).toBeDefined()
  expect(await ui.find({ ...IN, text: /Other ticket/ })).toBeUndefined()
})

test('a plan touched on a branch is remembered and restored in a new session on that branch', async ($, on) => {
  const saved: Record<string, unknown> = {}
  stubEngine(on, { ...twoPlans, branch: 'feat/baz', onSave: (key, value) => (saved[key] = value) })
  await $.session.start({ cwd: '/work' })
  await $.tool.call({ tool: 'Read', file_path: 'odd/tasks/bar.md' })

  expect(saved.branchPlans).toEqual({ '/work\nfeat/baz': `${TASKS}/bar.md` })
})

test('the branch memory restores its plan in a new session on the same branch', async ($, on) => {
  stubEngine(on, {
    ...twoPlans,
    branch: 'feat/baz',
    store: { branchPlans: { '/work\nfeat/baz': `${TASKS}/bar.md` } },
  })
  await $.session.start({ cwd: '/work' })
  const ui = await mountPane($)

  expect(await ui.find({ ...IN, text: /Bar plan/ })).toBeDefined()
  expect(await ui.find({ ...IN, text: /Foo plan/ })).toBeUndefined()
})

for (const branch of ['main', 'feat/other']) {
  test(`the branch memory of feat/baz is not used on ${branch}`, async ($, on) => {
    stubEngine(on, {
      ...twoPlans,
      branch,
      store: { branchPlans: { '/work\nfeat/baz': `${TASKS}/bar.md` } },
    })
    await $.session.start({ cwd: '/work' })
    const ui = await mountPane($)

    expect(await ui.find({ ...IN, text: /Bar plan/ })).toBeUndefined()
    expect(await ui.find({ ...IN, text: /No plan found for this session or branch in/ })).toBeDefined()
  })
}

test('the branch memory is ignored when its file left the folder', async ($, on) => {
  stubEngine(on, {
    ...twoPlans,
    branch: 'feat/baz',
    store: { branchPlans: { '/work\nfeat/baz': `${TASKS}/gone.md` } },
  })
  await $.session.start({ cwd: '/work' })
  const ui = await mountPane($)

  expect(await ui.find({ ...IN, text: /No plan found for this session or branch in/ })).toBeDefined()
})

for (const branch of ['main', 'master']) {
  test(`${branch} never records a branch memory`, async ($, on) => {
    const saved: string[] = []
    stubEngine(on, { ...twoPlans, branch, onSave: key => saved.push(key) })
    await $.session.start({ cwd: '/work' })
    await $.tool.call({ tool: 'Read', file_path: 'odd/tasks/bar.md' })
    await bindPlan($, `${TASKS}/foo.md`)

    expect(saved).not.toContain('branchPlans')
  })
}

for (const branch of ['', null]) {
  test(`a detached or unknown branch (${JSON.stringify(branch)}) skips the memory and the name match`, async ($, on) => {
    const saved: string[] = []
    stubEngine(on, {
      ...twoPlans,
      branch,
      onSave: key => saved.push(key),
      store: { branchPlans: { '/work\nfoo': `${TASKS}/bar.md` } },
    })
    await $.session.start({ cwd: '/work' })
    const ui = await mountPane($)

    expect(await ui.find({ ...IN, text: /No plan found for this session or branch in/ })).toBeDefined()
    expect(await ui.find({ ...IN, text: /Foo plan|Bar plan/ })).toBeUndefined()
    await $.tool.call({ tool: 'Read', file_path: 'odd/tasks/bar.md' })
    expect(saved).not.toContain('branchPlans')
  })
}

test('a bound plan is remembered for the branch when it sits in the searched folder', async ($, on) => {
  const saved: Record<string, unknown> = {}
  stubEngine(on, { ...twoPlans, branch: 'feat/baz', onSave: (key, value) => (saved[key] = value) })
  await $.session.start({ cwd: '/work' })
  await bindPlan($, `${TASKS}/bar.md`)

  expect(saved.branchPlans).toEqual({ '/work\nfeat/baz': `${TASKS}/bar.md` })
})

const DIFF_STAGED = 'diff --cached --no-color -- staged.ts'
const DIFF_UNSTAGED = 'diff --no-color -- src/unstaged.ts'
const DIFF_UNTRACKED = 'diff --no-index --no-color -- /dev/null new.ts'
const SHOW_COMMIT = 'show --no-color --format= abc1234'

const fetches = (runs: string[]) => runs.filter(run => run.includes('--no-color'))

const bash = ($: Dollar) => $.tool.call({ tool: 'Bash', command: 'true' })

for (const [key, argv] of [
  ['f:staged:staged.ts', DIFF_STAGED],
  ['f:unstaged:src/unstaged.ts', DIFF_UNSTAGED],
  ['f:untracked:new.ts', DIFF_UNTRACKED],
  ['c:abc1234', SHOW_COMMIT],
] as const) {
  test(`opening ${key} asks git for ${argv}`, async ($, on) => {
    const runs: string[] = []
    stubEngine(on, { onRun: run => runs.push(run) })
    await $.session.start({ cwd: '/work' })
    const ui = await mountPane($)
    runs.length = 0

    await ui.post({ type: 'diff', key, open: true })

    expect([...new Set(fetches(runs))]).toEqual([argv])
  })
}

for (const key of ['c:--output=/tmp/x', 'c:', 'f:untracked:build/', 'f:other:staged.ts', 'nonsense']) {
  test(`a diff request for ${JSON.stringify(key)} runs no git`, async ($, on) => {
    const runs: string[] = []
    stubEngine(on, { onRun: run => runs.push(run) })
    await $.session.start({ cwd: '/work' })
    const ui = await mountPane($)
    runs.length = 0

    await ui.post({ type: 'diff', key, open: true })

    expect(fetches(runs)).toEqual([])
  })
}

test('the refresh costs nothing extra while no diff is open', async ($, on) => {
  const runs: string[] = []
  stubEngine(on, { onRun: run => runs.push(run) })
  await $.session.start({ cwd: '/work' })
  await mountPane($)
  runs.length = 0

  await bash($)

  expect(runs.length).toBeGreaterThan(0)
  expect(fetches(runs)).toEqual([])
})

test('the refresh re-runs git for the open diffs only and stops after a close', async ($, on) => {
  const runs: string[] = []
  stubEngine(on, { onRun: run => runs.push(run) })
  await $.session.start({ cwd: '/work' })
  const ui = await mountPane($)
  await ui.post({ type: 'diff', key: 'f:staged:staged.ts', open: true })
  await ui.post({ type: 'diff', key: 'c:abc1234', open: true })
  runs.length = 0

  await bash($)
  expect(fetches(runs).sort()).toEqual([DIFF_STAGED, SHOW_COMMIT].sort())

  await ui.post({ type: 'diff', key: 'c:abc1234', open: false })
  runs.length = 0
  await bash($)
  expect(fetches(runs)).toEqual([DIFF_STAGED])

  await ui.post({ type: 'diff', key: 'f:staged:staged.ts', open: false })
  runs.length = 0
  await bash($)
  expect(fetches(runs)).toEqual([])
})

test('the refresh skips an open diff whose file or commit is gone from git', async ($, on) => {
  const runs: string[] = []
  stubEngine(on, { onRun: run => runs.push(run) })
  await $.session.start({ cwd: '/work' })
  const ui = await mountPane($)
  await ui.post({ type: 'diff', key: 'f:staged:gone.ts', open: true })
  await ui.post({ type: 'diff', key: 'c:deadbee', open: true })
  runs.length = 0

  await bash($)

  expect(fetches(runs)).toEqual([])
})
