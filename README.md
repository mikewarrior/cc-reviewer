# cc-reviewer

A Claude Code mod (plugin id `cc-reviewer`): a side pane with two tabs.

- **Plan** shows the plan markdown for the feature you are working on as collapsible sections, with task progress and the running task's elapsed time.
- **Changes** shows git changes grouped as Commits (ahead of upstream), Staged, Unstaged and Untracked, with `+/−` stats.

Three layouts (**Outline**, **Powerline**, **Focus**) and an optional Nerd Font icon set are chosen in the settings menu. The choice is saved between sessions. Colors use ANSI slots, so the pane follows your terminal theme.

## Plan file format

The pane reads Markdown files from `odd/tasks/*.md`, relative to the session's working directory.

```markdown
# PROJ-1 - Example feature

## Objective

What and why.

## Tasks

- [x] T1: Done task
      Indented lines under a task show when you expand it.
- [ ] T2: Next task
```

- The first `# ` line is the title and every `## ` section becomes a collapsible block.
- Only the `## Tasks` section gets task rows. Other sections are drawn as rendered Markdown.
- The pane shows the file this session last read, wrote or edited. Until then it shows the newest file by modified time.
- The first unchecked task counts as the running one, unless a task is marked `[~]`, `[>]` or `[/]`. Its elapsed time counts from when the pane first saw it running.

## Install

Requires a Claude Code build with plugin mods (the `plugin-authoring` skill).

Clone this repository, then start Claude Code with the folder as a plugin directory.

macOS / Linux:

```bash
claude --plugin-dir /path/to/cc-reviewer
```

Windows (PowerShell):

```powershell
claude --plugin-dir C:\path\to\cc-reviewer
```

You can also set `CLAUDE_CODE_PLUGIN_DIRS` to a list of plugin folders (separated by `:` on macOS and Linux, `;` on Windows).

Open the pane with `/cc-reviewer`. It also opens by itself on terminals 144 columns wide or more.

## Use

Click the pane to give it keyboard focus. Escape hands the focus back to the prompt.

| Key | Action |
| --- | --- |
| `j` / `↓`, `k` / `↑` | Move the cursor |
| `g` / `G` | Top / bottom |
| `Enter` / `Space` | Fold or unfold the current section or group (on a child row, its parent) |
| `h` / `←`, `l` / `→` | Collapse / expand |
| `Tab`, `1`, `2` | Switch tab |
| `s` or `,` | Open settings (`s`, `,` or `q` closes it) |
| `q` | Close the pane |

Tabs, rows and the gear icon also respond to a mouse click.

The pane re-reads the plan file and `git` every few seconds and after every Read, Write, Edit and Bash call.

## Develop

```bash
claude plugin validate .
claude plugin test .
```

The tests mock the file system and `git` through the engine, so they need neither a repository nor plan files.

## License

Apache License 2.0. See [LICENSE](LICENSE).
