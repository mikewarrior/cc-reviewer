import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import type { GitChange, GitStatus, OddFeature, OddSection, OddTask } from '../types'

const PANE = 'odd-tasks'
const DIR = 'odd/tasks'
const feature = atom({ plugin: 'odd-tasks', key: 'feature' } as const, null)
const active = atom({ plugin: 'odd-tasks', key: 'active' } as const, null)
const flipped = atom({ plugin: 'odd-tasks', key: 'flipped' } as const, [])
const opened = atom({ plugin: 'odd-tasks', key: 'opened' } as const, [])
const tab = atom({ plugin: 'odd-tasks', key: 'tab' } as const, 'plan')
const git = atom({ plugin: 'odd-tasks', key: 'git' } as const, null)

type Dollar = Parameters<Hook<'session.start'>>[0]

const clean = (text: string) => text.replace(/`/g, '').replace(/\s+/g, ' ').trim()

const clip = (text: string, room: number) =>
  text.length > room ? `${text.slice(0, Math.max(1, room - 1))}…` : text

const nameOf = (path: string) => {
  const match = /(?:^|\/)odd\/tasks\/([^/]+)\.md$/.exec(path)

  return match ? match[1]! : null
}

const clipStart = (text: string, room: number) =>
  text.length > room ? `…${text.slice(text.length - Math.max(1, room - 1))}` : text

const STATUS_COLOR: Record<string, string> = {
  M: 'yellow',
  T: 'yellow',
  A: 'green',
  D: 'red',
  U: 'red',
  R: 'cyan',
  C: 'cyan',
  '?': 'magenta',
}

const parseGit = (stdout: string): GitStatus => {
  const result: GitStatus = {
    branch: '',
    tracking: '',
    ahead: 0,
    behind: 0,
    staged: [],
    unstaged: [],
    untracked: [],
  }

  for (const line of stdout.split('\n')) {
    if (line.startsWith('## ')) {
      const head = line.slice(3)
      const counts = /\s\[(.*)\]$/.exec(head)
      const names = head.replace(/\s\[.*\]$/, '')
      const [branch = '', tracking = ''] = names.split('...')
      result.branch = branch.replace(/^No commits yet on /, '')
      result.tracking = tracking
      result.ahead = Number(/ahead (\d+)/.exec(counts?.[1] ?? '')?.[1] ?? 0)
      result.behind = Number(/behind (\d+)/.exec(counts?.[1] ?? '')?.[1] ?? 0)
    } else if (line.length > 3) {
      const x = line[0]!
      const y = line[1]!
      const path = line.slice(3).replace(/^.* -> /, '')
      if (x === '?' && y === '?') {
        result.untracked.push({ status: '?', path })
      } else {
        if (x !== ' ') result.staged.push({ status: x, path })
        if (y !== ' ') result.unstaged.push({ status: y, path })
      }
    }
  }

  return result
}

const CHECK = /^\s*[-*]\s+\[([ xX])\]\s*(.*)$/
const MARKDOWN_LIMIT = 9000

const parseTasks = (lines: string[]): OddTask[] => {
  const tasks: OddTask[] = []
  let extra: string[] = []
  const close = () => {
    const last = tasks[tasks.length - 1]
    if (last && extra.length > 0) last.body = `${last.body}\n${extra.join('\n')}`
    extra = []
  }

  for (const line of lines) {
    const match = CHECK.exec(line)
    if (match) {
      close()
      const raw = (match[2] ?? '').trim()
      const labelled = /^(T\d+[a-z]?)\s*[:.-]\s*(.*)$/i.exec(raw)
      tasks.push({
        id: labelled ? labelled[1]! : `#${tasks.length + 1}`,
        text: clean(labelled ? labelled[2]! : raw),
        body: labelled ? labelled[2]! : raw,
        isDone: match[1] !== ' ',
      })
    } else if (/^\s+\S/.test(line)) {
      extra.push(line.trimStart())
    } else {
      close()
    }
  }
  close()

  return tasks
}

