export type OddTask = { id: string; text: string; body: string; isDone: boolean }
export type OddSection = {
  title: string
  text: string
  tasks: OddTask[] | null
  done: number
  total: number
}
export type OddFeature = { name: string; title: string; sections: OddSection[] }
export type GitChange = { status: string; path: string }
export type GitStatus = {
  branch: string
  tracking: string
  ahead: number
  behind: number
  staged: GitChange[]
  unstaged: GitChange[]
  untracked: GitChange[]
}

declare module 'claude-code' {
  interface PluginState {
    'odd-tasks': {
      feature: OddFeature | null
      active: string | null
      flipped: string[]
      opened: string[]
      tab: 'plan' | 'changes'
      git: GitStatus | null
    }
  }
}
