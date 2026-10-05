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
- [x] T2: Panel side: expandable file and commit rows, colored capped diff rows, key and pointer handling, README
- [x] T3: List the commits ahead of the default branch when the branch has no upstream, so the Changes tab is not empty there
- [x] T4: Restyle the inline diff rows like the GitLab inline diff: line numbers, marker and separator, full-width tints, wrapped continuation rows, hunk and per-file header rows

## Acceptance criteria

- Expanding a staged, unstaged or untracked file shows its diff; collapsing hides it.
- Expanding a commit shows the whole commit diff.
- Opening a diff does not change the 4s refresh cost when nothing is expanded.
- Cursor, scrolling and the Plan tab behave as before.
- Tests pass, `claude plugin validate .` passes and `tsc -p .` shows no new errors in `hooks/register.tsx` or `hooks/panel.tsx`.

## Progress

Route: T1 and T2 by one delegated writer (2 non-trivial files plus preparation reads). Expected under 400 authored changed lines per task.

- T1 (hook side, commit f7a2157): the `diffs` atom holds `{ lines, more }` per key (`f:<group>:<path>` or `c:<sha>`, the panel row id), capped at 200 lines in the hook. A `diff` ui.message with `open: true` runs git and stores it, `open: false` drops the key, and the refresh re-fetches only the stored keys whose file or commit is still listed by git. Untracked uses `git diff --no-index`, so `run` takes the accepted exit codes (0 and 1). Directory rows and non-hex commit ids are refused. RED: 4 opening tests failed (0 diff commands run) with 38 tests total; GREEN: 38 pass. Tests observe git calls (through `process.run`) since the panel does not render diffs until T2. `claude plugin validate .` passes and `tsc` shows the same two pre-existing errors in `hooks/register.tsx`.
- T2 (panel side, commit 69344c0): file and commit rows are foldable (`▸`/`▾` marker), Enter, Space, `l`, Right and a click expand and `h`, Left, Enter and a click collapse, each posting `{ type: 'diff', key: <row id>, open }`. New `diff` rows render the stored lines (green, red, cyan, dim headers), a dim `loading diff…`, `no textual changes` or `N more lines` row, truncated to the pane width by `fit`. Diff rows stay cursor targets so a long diff can be scrolled with j and k; Enter on one collapses its parent. Untracked folders are not expandable, so Enter on them folds the group as before. RED: 11 tests failed before the panel change; GREEN: 53 pass (including colors, exit code 1 for untracked, cap, binary, empty, truncation, click, h and l). README describes the diffs, the key table and the refresh note.
- T3 (no-upstream fallback): `git log @{u}..HEAD` is still tried first, so the cost with an upstream is unchanged. Only when it fails does `refresh` resolve a base, the first existing ref among the target of `origin/HEAD`, `origin/main`, `main`, `origin/master`, `master` (`git rev-parse --verify --quiet`), and run `git log <base>..HEAD` with the same format and `-n 20`. HEAD on the base gives an empty log, so no Commits group; no base ref also shows none. The ahead and behind numbers still come from `status`. RED: 6 tests failed (no fallback); GREEN: 62 pass. `claude plugin validate .` passes and `tsc` is at the same 35 errors as before T3, with the same 2 pre-existing ones in `hooks/register.tsx`. Commit: e2f5579.
- T4 (GitLab-style diff rows): the panel parses each stored diff into entries while building rows (the hook keeps `{ lines, more }`). Old and new numbers come from the `@@ -a,b +c,d @@` headers and are right-aligned in two dim columns (at least 2 wide, as wide as the largest number), then a dim `+`/`-`/blank marker and a `│` separator. Rows are tinted to the pane edge with truecolor `backgroundColor` values `#2b4538` (added), `#472b36` (removed), `#0e2a35` (context), `#14303c` (hunk header, dim text) and `#1b3a4a` (per-file header, bold); the cursor row uses the lighter `#38594a`, `#5a3745`, `#17394a`, `#1f4254`, `#27506a` plus the existing `▌` marker. Code text keeps the normal foreground. Long lines wrap onto continuation rows with blank gutters and the same tint; the 200-line cap counts source lines only. `diff --git`, `index`, `---` and `+++` rows are dropped; a commit diff keeps one header row per file (a rename shows `old → new`), a file diff has none. Binary and `\ No newline` lines stay as dim note rows without a tint. No syntax highlighting. RED: 9 new or rewritten tests failed (line numbers, tints, dim gutter, hunk and meta rows, per-file headers, wrapping, cap with wraps, cursor tint); GREEN: 60 pass. Tree assertions read the rendered Text props, so each row is checked for its text, tint and 60 column width. `claude plugin validate .` passes and `tsc` is at 33 errors (35 before T4, the 2 removed were inline mount copies), none in `hooks/panel.tsx`, the same 2 pre-existing in `hooks/register.tsx`. Commit: 592aba7.

## Next step

Merge the branch under the repository policy; no further task is open.