const toSection = (title: string, lines: string[]): OddSection => {
  const isTasks = /^tasks\b/i.test(title)
  const tasks = isTasks ? parseTasks(lines) : null
  const checks = lines.map(line => CHECK.exec(line)).filter(match => match !== null)
  const text = lines.join('\n').trim()

  return {
    title,
    text: text.length > MARKDOWN_LIMIT ? `${text.slice(0, MARKDOWN_LIMIT)}\n…` : text,
    tasks,
    done: tasks ? tasks.filter(task => task.isDone).length : checks.filter(m => m[1] !== ' ').length,
    total: tasks ? tasks.length : checks.length,
  }
}

const parseFeature = (name: string, markdown: string): OddFeature => {
  let title = name
  let heading = ''
  let body: string[] = []
  let inFence = false
  let hasTitle = false
  const sections: OddSection[] = []
  const flush = () => {
    if (heading !== '' || body.some(line => line.trim() !== '')) {
      sections.push(toSection(heading === '' ? 'Overview' : heading, body))
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

  return { name, title, sections }
}

async function refresh($: Dollar) {
  let found: OddFeature | null = null
  try {
    const entries = await $.fs.list(DIR)
    const files = entries
      .filter(entry => entry.kind === 'file' && entry.name.endsWith('.md'))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
    const wanted = await read($, active)
    const file = files.find(one => one.name === `${wanted}.md`) ?? files[0]
    if (file) {
      const text = await $.fs.read(`${DIR}/${file.name}`)
      found = parseFeature(file.name.replace(/\.md$/, ''), text)
    }
  } catch {
    found = null
  }
  await update($, feature, () => found)

  let changes: GitStatus | null = null
  try {
    const ran = await $.process.run(['git', '--no-optional-locks', 'status', '--porcelain=v1', '--branch'])
    changes = ran.exitCode === 0 ? parseGit(ran.stdout) : null
  } catch {
    changes = null
  }
  await update($, git, () => changes)
}

async function touch($: Dollar, path: string) {
  const name = nameOf(path)
  if (name === null) return
  await update($, active, () => name)
  await refresh($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'odd-tasks',
      description: 'Show this session\'s ODD task list in a pane',
    })
    await refresh($)
    void $.ui.open({ id: PANE, title: 'ODD tasks' })

    return next(e)
  })

  on('command.run', { command: 'odd-tasks' }, async $ => {
    await refresh($)
    await $.ui.open({ id: PANE, title: 'ODD tasks' })

    return { text: 'ODD tasks pane opened.' }
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

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Markdown, Text } = $.ui.resolve(e)
    const current = await read($, feature)
    const changes = await read($, git)
    const view = await read($, tab)
    const flips = await read($, flipped)
    const expanded = await read($, opened)
    const columns = e.props.bodyColumns
    const count = changes
      ? new Set([...changes.staged, ...changes.unstaged, ...changes.untracked].map(c => c.path)).size
      : 0

    const tabs = (
      <Box>
        <Button
          key="tab-plan"
          label="Plan"
          hotkey="p"
          variant={view === 'plan' ? 'primary' : 'secondary'}
          onPress={() => update($, tab, () => 'plan')}
        />
        <Text> </Text>
        <Button
          key="tab-changes"
          label={count > 0 ? `Changes ${count}` : 'Changes'}
          hotkey="c"
          variant={view === 'changes' ? 'primary' : 'secondary'}
          onPress={() => update($, tab, () => 'changes')}
        />
      </Box>
    )

    if (view === 'changes') {
      if (changes === null) {
        return (
          <Box flexDirection="column">
            {tabs}
            <Text dimColor>Not a git repository.</Text>
          </Box>
        )
      }

      const groups = [
        { id: 'git-staged', title: 'Staged', color: 'green', list: changes.staged },
        { id: 'git-unstaged', title: 'Unstaged', color: 'yellow', list: changes.unstaged },
        { id: 'git-untracked', title: 'Untracked', color: 'magenta', list: changes.untracked },
      ]

      return (
        <Box flexDirection="column">
          {tabs}
          <Box marginTop={1}>
            <Text bold color="cyan" wrap="truncate-end">
              {changes.branch}
            </Text>
            {changes.ahead > 0 && <Text color="green"> ↑{changes.ahead}</Text>}
            {changes.behind > 0 && <Text color="red"> ↓{changes.behind}</Text>}
          </Box>
          {changes.tracking !== '' && (
            <Text dimColor wrap="truncate-end">
              → {changes.tracking}
            </Text>
          )}
          {count === 0 && <Text color="green">✓ working tree clean</Text>}
          {groups
            .filter(group => group.list.length > 0)
            .map(group => {
              const isOpen = !flips.includes(group.id)

              return (
                <Box flexDirection="column" marginTop={1}>
                  <Box>
                    <Button
                      key={group.id}
                      plain
                      label={`${isOpen ? '▾' : '▸'} ${group.title}`}
                      onPress={() =>
                        update($, flipped, list =>
                          list.includes(group.id)
                            ? list.filter(one => one !== group.id)
                            : [...list, group.id],
                        )
                      }
                    />
                    <Text bold color={group.color}>
                      {' '}
                      {group.list.length}
                    </Text>
                  </Box>
                  {isOpen &&
                    group.list.map((change: GitChange) => (
                      <Box paddingLeft={2}>
                        <Text color={STATUS_COLOR[change.status] ?? 'white'} bold>
                          {change.status}{' '}
                        </Text>
                        <Text>{clipStart(change.path, columns - 6)}</Text>
                      </Box>
                    ))}
                </Box>
              )
            })}
        </Box>
      )
    }

    if (current === null) {
      return (
        <Box flexDirection="column">
          {tabs}
          <Text dimColor>No task file in {DIR}.</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {tabs}
        <Box marginTop={1} flexDirection="column">
          <Text bold color="cyan" wrap="truncate-end">
            {current.title}
          </Text>
          <Text dimColor wrap="truncate-end">
            {DIR}/{current.name}.md
          </Text>
        </Box>
        {current.sections.map((section, index) => {
          const id = `section-${index}`
          const isTasks = section.tasks !== null
          const isOpen = isTasks !== flips.includes(id)
          const isComplete = section.total > 0 && section.done === section.total
          const firstPending = section.tasks?.find(task => !task.isDone)

          return (
            <Box flexDirection="column" marginTop={1}>
              <Box>
                <Button
                  key={id}
                  plain
                  label={clip(`${isOpen ? '▾' : '▸'} ${section.title}`, columns - 8)}
                  onPress={() =>
                    update($, flipped, list =>
                      list.includes(id) ? list.filter(one => one !== id) : [...list, id],
                    )
                  }
                />
                {section.total > 0 && (
                  <Text bold color={isComplete ? 'green' : 'yellow'}>
                    {' '}
                    {section.done}/{section.total}
                  </Text>
                )}
              </Box>
              {isOpen && section.tasks === null && section.text !== '' && (
                <Box paddingLeft={2}>
                  <Markdown text={section.text} />
                </Box>
              )}
              {isOpen &&
                section.tasks?.map(task => {
                  const isExpanded = expanded.includes(task.id)
                  const glyph = task.isDone ? '✓' : task === firstPending ? '●' : '○'
                  const color = task.isDone ? 'green' : task === firstPending ? 'yellow' : 'gray'

                  return (
                    <Box flexDirection="column" paddingLeft={2}>
                      <Box>
                        <Text color={color}>{glyph} </Text>
                        <Button
                          key={`task-${task.id}`}
                          plain
                          dimColor={task.isDone}
                          label={clip(
                            `${isExpanded ? '▾' : '▸'} ${task.id} ${task.text}`,
                            columns - 6,
                          )}
                          onPress={() =>
                            update($, opened, list =>
                              list.includes(task.id)
                                ? list.filter(one => one !== task.id)
                                : [...list, task.id],
                            )
                          }
                        />
                      </Box>
                      {isExpanded && (
                        <Box paddingLeft={4}>
                          <Markdown text={task.body.slice(0, 3000)} dimColor={task.isDone} />
                        </Box>
                      )}
                    </Box>
                  )
                })}
            </Box>
          )
        })}
      </Box>
    )
  })
}
