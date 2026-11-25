# Gamma Presentation Skill

An agent skill that makes presentation decks with [Gamma](https://gamma.app) and
saves them as PDF or PPTX on your computer. Works with agents that load
`SKILL.md` folders, such as the IrisGo app and Claude Code.

You need your own Gamma account and your own Gamma API key. API keys are
available on every Gamma plan, including Free. Each deck spends credits from your
account. Gamma's terms do not allow sharing API keys, so every person creates
their own.

> Only chatting in the Claude or ChatGPT app? You may not need this skill: Gamma
> has official connectors there (Settings → Connectors → Gamma), with no API key.

## What it does

- Generates a deck from a short topic, an outline, or your own slide-by-slide text
- Keeps one slide per `---` section when you ask it to (`--text-mode preserve --card-split inputTextBreaks`)
- Downloads the PDF or PPTX to `~/Downloads` and checks the file really is a PDF or PPTX
- Makes new decks private by default (people outside your workspace cannot open the link)
- Can resume waiting for a long deck without paying again (`--resume`)

## Install

### 繁體中文：在 IrisGo app 安裝（Mac）

1. **註冊 Gamma**：到 [gamma.app](https://gamma.app) 用自己的 email 註冊，Free 方案就可以用。
   建議到 Settings → Sharing，把新 gamma 的預設分享權限改成 **No access**。
2. **建 API key**：到 [gamma.app/settings/api-keys](https://gamma.app/settings/api-keys) 建一把，按複製。
3. **裝 Bun**：打開「終端機」（在 Launchpad 搜尋「終端機」），貼上下面這行，按 Enter，等它跑完：
   ```bash
   curl -fsSL https://bun.com/install | bash
   ```
   跑完會顯示 Bun 已安裝。如果出現錯誤，把畫面截圖給會用電腦的人看，先不要往下做。
4. **下載這個 skill**：在這個 GitHub 頁面按綠色的 **Code** → **Download ZIP**。下載完雙擊 ZIP 解壓縮，
   「下載項目」裡會多一個 `gamma-skill-main` 資料夾。如果你下載過不只一次，資料夾名稱可能會變成
   `gamma-skill-main 2`；請先把舊的刪掉，只留一個叫 `gamma-skill-main` 的，下面的指令才找得到。
5. **存 key**：在終端機貼上下面這行，按 Enter。看到提示後貼上剛剛複製的 key 再按 Enter。
   貼上時畫面不會顯示任何字，這是正常的。
   ```bash
   ~/.bun/bin/bun ~/Downloads/gamma-skill-main/skills/gamma/scripts/generate.ts --setup
   ```
6. **測試**（不扣 credits）：
   ```bash
   ~/.bun/bin/bun ~/Downloads/gamma-skill-main/skills/gamma/scripts/generate.ts --check
   ```
   看到 `The key works.` 和剩下的 credits 就成功了。如果看到 `No such file`，代表第 3 步或第 4 步沒完成，
   回去重做那一步。
7. **匯入 IrisGo**：IrisGo → 設定 → 技能 → 匯入技能 → 選擇技能資料夾，
   選 `下載項目/gamma-skill-main/skills/gamma`。IrisGo 會複製一份，之後 `gamma-skill-main` 可以刪掉。
8. **開始用**：開新對話，例如「用 gamma skill 做一份 8 頁簡報，主題是○○，給○○看，匯出 PDF」。
   每次做簡報，IrisGo 都可能跳出一張批准卡，請你允許在 sandbox 外連網執行，按允許即可。
   做好的檔案會在「下載項目」，通常要等 1 到 3 分鐘。

請記得：
- **key 不要貼進任何對話**（IrisGo、Claude、LINE 都一樣），也不要截圖。外流了就到 Gamma 的
  API Keys 頁面刪掉，再重做第 2、5 步。
- **分享前逐頁看過**。Gamma 有時會自己加句子或數字，也會放假的 QR code、亂碼的 app 畫面，
  或 AI 生成、看起來像講者的人像照片。
- Free 方案一份最多 10 頁。

### Claude Code

```bash
git clone https://github.com/lmanchu/gamma-skill.git
ln -s "$PWD/gamma-skill/skills/gamma" ~/.claude/skills/gamma
bun ~/.claude/skills/gamma/scripts/generate.ts --setup   # paste your key when asked
bun ~/.claude/skills/gamma/scripts/generate.ts --check
```

### Other agents

Copy the `skills/gamma` folder into your agent's skills folder, install
[Bun](https://bun.sh), then run `scripts/generate.ts --setup` and `--check`
from that folder. Agents that install skills from a GitHub URL can use
`https://github.com/lmanchu/gamma-skill/tree/main/skills/gamma`.

## Where the key is stored

`--setup` saves the key to `~/.gamma/config.json` and makes the file readable only
by you (on Windows, normal user-folder permissions apply). It reads the key from a
hidden prompt or from piped input (`pbpaste | bun scripts/generate.ts --setup`),
so the key never shows on screen or in shell history. You can also set
`GAMMA_API_KEY` in the environment; it takes priority over the file. Apps opened
from the Dock usually do not see variables set in `.zshrc`, so the IrisGo app
needs the file.

The skill tells the agent never to read or print this file and never to ask for
the key in chat.

## Usage

```bash
# Topic only, Gamma writes the content
bun scripts/generate.ts --topic "Q2 product roadmap" --pages 8 --format pdf

# Your own text, one slide per --- section, wording kept
bun scripts/generate.ts --content-file ./slides.md \
  --text-mode preserve --card-split inputTextBreaks --format pptx

# A long deck timed out: keep waiting without paying again
bun scripts/generate.ts --resume <generationId>
```

| Flag | Values | Default | Description |
|------|--------|---------|-------------|
| `--topic` | text | — | Short topic |
| `--content` | text | — | Full content inline |
| `--content-file` | path | — | Read content from a file |
| `--format` | `pdf`, `pptx` | `pdf` | Export format |
| `--pages` | number | — | Number of slides (Free plan: up to 10) |
| `--output` | path | `~/Downloads/gamma-<time>.<ext>` | Output file |
| `--text-mode` | `generate`, `condense`, `preserve` | `generate` | How Gamma treats your text |
| `--card-split` | `auto`, `inputTextBreaks` | `auto` | How to split into slides |
| `--theme-id` | ID | — | Gamma theme |
| `--external-access` | `noAccess`, `view`, `comment`, `edit` | `noAccess` | Access for people outside your workspace |
| `--max-wait` | seconds | `600` | Wait limit before suggesting `--resume` |
| `--dry-run` | — | — | Print the request and stop |
| `--check` | — | — | Test the key; show plan, slide limit, credits |
| `--setup` | — | — | Save your key |

## How it works

1. `POST https://public-api.gamma.app/v1.0/generations` (Gamma's Generate API, the
   engine that supports exact `preserve` text) with `exportAs`
2. Polls `GET /v1.0/generations/{id}` every 5 seconds
3. Downloads `exportUrl` and checks the file signature before saving

## Requirements

- [Bun](https://bun.sh)
- A Gamma account and API key (any plan)
- Internet access to `public-api.gamma.app`

## License

MIT
