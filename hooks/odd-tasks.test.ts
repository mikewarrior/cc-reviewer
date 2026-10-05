import { expect, test } from 'claude-code/testing'

const NEW = [
  '# PROJ-1 - Example feature',
  '',
  '## Objective',
  '',
  'Replace the hand-written payloads with a generated client.',
  '',
  '## Acceptance criteria',
  '',
  '- [ ] criterion one',
  '- [x] criterion two',
  '',
  '## Tasks',
  '',
  '- [x] T1: Added `thing`. More detail',
  '      continuation line',
  '- [ ] T2: Wire the client',
  '- [ ] Plain task without an id',
  '',
  '## Notes',
  '',
  'Remember the fence below.',
  '',
  '```',
  '## not a heading',
  '```',
].join('\n')

const OLD = '## Tasks\n\n- [x] T1: Old feature task\n'

const PROPS = {
  title: 'ODD tasks',
  isFocused: true,
  bodyColumns: 60,
  placement: 'dock',
} as const

const STATUS = [
  '## t/feature...origin/t/feature [ahead 2, behind 1]',
  'M  staged.ts',
  'A  added.ts',
  ' M unstaged.ts',
  'MM both.ts',
  'R  old.ts -> renamed.ts',
  '?? new.ts',
  '',
].join('\n')

const stubEngine = (
  on: Parameters<Parameters<typeof test>[1]>[1],
  isMissing = false,
  status: string | null = STATUS,
) => {
  on('process.run', () => {
    if (status === null) throw new Error('not a repo')

    return { value: { exitCode: 0, stdout: status, stderr: '' } }
  })
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.list', () => {
    if (isMissing) throw new Error('ENOENT')

    return {
    value: [
      { name: 'new.md', kind: 'file', size: 1, mtimeMs: 2, isLink: false },
      { name: 'old.md', kind: 'file', size: 1, mtimeMs: 1, isLink: false },
      { name: 'notes.txt', kind: 'file', size: 1, mtimeMs: 3, isLink: false },
    ],
    }
  })
  on('fs.read', (_$, e) => ({ value: e.path.endsWith('old.md') ? OLD : NEW }))
}

const mountPane = ($: Parameters<Parameters<typeof test>[1]>[0]) =>
  $.ui.mount({
    plugin: 'odd-tasks',
    surface: 'terminal',
    component: 'Pane',
    props: PROPS,
    requestId: 'odd-tasks',
  })

test('lists every section of the newest plan, with Tasks open', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: '/work' })
  const ui = await mountPane($)

  expect(await ui.find({ text: /PROJ-1 - Example feature/ })).toBeDefined()
  expect(await ui.find({ key: 'section-0', text: /▸ Objective/ })).toBeDefined()
  expect(await ui.find({ key: 'section-1', text: /▸ Acceptance criteria/ })).toBeDefined()
  expect(await ui.find({ key: 'section-2', text: /▾ Tasks/ })).toBeDefined()
  expect(await ui.find({ key: 'section-3', text: /▸ Notes/ })).toBeDefined()
  expect(await ui.find({ text: /^ 1\/3$/ })).toBeDefined()
  expect(await ui.find({ text: /^ 1\/2$/ })).toBeDefined()
  expect(await ui.find({ key: 'task-T1', text: /T1 Added thing/ })).toBeDefined()
  expect(await ui.find({ key: 'task-T2', text: /T2 Wire the client/ })).toBeDefined()
  expect(await ui.find({ key: 'task-#3', text: /Plain task without an id/ })).toBeDefined()
  expect(await ui.find({ text: /Replace the hand-written/ })).toBeUndefined()
  expect(await ui.find({ text: /Old feature/ })).toBeUndefined()
})

test('a section expands to its markdown and collapses again', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: '/work' })
  const ui = await mountPane($)

  await ui.press({ key: 'section-0' })
  expect(await ui.find({ key: 'section-0', text: /▾ Objective/ })).toBeDefined()
  expect(await ui.find({ text: /Replace the hand-written/ })).toBeDefined()
  await ui.press({ key: 'section-0' })
  expect(await ui.find({ text: /Replace the hand-written/ })).toBeUndefined()
})

test('keeps a heading inside a code fence in its section', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: '/work' })
  const ui = await mountPane($)

  expect(await ui.find({ key: 'section-4' })).toBeUndefined()
  await ui.press({ key: 'section-3' })
  expect(await ui.find({ text: /not a heading/ })).toBeDefined()
})

