# Configurable plan source

## Objective

Let each user and each repo choose which folder the Plan tab reads, instead of the hardcoded `odd/tasks`. Users who run plain Claude Code (no harness) should see the plan of their session.

## Problem

`DIR = 'odd/tasks'` and `nameOf` (regex on `odd/tasks`) are hardcoded in `hooks/register.tsx`. Plain Claude Code writes plans to `~/.claude/plans` (shared by all projects) or to `plansDirectory` from settings.

## Verified facts

- Claude Code 2.1.289 has a `plansDirectory` setting (relative to project root, must stay inside it; default `~/.claude/plans`). Readable via `$.settings.read()`.
- Plugin `userConfig` options are global only: project settings are not read for `pluginConfigs`.
- Plan mode reports the session's plan file as `detail.planFilePath` on `prompt.attachment` (`plan_mode`, `plan_mode_reentry`, `plan_mode_exit`).
- `$.fs.list` / `$.fs.read` accept absolute paths.

## Decision

Per-repo setting lives in `.claude/cc-reviewer.json` as `{ "planDir": "odd/tasks" }` (user choice). A global `planDir` userConfig option is the fallback.

Resolution, first match wins:
1. Repo file `planDir`, then global option `planDir`: show the file this session last touched in that folder, else the newest `*.md` there.
2. Claude's folder (`plansDirectory` from settings, else `~/.claude/plans`): show the session's own plan file (`planFilePath` or last touched in the folder). Newest-file fallback only when `plansDirectory` is set (project scoped); never for the shared default.

## Scope

- `hooks/register.tsx`, `types/index.d.ts`, `.claude-plugin/plugin.json`, `hooks/panel.tsx` (empty state), `hooks/cc-reviewer.test.ts`, `README.md`.
- No code comments or docstrings (AGENTS.md). No AI-attribution trailers in commits.

## Tasks

- [x] T1: Resolve the plan folder (repo file, global option, Claude default) and bind to the session plan file; types, manifest option, tests (cb627aa)
- [x] T2: Empty state in the Plan tab names the folder searched and how to configure it (dd7b4db)
- [x] T3: README documents the setting, precedence and session binding (84ba0cb)

## Acceptance criteria

- With `.claude/cc-reviewer.json` `planDir: "odd/tasks"` the pane behaves as today.
- Without any config, the pane shows only this session's plan and never another project's.
- `claude plugin validate .`, `claude plugin test .` and `tsc` pass.

## Progress

Route: T1 delegated writer (multi-file, preparation reads), T2/T3 same writer. Delivery: one slice, well under 400 changed lines expected per task.

Verification: `claude plugin validate .` passed; `claude plugin test .` 13 pass, 0 fail (T2 RED observed: 2 fail against the old empty state); `tsc -p .` reports only errors that already existed on the base commit.

## Next step

Review the branch and decide on push and pull request.
