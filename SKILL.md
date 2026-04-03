---
name: gamma
description: Generate professional presentations with Gamma AI. Just describe what you want — topic, outline, or full content — and get a polished deck with direct PDF/PPTX download. No Gamma account needed.
metadata: {"clawdbot":{"emoji":"🎯","os":["darwin","linux","windows"],"requires":{"bins":["bun"],"env":["GAMMA_API_KEY"]}}}
---

# Gamma Presentation Generator

Generate polished presentations from a topic or content brief. Uses Gamma AI
to create professionally designed slides with **direct PDF/PPTX download**.
The user does not need a Gamma account.

## When to Use

Trigger when the user wants to:
- Create a presentation, deck, or slides
- "Make me a pitch deck about X"
- "Generate slides for my talk on Y"
- "Create a presentation with 10 slides about Z"

Do NOT trigger for:
- PPTX file editing (use document-skills:pptx instead)
- HTML/web presentations (use frontend-slides instead)
- Presenton-specific requests (use presenton instead)

## How to Use

### Step 1: Gather Requirements

Ask the user (if not already provided):
- **Topic or content**: What the presentation is about
- **Audience**: Who is this for? (investors, team, conference)
- **Length**: How many slides? (default: ~8-10)
- **Format**: PDF or PPTX? (default: PDF)

### Step 2: Prepare the Input

For best results, write full slide content to a file, separated by `---`:

```markdown
## S1 — Title
My Presentation Title
Speaker Name | Date

---

## S2 — Problem
The problem we're solving...

---

## S3 — Solution
Our approach...
```

Save to `/tmp/gamma-prompt.txt`, then use `--content-file`.

### Step 3: Generate

**Simple topic:**
```bash
GAMMA_API_KEY="$GAMMA_API_KEY" bun run ~/.claude/skills/gamma/generate.ts \
  --topic "IrisGo Series A Pitch" \
  --pages 12 \
  --format pdf \
  --output /tmp/pitch-deck.pdf
```

**Full content with exact slide breaks (30+ slides):**
```bash
GAMMA_API_KEY="$GAMMA_API_KEY" bun run ~/.claude/skills/gamma/generate.ts \
  --content-file /tmp/gamma-prompt.txt \
  --text-mode preserve \
  --card-split inputTextBreaks \
  --format pptx \
  --output /tmp/presentation.pptx
```

**CLI Options:**
| Flag | Values | Default | Description |
|------|--------|---------|-------------|
| `--topic` | string | — | Short topic description |
| `--content` | string | — | Full content inline |
| `--content-file` | path | — | Read content from file |
| `--format` | pdf, pptx | pdf | Export format |
| `--pages` | number | — | Target slide count |
| `--output` | path | /tmp/gamma-output.{ext} | Output file path |
| `--text-mode` | generate, condense, preserve | generate | How Gamma treats your text |
| `--card-split` | auto, inputTextBreaks | auto | How to split into slides |

### Step 4: Deliver

The script downloads the file directly. Output includes:
- File path (if download succeeded)
- Gamma URL (always available as fallback)
- JSON metadata for pipeline consumption

If download fails, provide the Gamma URL for manual export.

## Text Mode Guide

- **generate** — Gamma rewrites and expands your content (best for topics/outlines)
- **condense** — Gamma shortens your content to fit slides
- **preserve** — Gamma keeps your text as-is (best for pre-written slide content)

For 20+ slides with exact content control: `--text-mode preserve --card-split inputTextBreaks`

## Configuration

The API key is resolved in order: `GAMMA_API_KEY` env var > `~/.gamma/config.json`

```bash
# Option A: Environment variable
export GAMMA_API_KEY="sk-gamma-..."

# Option B: Managed config (for sharing with friends/colleagues)
echo '{"api_key":"sk-gamma-..."}' > ~/.gamma/config.json
```

## Limitations

- Gamma AI designs the slides — layout and visual style are Gamma's choice
- Generation takes 30-120 seconds depending on complexity
- Content input limit ~4000 chars recommended (longer works but may be truncated)
- Export costs Gamma credits (~15-136 credits per deck depending on size)
