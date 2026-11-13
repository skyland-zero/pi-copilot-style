# pi-copilot-style

GitHub Copilot CLI's timeline for [pi](https://pi.dev): one row per tool call,
no output when it succeeds, `❯` / `●` message chrome, `❯ Thought` reasoning.

```
$ Shell  Run tests  67 lines  4.1s
  npm test
TS Read auth.ts  132 lines read
MD Read AGENTS.md  273 lines read
C# Read Program.cs  41 lines read
{} Read package.json  L1:5 (5 lines read)
/ Search "MIGRATION" in *.md  3 files found
  List directory nsh-app  26 entries
TS Edited auth.ts +12 -8
RS Created runtime.rs +24
✗ Shell  Run npm build  14 lines  12.6s
  npm run build
    … 3 earlier lines
    src/auth.ts(42,7): error TS2322
    Command exited with code 1
❯ Thinking…
❯ Thought for 3s
● Reused refreshSession(token) in the refresh path.
```

File rows start with Copilot's two-character language badge (`TS`, `RS`, `C#`,
`MD`, `{}` …), taken from the CLI's own extension table. Collapsed rows show the
file name; `ctrl+o` expands them to the full path and the content.

Rows never print successful output: a failure shows its tail, and `ctrl+o`
expands the full output — the same key Copilot uses. Shell rows keep the `$`
marker, failures switch it to `✗` (`!` for rejected/approval, `-` for cancelled).

The summary after `Shell` comes from a command heuristic (`npm test` → "Run
tests", `sed -n … rust.md` → "Read rust.md"). Copilot gets that text from the
model's `intentionSummary`; pi's tool calls carry no such field, so the real
command stays on the second line, and no `+N more steps` is appended.

## Install

```bash
pi install git:github.com/skyland-zero/pi-copilot-style
```

The package registers the extension and copies the two bundled palettes into
`<agent-dir>/themes/` on first load, so `/copilot-style theme` works right away.
Restart pi (or `/reload`) afterwards — tool rows are registered at load time.

Without a package manager, `bash install.sh` does the same two steps by hand.
Move to another machine: see [INSTALL.md](INSTALL.md).

If you run another extension that also restyles built-in tools — for example
`pi-compact-tools` — turn that one off first, otherwise the later registration
wins:

```json
// ~/.pi/agent/compact-tools.json
{ "style": "off" }
```

## Commands

| Command | Effect |
| --- | --- |
| `/copilot-style` | Show the active settings |
| `/copilot-style preview` | Render sample rows with the current theme (esc closes) |
| `/copilot-style theme` | Switch to the bundled Copilot palette (picks light/dark to match your terminal) |

## Configuration

Optional, in `<agent-dir>/settings.json` or `<project>/.pi/settings.json`
(project wins):

```json
{
  "copilotStyle": {
    "enabled": true,
    "messageChrome": true,
    "compactToolRows": true,
    "failedOutputLines": 6,
    "thinkingLabel": "Thought",
    "thinkingActiveLabel": "Thinking"
  }
}
```

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Master switch; when false the extension registers nothing. |
| `messageChrome` | `true` | `❯` user rows without the background box, `●` assistant rows. |
| `compactToolRows` | `true` | Drop the blank line pi prints above every tool row. |
| `failedOutputLines` | `6` | Tail lines under a failed row before expanding. |
| `thinkingLabel` | `"Thought"` | Label once reasoning settles: `❯ Thought`, or `❯ Thought for 3s`. Empty keeps pi's. |
| `thinkingActiveLabel` | `"Thinking…"` | Label while reasoning streams: `❯ Thinking…`. |

## Theme

`themes/copilot-dark.json` and `themes/copilot-light.json` carry the CLI's own
palette (GitHub dark `#0D1117`/`#4493F8`/`#3FB950` and light
`#FFFFFF`/`#0969DA`/`#1A7F37`, with GitHub syntax colors). On load they are
copied into `<agent-dir>/themes/`, because pi resolves the saved theme at
startup — before extension resource discovery — so a theme that is only
registered through `resources_discover` fails with `Theme not found`.

`/copilot-style theme` applies the variant that matches your terminal's
appearance, so a light terminal never gets near-white text; pick another theme
in `/settings` to go back.

Without it the rows still work, but `accent`/`success`/`warning` come from your
terminal palette, which can render the badges nearly monochrome. Row headers are
always left in the terminal's own foreground, like pi's message text, so a
theme/terminal mismatch cannot hide them.

## What it changes

| pi tool | Row |
| --- | --- |
| `bash` | `$ Shell  <summary>  N lines  1.4s` + the command on its own line, live tail and a ticking clock while running, tail on failure |
| `powershell` | same row, labelled `> Pwsh` so a Windows shell is not mistaken for bash |
| `read` | `TS Read <name>  N lines read` (badge, file name, `L88:130` when a range was read) |
| `grep` | `/ Search "<pattern>" in <glob \| path>  N files found` |
| `find` | `/ Search <pattern> in <path>  N files found` |
| `ls` | `List directory <path>  N entries` |
| `edit` | `TS Editing` / `Edited <name> +12 -8` (counts from the diff) |
| `write` | `Creating` / `Created <name> +24` |
| `codemode` | `JS Run codemode script  3 calls  12 lines  1.4s`; the script, its nested calls and the output appear on `ctrl+o`, tail on failure |

Paths are printed relative to the working directory (`~` for your home), like
Copilot does, even when the model passes an absolute path.

Expanding a row with `ctrl+o` shows the full output (or the diff for `edit`).
Message chrome is a guarded wrapper around pi's exported
`UserMessageComponent` / `AssistantMessageComponent`; if pi's internals change,
it degrades to the built-in rendering instead of throwing.

## Limits

- **One row per call.** Copilot folds consecutive reads/searches/commands into
  one `2 reads · 1 search · 1 command` line. pi renders each tool call as its own
  component, so that rollup needs a patch of the transcript container and is not
  implemented here.
- Custom and MCP tools keep pi's default rendering; the eight built-in tools
  and `codemode` (attached through `registerToolRenderer`, so its own tool
  definition is untouched) are the ones restyled.
- Reasoning reads `❯ Thinking…` while it streams and flips to `❯ Thought for Ns`
  once the response settles (bare `Thought` under a second, and for legacy messages
  pi never stamped). The number is pi's per-response `durationMs`, carried by the
  message itself, so it stays put when a later turn starts, when you scroll back,
  and after a reload — each row keeps its own seconds.
- The `Shell` summary is heuristic, not a model-written intention.
- The elapsed time comes from pi's per-result `durationMs` (monotonic, stored with
  the result, so it survives a reload). While a command runs, the extension keeps
  its own clock and repaints once a second — the same shape pi's own shell rows
  use, since pi's `startToolTimer` / `formatToolDuration` are not exported.
- The working animation next to "Working" above the editor is left untouched.

## Layout

```
index.ts     entry point, /copilot-style command, preview
grammar.ts   markers, row layout, truncation, tail/diff helpers
tools.ts     the eight built-in tool overrides
chrome.ts    user/assistant chrome, tool-row spacing
settings.ts  copilotStyle config
```
