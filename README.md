# cc-reviewer

A Claude Code mod (plugin id `odd-tasks`): a side pane for Claude Code with two tabs:

- **Plan** shows the plan markdown for the feature you are working on, one collapsible section per `##` heading. Checkbox sections show a `done/total` count, and each task in the `Tasks` section expands to its full text.
- **Changes** shows the current `git status`: branch, ahead/behind, and staged, unstaged and untracked files, with colored status letters.

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

Open the pane with `/odd-tasks`. It also opens by itself on terminals 144 columns wide or more.

## Use

| Action | How |
| --- | --- |
| Switch tab | Click it, or press `p` (Plan) / `c` (Changes) while the pane has focus |
| Expand or collapse a section, task or git group | Click it, or focus it and press Enter |

The pane refreshes after every Read, Write, Edit and Bash call, and when `/odd-tasks` runs. Changes made outside the session appear on the next one of those.

## Develop

```bash
claude plugin validate .
claude plugin test .
```

The tests mock the file system and `git` through the engine, so they need neither a repository nor plan files.

## License

Apache License 2.0. See [LICENSE](LICENSE).
