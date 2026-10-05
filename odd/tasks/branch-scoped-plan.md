# Branch-scoped plan

## Objective

The Plan tab must show the plan that belongs to the current work, never a leftover file from an earlier session or another branch.

## Problem

When a session has no bound plan (plan mode) and has not touched a plan file, `refreshPlan` falls back to the newest `*.md` by mtime in configured folders (`newest: true`). On `main` this shows the previous feature's `odd/tasks` file.

## Constraints

- Git history cannot be used to decide which plan is current: plans and ODD docs are not always committed in every project.
- Reading the current branch name is fine (`git branch --show-current`).

## Decision (user choice: B and D)

Resolution, first match wins:
1. `bound`: plan file reported by plan mode for this session.
2. `active`: plan file this session last read, wrote or edited in the folder.
3. B, branch memory: a map of repo + branch to plan file kept in `$.store`. Written whenever `bound` or `active` is set on a non-default branch.
4. D, name match: a plan file whose name matches the branch. The slug of the full branch or of its last segment equals the file base name slug, or the branch and the file name start with the same ticket id (`ABC-123`).
5. Otherwise empty state. The newest-mtime fallback is removed for every folder.

Rules:
- Default branches (`main`, `master`) never record a branch memory and never use D, so they show only `bound` or `active`.
- Detached HEAD, no git, or an empty branch name skip B and D.
- Memory keyed by cwd and branch; the value is the absolute plan path. It applies only if that file is still in the searched folder.

## Scope

- `hooks/register.tsx`, `hooks/panel.tsx` (empty state wording), `hooks/cc-reviewer.test.ts`, `README.md`, `types/index.d.ts` only if needed.
- No code comments or docstrings (AGENTS.md). No AI-attribution trailers in commits.

## Tasks

- [x] T1: Branch memory (B) and branch-name match (D), remove the newest-mtime fallback and the `newest` flag; stateful store stub and tests
- [ ] T2: Empty state wording and README describe the new resolution

## Acceptance criteria

- On `main` with no bound or touched plan, the pane shows the empty state even if `odd/tasks` holds files.
- On `feat/foo` with `foo.md` in the folder and nothing touched, the pane shows `foo.md`.
- A plan touched on `feat/bar` is shown again in a new session on `feat/bar`, and not on `main`.
- `claude plugin validate .`, `claude plugin test .` and `tsc -p .` show no new failures.

## Progress

Route: T1 and T2 by one delegated writer (multi-file, preparation reads). One slice, expected under 400 changed lines.

T1 evidence: RED with register.tsx reverted to base (11 of 25 tests failed: new branch tests plus the old newest-fallback tests); GREEN after implementing (26 of 26 pass). `claude plugin validate .` passes. `tsc -p .` goes from 17 to 27 errors, all new ones are the known TS2345 `session.start` input typing in the test file; no new error in `hooks/register.tsx`. Commit: 8d81c83.

## Next step

Delegate the writer, then verify.
