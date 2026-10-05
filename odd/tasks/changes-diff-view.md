# Changes diff view

## Objective

The Changes tab must show the actual diff of a commit and of uncommitted files (staged, unstaged, untracked), not only file names and `+/−` counts.

## Problem

`buildRows` in `hooks/panel.tsx` lists commits and files, but Enter on them does nothing useful. The git data in `hooks/register.tsx` is only `status` and `--numstat`, so no diff text exists anywhere.

## Decision (default design, user may redirect)

- Enter, Space, `l`/Right on a file row expands its diff inline under the row; `h`/Left or Enter again collapses it.
- Enter on a commit row expands the full commit diff (`git show`) inline under the row.
- Diffs are fetched on demand: the client posts a `diff` message to the hook, the hook runs git and stores the text in a `diffs` atom keyed by target, and the panel receives it as a prop. The 4s refresh keeps expanded diffs current by re-running git for the open keys only.
- Sources: staged `git diff --cached -- <path>`, unstaged `git diff -- <path>`, untracked `git diff --no-index -- /dev/null <path>`, commit `git show --format= <sha>`.
- Diff lines are colored: `+` green, `-` red, `@@` cyan, file headers dim. Long diffs are capped at a fixed number of lines with a dim "N more lines" row. Binary files show a one-line note.

## Scope

- `hooks/register.tsx`, `hooks/panel.tsx`, `types/index.d.ts`, `hooks/cc-reviewer.test.ts`, `README.md`.
- No code comments or docstrings (AGENTS.md). No AI-attribution trailers in commits.

## Tasks

- [x] T1: Hook side: `diffs` atom, `diff` ui.message handling for file and commit targets, refresh of open diffs, `PanelProps.diffs` and types, tests with mocked git
- [ ] T2: Panel side: expandable file and commit rows, colored capped diff rows, key and pointer handling, README

## Acceptance criteria

- Expanding a staged, unstaged or untracked file shows its diff; collapsing hides it.
- Expanding a commit shows the whole commit diff.
- Opening a diff does not change the 4s refresh cost when nothing is expanded.
- Cursor, scrolling and the Plan tab behave as before.
- Tests pass, `claude plugin validate .` passes and `tsc -p .` shows no new errors in `hooks/register.tsx` or `hooks/panel.tsx`.

## Progress

Route: T1 and T2 by one delegated writer (2 non-trivial files plus preparation reads). Expected under 400 authored changed lines per task.

- T1 (hook side): the `diffs` atom holds `{ lines, more }` per key (`f:<group>:<path>` or `c:<sha>`, the panel row id), capped at 200 lines in the hook. A `diff` ui.message with `open: true` runs git and stores it, `open: false` drops the key, and the refresh re-fetches only the stored keys whose file or commit is still listed by git. Untracked uses `git diff --no-index`, so `run` takes the accepted exit codes (0 and 1). Directory rows and non-hex commit ids are refused. RED: 4 opening tests failed (0 diff commands run) with 38 tests total; GREEN: 38 pass. Tests observe git calls (through `process.run`) since the panel does not render diffs until T2. `claude plugin validate .` passes and `tsc` shows the same two pre-existing errors in `hooks/register.tsx`.

## Next step

T2: panel rows, keys, pointer, README.
