export type Layout = 'outline' | 'powerline' | 'focus'
export type Settings = { layout: Layout; nerdFont: boolean }

export type TaskStatus = 'done' | 'running' | 'todo'
export type PlanTask = { id: string; text: string; status: TaskStatus }
export type PlanSection = { title: string; lines: string[]; tasks: PlanTask[] | null }
export type PlanSource = 'repo' | 'global' | 'settings' | 'default'
export type PlanSearch = { dir: string; source: PlanSource }
export type Plan = {
  ticket: string
  title: string
  file: string
  sections: PlanSection[]
}

export type GitFile = {
  st: string
  path: string
  add: number | null
  del: number | null
  count: number | null
}
export type GitCommit = { sha: string; subject: string }
export type Git = {
  branch: string
  tracking: string
  ahead: number
  behind: number
  commits: GitCommit[]
  staged: GitFile[]
  unstaged: GitFile[]
  untracked: GitFile[]
  add: number
  del: number
}

export type Diff = { lines: string[]; more: number }

export type PanelProps = {
  columns: number
  rows: number
  settings: Settings
  plan: Plan | null
  search: PlanSearch | null
  git: Git | null
  diffs: Record<string, Diff>
  runningSince: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'cc-reviewer': {
      plan: Plan | null
      search: PlanSearch | null
      git: Git | null
      diffs: Record<string, Diff>
      settings: Settings
      active: string | null
      bound: string | null
      runningSince: number | null
    }
  }
}
