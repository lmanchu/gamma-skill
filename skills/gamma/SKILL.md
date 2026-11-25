---
name: gamma
description: Make presentation decks with Gamma (gamma.app) and download them as PDF or PPTX. Use when the user asks for a presentation, deck, or slides. Runs on the user's own Gamma account and API key.
metadata: {"clawdbot":{"emoji":"🎯","os":["darwin","linux","windows"],"requires":{"bins":["bun"]}}}
---

# Gamma Presentation Generator

Turns a topic, an outline, or finished slide text into a Gamma deck, then saves
the PDF or PPTX on the user's computer. Every generation spends credits from the
user's own Gamma account.

## When to use

Use it when the user wants to create a presentation, deck, or slides, for example
"make a pitch deck about X" or "turn these notes into 10 slides".

Do not use it to edit an existing PPTX file or to build HTML slides.

## Rules for the API key (always follow)

- Never open, read, print, or copy `~/.gamma/config.json`, and never print `GAMMA_API_KEY`.
- Never ask the user to paste the key into the chat, and never put a key on a command line.
- If the script says no key was found, show the user the setup command the script printed
  and ask them to run it themselves in Terminal (Mac) or PowerShell (Windows). Wait for them
  to say it is done, then run `--check`.
- If the user pastes a key into the chat anyway, do not use it. Tell them the key is now exposed,
  that they should delete it at https://gamma.app/settings/api-keys, create a new one, and save
  the new one with `--setup` in Terminal.

## Running the script

The script is `scripts/generate.ts` inside this skill's folder (the folder that
contains this SKILL.md). Build its absolute path from where you loaded this file,
and quote it, because the path may contain spaces. Common locations:
`$CODEX_HOME/skills/custom/gamma/` (IrisGo; in PowerShell `$env:CODEX_HOME\skills\custom\gamma\`),
`~/.claude/skills/gamma/` (Claude Code).

Find Bun in this order: `bun` on PATH, then `~/.bun/bin/bun` (macOS and Linux),
then `$env:USERPROFILE\.bun\bin\bun.exe` (Windows PowerShell; inside double quotes is fine,
`~` and `%USERPROFILE%` are not expanded there). If none exists, stop and ask the
user to install it themselves. On a Mac they open Terminal and run
`curl -fsSL https://bun.com/install | bash`; on Windows, PowerShell
`powershell -c "irm bun.sh/install.ps1 | iex"`.

The script needs internet access to `public-api.gamma.app`. If you run commands in
a sandbox without network access (for example IrisGo or Codex), request permission
to run each command outside the sandbox (`--check` and every generation), and tell
the user an approval prompt will appear. Do not retry it inside the sandbox. If the
script exits with code 3 and says it ran inside a sandbox with no internet access,
nothing was sent and no credits were used: run the same command again outside the sandbox.

On Windows the shell is usually PowerShell:
- Start the command with `&`: `& "BUN" "SCRIPT" --check`.
- Keep the command on one line. PowerShell does not accept `\` at the end of a line.
- Put `--topic` text in single quotes. PowerShell changes `$` and backticks inside double
  quotes. For anything longer, or text with quotes in it, use `--content-file`.
- Save content files as UTF-8. The script refuses other encodings rather than send garbled text.

A generation can take several minutes. Give the command a timeout of at least
10 minutes (in Claude Code, `timeout: 600000`) or run it in the background.

First time on a computer, run `--check`. It is free, confirms the key works, and
shows the plan, the maximum slides per deck, and the credits left.

## Steps

1. **Ask what you need** (skip what the user already said): topic or content,
   audience, number of slides (default 8–10), PDF or PPTX (default PDF).
   The Free plan allows at most 10 slides per deck; `--check` shows the limit.
2. **Write the content to a file** in a temporary folder. For exact slide control,
   write one section per slide separated by lines containing only `---`:

   ```markdown
   # My Presentation Title
   Speaker name | Date

   ---

   ## The problem
   ...

   ---

   ## Our approach
   ...
   ```

3. **Generate.** Tell the user it will use Gamma credits. Examples (replace
   `BUN` and `SCRIPT` with the paths you found):

   ```bash
   # Short topic, Gamma writes the content
   "BUN" "SCRIPT" --topic 'Q2 product roadmap for the sales team' --pages 8 --format pdf

   # The user's own slide text, one slide per --- section, wording kept
   "BUN" "SCRIPT" --content-file "/path/to/slides.md" --text-mode preserve --card-split inputTextBreaks --format pptx
   ```

   In PowerShell, put `&` in front: `& "BUN" "SCRIPT" --topic '...' --pages 8 --format pdf`.

   Files are saved to `~/Downloads/gamma-<time>.pdf|pptx` unless you pass `--output`.
   Add `--dry-run` to see the request without sending it.

4. **Once a `Generation ID:` line has appeared, never start a new generation for
   the same request.** The credits are already spent. If the script exits with
   code 2, if your command was killed or timed out, or if the output was lost, run
   `--resume <generationId>` with the ID from that line. Only a run that failed
   before printing a `Generation ID:` can be started again.

5. **Deliver.** Give the saved file path and the Gamma URL. Pass on any
   `Gamma warning` line to the user. If the download failed, run the `--resume`
   command the script printed (it downloads again for free), or give the Gamma URL
   and tell the user to use Export in Gamma.

## Before the user shares the deck

Tell the user to look through every slide, because Gamma is known to:
- add sentences or numbers of its own, even with `--text-mode preserve`
- shorten some slides into icons and short labels
- add decorative pictures with fake QR codes, made-up app screenshots with garbled
  text, or AI-generated photos of people who could be mistaken for the speaker

Replace QR codes and photos of real people by hand. Do not tell the user the deck
is final until they have checked it.

## Options

| Flag | Values | Default | What it does |
|------|--------|---------|--------------|
| `--topic` | text | — | Short topic; Gamma writes the content |
| `--content` | text | — | Full content inline |
| `--content-file` | path | — | Read content from a file |
| `--format` | `pdf`, `pptx` | `pdf` | Export format |
| `--pages` | number | — | Number of slides (Free plan: up to 10) |
| `--output` | path | `~/Downloads/gamma-<time>.<ext>` | Where to save |
| `--text-mode` | `generate`, `condense`, `preserve` | `generate` | Rewrite, shorten, or keep the user's text |
| `--card-split` | `auto`, `inputTextBreaks` | `auto` | `inputTextBreaks` = one slide per `---` section |
| `--theme-id` | ID | — | A Gamma theme ID |
| `--external-access` | `noAccess`, `view`, `comment`, `edit` | `noAccess` | Who outside the user's workspace can open the Gamma link |
| `--max-wait` | seconds | `600` | How long to wait before giving up |
| `--dry-run` | — | — | Print the request and stop (no credits) |
| `--resume` | generation ID | — | Keep waiting for a generation that timed out |
| `--check` | — | — | Test the key; show plan, slide limit, credits (free) |
| `--setup` | — | — | The user saves their key (they run this, not you) |

Keep `--external-access noAccess` unless the user asks for a link other people can open.

Text modes: `generate` expands a topic or outline; `condense` shortens long text;
`preserve` keeps the user's wording as much as Gamma allows. Use `preserve` with
`inputTextBreaks` only for text the user wrote slide by slide.
