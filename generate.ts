#!/usr/bin/env bun
/**
 * Gamma Presentation Generator
 * Calls Gamma API, polls for completion, downloads the result.
 *
 * Usage:
 *   bun run generate.ts --topic "AI Agent Economy" --output ./slides.pdf
 *   bun run generate.ts --content "$(cat brief.md)" --format pptx --output ./deck.pptx
 *   bun run generate.ts --content-file ./outline.md --text-mode preserve --card-split inputTextBreaks --output ./talk.pdf
 *
 * Env:
 *   GAMMA_API_KEY  — Gamma API key (required)
 */

const GAMMA_API = 'https://public-api.gamma.app/v1.0'
const CONFIG_PATH = `${process.env.HOME}/.gamma/config.json`

async function readManagedKey(): Promise<string | null> {
  try {
    const config = JSON.parse(await Bun.file(CONFIG_PATH).text())
    return config.api_key || null
  } catch {
    return null
  }
}

interface GenerateOptions {
  topic?: string
  content?: string
  contentFile?: string
  format?: 'pdf' | 'pptx'
  pages?: number
  output?: string
  textMode?: 'generate' | 'condense' | 'preserve'
  cardSplit?: 'auto' | 'inputTextBreaks'
}

function parseArgs(): GenerateOptions {
  const args = process.argv.slice(2)
  const opts: GenerateOptions = { format: 'pdf', textMode: 'generate' }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--topic' && args[i + 1]) opts.topic = args[++i]
    else if (args[i] === '--content' && args[i + 1]) opts.content = args[++i]
    else if (args[i] === '--content-file' && args[i + 1]) opts.contentFile = args[++i]
    else if (args[i] === '--format' && args[i + 1]) opts.format = args[++i] as 'pdf' | 'pptx'
    else if (args[i] === '--pages' && args[i + 1]) opts.pages = parseInt(args[++i])
    else if (args[i] === '--output' && args[i + 1]) opts.output = args[++i]
    else if (args[i] === '--text-mode' && args[i + 1]) opts.textMode = args[++i] as GenerateOptions['textMode']
    else if (args[i] === '--card-split' && args[i + 1]) opts.cardSplit = args[++i] as GenerateOptions['cardSplit']
  }
  return opts
}

async function createGeneration(apiKey: string, inputText: string, opts: GenerateOptions): Promise<string> {
  const body: Record<string, any> = {
    inputText,
    textMode: opts.textMode || 'generate',
    format: 'presentation',
    exportAs: opts.format || 'pdf',
  }
  if (opts.pages) body.numCards = opts.pages
  if (opts.cardSplit) body.cardSplit = opts.cardSplit

  const res = await fetch(`${GAMMA_API}/generations`, {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gamma API error ${res.status}: ${err}`)
  }

  const data = await res.json() as { generationId: string }
  return data.generationId
}

async function pollGeneration(apiKey: string, generationId: string, maxWait = 180000): Promise<{
  gammaUrl: string
  exportUrl: string | null
  title: string
}> {
  const start = Date.now()
  while (Date.now() - start < maxWait) {
    const res = await fetch(`${GAMMA_API}/generations/${generationId}`, {
      headers: { 'X-API-KEY': apiKey },
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Poll error ${res.status}: ${err}`)
    }

    const data = await res.json() as any
    if (data.status === 'completed') {
      return {
        gammaUrl: data.gammaUrl || data.url,
        exportUrl: data.exportUrl || null,
        title: data.title || 'presentation',
      }
    }
    if (data.status === 'failed') {
      throw new Error(`Generation failed: ${data.error || 'unknown'}`)
    }

    await new Promise(r => setTimeout(r, 5000))
  }
  throw new Error('Generation timed out after ' + (maxWait / 1000) + 's')
}

async function downloadFile(url: string, outputPath: string): Promise<boolean> {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) return false
  const buffer = await res.arrayBuffer()
  await Bun.write(outputPath, buffer)
  return true
}

async function main() {
  const apiKey = process.env.GAMMA_API_KEY || await readManagedKey()
  if (!apiKey) {
    console.error('Error: No Gamma API key found.')
    console.error('  BYOK: export GAMMA_API_KEY=sk-gamma-...')
    console.error('  Managed: add key to ~/.gamma/config.json')
    process.exit(1)
  }

  const opts = parseArgs()

  // Read content from file if specified
  if (opts.contentFile) {
    opts.content = await Bun.file(opts.contentFile).text()
  }

  if (!opts.topic && !opts.content) {
    console.log(`Usage:
  bun run generate.ts --topic "Topic" [options]
  bun run generate.ts --content "Full content" [options]
  bun run generate.ts --content-file ./outline.md [options]

Options:
  --format pdf|pptx       Export format (default: pdf)
  --pages N               Target number of slides
  --output path           Output file path
  --text-mode MODE        generate|condense|preserve (default: generate)
  --card-split MODE       auto|inputTextBreaks (split on --- separators)`)
    process.exit(1)
  }

  let inputText: string
  if (opts.content) {
    inputText = opts.content
  } else {
    inputText = `Create a presentation about: ${opts.topic}${opts.pages ? `. Target ${opts.pages} slides.` : ''}`
  }

  // Auto-detect: if content has --- separators and no explicit card-split, suggest preserve+inputTextBreaks
  if (opts.content && opts.content.includes('\n---\n') && !opts.cardSplit && opts.textMode === 'generate') {
    console.log('Detected --- separators in content. Tip: use --text-mode preserve --card-split inputTextBreaks to keep exact slide breaks.')
  }

  // Default output path if not specified
  if (!opts.output) {
    const ext = opts.format || 'pdf'
    opts.output = `/tmp/gamma-output.${ext}`
  }

  console.log(`Creating presentation (textMode: ${opts.textMode}, exportAs: ${opts.format})...`)
  const generationId = await createGeneration(apiKey, inputText, opts)
  console.log(`Generation ID: ${generationId}`)

  console.log('Waiting for completion...')
  const result = await pollGeneration(apiKey, generationId)
  console.log(`Done! Title: ${result.title}`)
  console.log(`Gamma URL: ${result.gammaUrl}`)

  // Download the export
  let downloaded = false
  if (result.exportUrl) {
    console.log(`Export URL: ${result.exportUrl}`)
    downloaded = await downloadFile(result.exportUrl, opts.output)
    if (downloaded) {
      console.log(`Saved to: ${opts.output}`)
    }
  }

  if (!downloaded) {
    // Fallback: try gammaUrl-based export
    const fallbackUrl = `${result.gammaUrl}/export/${opts.format}`
    downloaded = await downloadFile(fallbackUrl, opts.output)
    if (downloaded) {
      console.log(`Saved to: ${opts.output}`)
    } else {
      console.log(`Download failed. Open ${result.gammaUrl} to export manually.`)
    }
  }

  // Output JSON for skill/pipeline consumption
  console.log(JSON.stringify({
    generationId,
    gammaUrl: result.gammaUrl,
    exportUrl: result.exportUrl,
    title: result.title,
    output: downloaded ? opts.output : null,
    downloaded,
  }))
}

main().catch(e => {
  console.error('Error:', e.message)
  process.exit(1)
})