test('a task expands to its detail and collapses again', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: '/work' })
  const ui = await mountPane($)

  expect(await ui.find({ text: /continuation line/ })).toBeUndefined()
  await ui.press({ key: 'task-T1' })
  expect(await ui.find({ text: /continuation line/ })).toBeDefined()
  await ui.press({ key: 'task-T1' })
  expect(await ui.find({ text: /continuation line/ })).toBeUndefined()
})

test('the Tasks header collapses and expands its list', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: '/work' })
  const ui = await mountPane($)

  await ui.press({ key: 'section-2' })
  expect(await ui.find({ key: 'section-2', text: /▸ Tasks/ })).toBeDefined()
  expect(await ui.find({ key: 'task-T2' })).toBeUndefined()
  await ui.press({ key: 'section-2' })
  expect(await ui.find({ key: 'task-T2' })).toBeDefined()
})

test('follows the task file this session reads', async ($, on) => {
  stubEngine(on)
  on('tool.call', { tool: 'Read' }, () => ({ result: '' as never }))
  await $.session.start({ cwd: '/work' })
  await $.tool.call({ tool: 'Read', file_path: 'odd/tasks/old.md' })
  const ui = await mountPane($)

  expect(await ui.find({ text: /old/ })).toBeDefined()
  expect(await ui.find({ text: /Old feature task/ })).toBeDefined()
  expect(await ui.find({ key: 'task-T2' })).toBeUndefined()
})

test('says so when odd/tasks is missing', async ($, on) => {
  stubEngine(on, true)
  await $.session.start({ cwd: '/work' })
  const ui = await mountPane($)

  expect(await ui.find({ text: /No task file/ })).toBeDefined()
})

test('opens on the Plan tab and switches to Changes with git status', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: '/work' })
  const ui = await mountPane($)

  expect(await ui.find({ key: 'tab-plan', text: /Plan/ })).toBeDefined()
  expect(await ui.find({ key: 'tab-changes', text: /Changes 6/ })).toBeDefined()
  expect(await ui.find({ text: /^t\/feature$/ })).toBeUndefined()

  await ui.press({ key: 'tab-changes' })
  expect(await ui.find({ text: /^t\/feature$/ })).toBeDefined()
  expect(await ui.find({ text: /↑2/ })).toBeDefined()
  expect(await ui.find({ text: /↓1/ })).toBeDefined()
  expect(await ui.find({ text: /origin\/t\/feature/ })).toBeDefined()
  expect(await ui.find({ key: 'git-staged', text: /▾ Staged/ })).toBeDefined()
  expect(await ui.find({ key: 'git-unstaged', text: /▾ Unstaged/ })).toBeDefined()
  expect(await ui.find({ key: 'git-untracked', text: /▾ Untracked/ })).toBeDefined()
  expect(await ui.find({ text: /staged\.ts/ })).toBeDefined()
  expect(await ui.find({ text: /renamed\.ts/ })).toBeDefined()
  expect(await ui.find({ text: /old\.ts/ })).toBeUndefined()
  expect(await ui.find({ key: 'section-0' })).toBeUndefined()

  await ui.press({ key: 'tab-plan' })
  expect(await ui.find({ key: 'section-0' })).toBeDefined()
})

test('a git group collapses', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: '/work' })
  const ui = await mountPane($)

  await ui.press({ key: 'tab-changes' })
  expect(await ui.find({ text: /new\.ts/ })).toBeDefined()
  await ui.press({ key: 'git-untracked' })
  expect(await ui.find({ key: 'git-untracked', text: /▸ Untracked/ })).toBeDefined()
  expect(await ui.find({ text: /new\.ts/ })).toBeUndefined()
})

test('says the tree is clean when nothing changed', async ($, on) => {
  stubEngine(on, false, '## main...origin/main\n')
  await $.session.start({ cwd: '/work' })
  const ui = await mountPane($)

  await ui.press({ key: 'tab-changes' })
  expect(await ui.find({ text: /working tree clean/ })).toBeDefined()
})

test('says so when the folder is not a git repository', async ($, on) => {
  stubEngine(on, false, null)
  await $.session.start({ cwd: '/work' })
  const ui = await mountPane($)

  await ui.press({ key: 'tab-changes' })
  expect(await ui.find({ text: /Not a git repository/ })).toBeDefined()
})
