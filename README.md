# Gamma Presentation Generator Skill

Generate professional presentations with Gamma AI from your agent. Describe what you want and get a polished deck with **direct PDF/PPTX download** — no Gamma account needed.

## Three Auth Modes

**1. BYOK** — Bring your own Gamma API key:
```bash
export GAMMA_API_KEY=sk-gamma-...
```

**2. Proxy** — Route through a managed proxy (no Gamma key needed):
```bash
export GAMMA_PROXY_URL=http://your-proxy:8318
export GAMMA_PROXY_KEY=your-proxy-key
```

**3. Managed Config** — Shared key or proxy via config file:
```json
// ~/.gamma/config.json — direct key
{"api_key": "sk-gamma-..."}

// ~/.gamma/config.json — proxy mode
{"proxy_url": "http://your-proxy:8318", "proxy_key": "your-proxy-key"}
```

## Usage

```bash
# Simple topic → PDF
bun run generate.ts --topic "Q2 Product Roadmap" --format pdf --output ./roadmap.pdf

# Full content with exact slide control (30+ slides)
bun run generate.ts --content-file ./outline.md \
  --text-mode preserve --card-split inputTextBreaks \
  --format pptx --output ./presentation.pptx
```

### CLI Options

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

### Text Mode Guide

- **generate** — Gamma rewrites and expands (best for topics/outlines)
- **condense** — Gamma shortens to fit slides
- **preserve** — Gamma keeps your text as-is (best for pre-written content)

For 20+ slides with exact content: `--text-mode preserve --card-split inputTextBreaks`

## Proxy Server (gamma-proxy.ts)

Run a Bun sidecar that holds your Gamma API key and serves whitelisted users:

```bash
GAMMA_PROXY_AUTH_KEY=your-secret-key bun run gamma-proxy.ts
# Runs on port 8318
```

Whitelist additional keys in `~/.gamma/whitelist.json`:
```json
["key-for-friend-1", "key-for-teammate-2"]
```

## Install

### Claude Code
```bash
ln -s /path/to/gamma-skill ~/.claude/skills/gamma
```

### OpenClaw / PCClaw
```bash
cp SKILL.md ~/.openclaw/skills/gamma/SKILL.md
```

## How It Works

1. Skill receives topic or content from the user
2. Calls Gamma API with `exportAs` parameter for direct download
3. Polls until generation completes (~30-120s)
4. Downloads PDF/PPTX directly via `exportUrl`
5. Returns the file path to the user

## Cost

~15-136 credits per deck depending on size. Skill owner covers generation costs.

## Requirements

- [Bun](https://bun.sh) runtime
- Gamma API key (get one at [gamma.app](https://gamma.app)) OR access to a gamma-proxy instance

## License

MIT
