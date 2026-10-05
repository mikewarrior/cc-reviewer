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

type Options = { git?: boolean; plan?: boolean; onSave?: (key: string, value: unknown) => void }

const stubEngine = (on: On, { git = true, plan = true, onSave }: Options = {}) => {
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', (_$, e) => {
    onSave?.(e.key, e.value)

    return { value: undefined }
  })
  on('clock.every', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 1_000_000 }))
  on('fs.list', () => {
    if (!plan) throw new Error('ENOENT')

    return {
      value: [{ name: 'proj-1-example.md', kind: 'file', size: 1, mtimeMs: 2, isLink: false }],
    }
  })
  on('fs.read', () => ({ value: PLAN }))
  on('process.run', (_$, e) => {
    if (!git) throw new Error('not a repo')
    const argv = e.argv.join(' ')
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

const mountPane = ($: Dollar) =>
  $.ui.mount({
    plugin: 'odd-tasks',
    surface: 'terminal',
    component: 'Pane',
    props: { title: 'ODD', isFocused: true, bodyColumns: 60, placement: 'dock' },
    requestId: 'odd-tasks',
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

  expect(await ui.find({ ...IN, text: /No plan file/ })).toBeDefined()
  await ui.key({ ...IN, key: '2' })
  expect(await ui.find({ ...IN, text: /Not a git repository/ })).toBeDefined()
})
