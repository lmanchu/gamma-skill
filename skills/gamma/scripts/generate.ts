#!/usr/bin/env bun
/**
 * Gamma presentation generator.
 * Calls Gamma's Generate API (v1.0), waits for the result, and downloads the PDF/PPTX.
 *
 * Commands:
 *   bun generate.ts --setup              Save your own Gamma API key (hidden input or piped stdin)
 *   bun generate.ts --check              Test the key; shows plan and remaining credits (free)
 *   bun generate.ts --topic "..." ...    Generate a deck (costs Gamma credits)
 *   bun generate.ts --resume <id>        Keep waiting for a generation that timed out (no new credits)
 *
 * The key is read from GAMMA_API_KEY, else ~/.gamma/config.json. It is never printed.
 */

import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

export const GAMMA_API = 'https://public-api.gamma.app/v1.0'
export const CONFIG_DIR = join(homedir(), '.gamma')
export const CONFIG_PATH = join(CONFIG_DIR, 'config.json')
const SCRIPT = 'scripts/generate.ts'
// Exact command for this copy of the script, so messages can be pasted into Terminal as is.
const RUN = `${process.platform === 'win32' ? '& ' : ''}"${process.execPath}" "${fileURLToPath(import.meta.url)}"`

const TEXT_MODES = ['generate', 'condense', 'preserve'] as const
const CARD_SPLITS = ['auto', 'inputTextBreaks'] as const
const FORMATS = ['pdf', 'pptx'] as const
const EXTERNAL_ACCESS = ['noAccess', 'view', 'comment', 'edit'] as const

type Format = (typeof FORMATS)[number]

export interface Options {
  command: 'generate' | 'setup' | 'check' | 'resume' | 'help'
  topic?: string
  content?: string
  contentFile?: string
  format?: Format
  pages?: number
  output?: string
  textMode: (typeof TEXT_MODES)[number]
  cardSplit?: (typeof CARD_SPLITS)[number]
  themeId?: string
  externalAccess: (typeof EXTERNAL_ACCESS)[number]
  maxWaitSeconds: number
  resumeId?: string
  dryRun: boolean
}

export class UsageError extends Error {}

const KNOWN_FLAGS = new Set([
  '--setup', '--check', '--help', '-h', '--resume', '--topic', '--content', '--content-file',
  '--format', '--output', '--text-mode', '--card-split', '--theme-id', '--external-access',
  '--dry-run', '--pages', '--max-wait',
])

function oneOf<T extends readonly string[]>(flag: string, value: string | undefined, allowed: T): T[number] {
  if (value === undefined || !allowed.includes(value)) {
    throw new UsageError(`${flag} must be one of: ${allowed.join(', ')}`)
  }
  return value as T[number]
}

export function parseArgs(argv: string[]): Options {
  const opts: Options = {
    command: 'generate',
    textMode: 'generate',
    externalAccess: 'noAccess',
    maxWaitSeconds: 600,
    dryRun: false,
  }
  const needValue = (i: number, flag: string) => {
    const v = argv[i + 1]
    // Content may itself start with "---", so only a real flag counts as missing.
    if (v === undefined || KNOWN_FLAGS.has(v)) throw new UsageError(`${flag} needs a value`)
    return v
  }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    switch (flag) {
      case '--setup': opts.command = 'setup'; break
      case '--check': opts.command = 'check'; break
      case '--help': case '-h': opts.command = 'help'; break
      case '--resume': opts.command = 'resume'; opts.resumeId = needValue(i, flag); i++; break
      case '--topic': opts.topic = needValue(i, flag); i++; break
      case '--content': opts.content = needValue(i, flag); i++; break
      case '--content-file': opts.contentFile = needValue(i, flag); i++; break
      case '--format': opts.format = oneOf(flag, needValue(i, flag), FORMATS); i++; break
      case '--output': opts.output = needValue(i, flag); i++; break
      case '--text-mode': opts.textMode = oneOf(flag, needValue(i, flag), TEXT_MODES); i++; break
      case '--card-split': opts.cardSplit = oneOf(flag, needValue(i, flag), CARD_SPLITS); i++; break
      case '--theme-id': opts.themeId = needValue(i, flag); i++; break
      case '--external-access': opts.externalAccess = oneOf(flag, needValue(i, flag), EXTERNAL_ACCESS); i++; break
      case '--dry-run': opts.dryRun = true; break
      case '--pages': case '--max-wait': {
        const n = Number(needValue(i, flag)); i++
        if (!Number.isInteger(n) || n < 1) throw new UsageError(`${flag} must be a positive whole number`)
        if (flag === '--pages') opts.pages = n
        else opts.maxWaitSeconds = n
        break
      }
      default: throw new UsageError(`Unknown option: ${flag}`)
    }
  }
  return opts
}

// ---------------------------------------------------------------- key handling

export async function readApiKey(): Promise<string | null> {
  const fromEnv = process.env.GAMMA_API_KEY?.trim()
  if (fromEnv) return fromEnv
  try {
    const config = JSON.parse(await readFile(CONFIG_PATH, 'utf8'))
    const key = typeof config.api_key === 'string' ? config.api_key.trim() : ''
    return key || null
  } catch {
    return null
  }
}

export async function saveApiKey(raw: string): Promise<{ replaced: boolean; unusualPrefix: boolean }> {
  // Strip bracketed-paste markers some terminals wrap around pasted text.
  const key = raw.replace(/\u001b?\[20[01]~/g, '').trim()
  if (!key || /\s/.test(key)) throw new UsageError('That does not look like a Gamma API key (empty or contains spaces).')
  if (/[\u0000-\u001f\u007f]/.test(key)) throw new UsageError('The pasted text contains control characters. Copy the key again and retry.')
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 })
  const replaced = existsSync(CONFIG_PATH)
  // writeFile keeps the old mode of an existing file, so tighten it before writing the key.
  if (replaced) await chmod(CONFIG_PATH, 0o600)
  await writeFile(CONFIG_PATH, JSON.stringify({ api_key: key }) + '\n', { mode: 0o600 })
  await chmod(CONFIG_PATH, 0o600)
  await chmod(CONFIG_DIR, 0o700)
  return { replaced, unusualPrefix: !key.startsWith('sk-gamma-') }
}

async function readHiddenLine(prompt: string): Promise<string> {
  const stdin = process.stdin
  process.stdout.write(prompt)
  return new Promise((resolve, reject) => {
    let value = ''
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    const finish = (err?: Error) => {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.removeListener('data', onData)
      process.stdout.write('\n')
      if (err) reject(err)
      else resolve(value)
    }
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') return finish()
        if (ch === '\u0003') return finish(new UsageError('Cancelled.'))
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1)
        else if (ch >= ' ' || ch === '\u001b') value += ch
      }
    }
    stdin.on('data', onData)
  })
}

async function readAllStdin(timeoutMs = 30_000): Promise<string> {
  const read = (async () => {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
    return Buffer.concat(chunks).toString('utf8')
  })()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new UsageError(
      'No key received. The person using this computer should run --setup in Terminal and paste the key when asked.',
    )), timeoutMs)
  })
  try {
    return await Promise.race([read, timeout])
  } finally {
    clearTimeout(timer)
  }
}

async function runSetup(): Promise<void> {
  const raw = process.stdin.isTTY
    ? await readHiddenLine('Paste your Gamma API key and press Enter (nothing will show while you paste): ')
    : await readAllStdin()
  const { replaced, unusualPrefix } = await saveApiKey(raw)
  console.log(`${replaced ? 'Replaced the key in' : 'Saved the key to'} ${CONFIG_PATH} (readable only by you).`)
  if (unusualPrefix) console.log('Note: Gamma API keys usually start with "sk-gamma-". If --check fails, copy the key again.')
  console.log(`Next, test it:  ${RUN} --check`)
}

// ---------------------------------------------------------------- Gamma API

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfterSeconds: number | null) {
    super(message)
  }
}

const STATUS_HINTS: Record<number, string> = {
  400: 'the request was not accepted; on the Free plan a deck can have at most 10 slides (--check shows the limit)',
  401: 'the API key was rejected; run --setup again with a valid key',
  402: 'the workspace is out of credits; see gamma.app/settings/billing',
  403: 'not allowed for this plan or key; a plan limit or a workspace admin setting may block it',
  429: 'Gamma is limiting requests; wait a minute',
}

async function gamma(apiKey: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${GAMMA_API}${path}`, {
    method,
    headers: {
      'X-API-KEY': apiKey,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error', // never forward the key to another host
    signal: AbortSignal.timeout(60_000),
  })
  const text = await res.text()
  if (!res.ok) {
    const hint = STATUS_HINTS[res.status] ? ` (${STATUS_HINTS[res.status]})` : ''
    const retryAfter = Number(res.headers.get('retry-after'))
    throw new ApiError(
      `Gamma API ${method} ${path} returned ${res.status}${hint}: ${text.slice(0, 500)}`,
      res.status,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
    )
  }
  return text ? JSON.parse(text) : {}
}

export function buildRequestBody(inputText: string, opts: Options): Record<string, unknown> {
  const body: Record<string, unknown> = {
    inputText,
    textMode: opts.textMode,
    format: 'presentation',
    exportAs: opts.format ?? 'pdf',
    // Private by default: people outside your workspace cannot open the link.
    sharingOptions: { externalAccess: opts.externalAccess },
  }
  if (opts.pages) body.numCards = opts.pages
  if (opts.cardSplit) body.cardSplit = opts.cardSplit
  if (opts.themeId) body.themeId = opts.themeId
  return body
}

export interface Completed {
  gammaUrl?: string
  exportUrl?: string
  credits?: { deducted?: number; remaining?: number }
}

export class StillRunning extends Error {}
export class GenerationFailed extends Error {}

/** Network trouble, timeouts, 429 and 5xx are worth another poll; anything else is final. */
function isTransient(e: unknown): boolean {
  if (e instanceof ApiError) return e.status === 429 || e.status >= 500
  return e instanceof TypeError || e instanceof SyntaxError ||
    (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError'))
}

export async function waitForGeneration(
  apiKey: string,
  generationId: string,
  maxWaitSeconds: number,
  pollMs = 5000,
): Promise<Completed> {
  const deadline = Date.now() + maxWaitSeconds * 1000
  let failures = 0
  while (true) {
    let waitMs = pollMs
    try {
      const data = await gamma(apiKey, 'GET', `/generations/${encodeURIComponent(generationId)}`)
      failures = 0
      if (data.status === 'completed') return data
      if (data.status === 'failed') {
        throw new GenerationFailed(`Gamma reports the generation failed: ${data.error?.message ?? 'unknown reason'}`)
      }
    } catch (e) {
      if (e instanceof GenerationFailed || !isTransient(e) || ++failures > 6) throw e
      const retryAfter = e instanceof ApiError ? e.retryAfterSeconds : null
      waitMs = Math.min(60_000, Math.max(pollMs * 2 ** (failures - 1), (retryAfter ?? 0) * 1000))
      console.error(`Temporary problem while checking (${(e as Error).message.slice(0, 120)}); retrying...`)
    }
    if (Date.now() + waitMs > deadline) {
      throw new StillRunning(`Still running after ${maxWaitSeconds}s.`)
    }
    await new Promise(r => setTimeout(r, waitMs))
  }
}

export function detectFormat(bytes: Uint8Array): Format | null {
  const head = String.fromCharCode(...bytes.slice(0, 5))
  if (head === '%PDF-') return 'pdf'
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return 'pptx'
  return null
}

function timestamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export function defaultOutputPath(format: Format): string {
  const downloads = join(homedir(), 'Downloads')
  const dir = existsSync(downloads) ? downloads : tmpdir()
  let path = join(dir, `gamma-${timestamp()}.${format}`)
  for (let n = 2; existsSync(path); n++) path = join(dir, `gamma-${timestamp()}-${n}.${format}`)
  return path
}

/** Download the export and save it only if it really is a PDF or PPTX. */
export async function downloadExport(exportUrl: string, wanted: Format | undefined, output: string | undefined) {
  const res = await fetch(exportUrl, { redirect: 'follow', signal: AbortSignal.timeout(180_000) })
  if (!res.ok) return { saved: null as string | null, reason: `download returned ${res.status}` }
  const bytes = new Uint8Array(await res.arrayBuffer())
  const got = detectFormat(bytes)
  if (!got) return { saved: null, reason: 'the download was not a PDF or PPTX file' }
  if (wanted && got !== wanted) return { saved: null, reason: `expected ${wanted} but got ${got}` }
  const outExt = output?.toLowerCase().match(/\.(pdf|pptx)$/)?.[1]
  if (outExt && outExt !== got) return { saved: null, reason: `the file is ${got} but --output ends in .${outExt}` }
  const path = output ?? defaultOutputPath(got)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, bytes)
  return { saved: path, reason: null }
}

function resumeCommand(generationId: string, opts: Options): string {
  return `${RUN} --resume ${generationId}${opts.format ? ` --format ${opts.format}` : ''}`
}

async function finish(apiKey: string, generationId: string, opts: Options): Promise<void> {
  console.log('Waiting for Gamma (usually 30-120 seconds)...')
  let result: Completed
  try {
    result = await waitForGeneration(apiKey, generationId, opts.maxWaitSeconds)
  } catch (e) {
    if (e instanceof GenerationFailed) throw e
    // Any other problem after the generation started: the deck may still finish on Gamma.
    console.error(`${(e as Error).message} The generation was already started and its credits are spent.`)
    console.error(`Do NOT start a new generation. Continue waiting with:`)
    console.error(`  ${resumeCommand(generationId, opts)}`)
    process.exitCode = 2
    return
  }

  console.log(`Done. Gamma URL: ${result.gammaUrl ?? '(not returned)'}`)
  let saved: string | null = null
  if (result.exportUrl) {
    let dl: { saved: string | null; reason: string | null }
    try {
      dl = await downloadExport(result.exportUrl, opts.format, opts.output)
    } catch (e) {
      dl = { saved: null, reason: (e as Error).message }
    }
    saved = dl.saved
    if (saved) console.log(`Saved to: ${saved}`)
    else {
      console.log(`Could not save the file (${dl.reason}).`)
      console.log(`To try the download again without new credits (works for about a week):`)
      console.log(`  ${resumeCommand(generationId, opts)}`)
      console.log('Or open the Gamma URL and use Export.')
    }
  } else {
    console.log('Gamma did not return a download link. Open the Gamma URL and use Export instead.')
  }

  console.log(JSON.stringify({
    generationId,
    gammaUrl: result.gammaUrl ?? null,
    output: saved,
    downloaded: saved !== null,
    creditsDeducted: result.credits?.deducted ?? null,
    creditsRemaining: result.credits?.remaining ?? null,
  }))
}

// ---------------------------------------------------------------- main

const USAGE = `Usage:
  bun ${SCRIPT} --setup                      save your Gamma API key (do this once)
  bun ${SCRIPT} --check                      test the key, show plan and credits (free)
  bun ${SCRIPT} --topic "Topic" [options]    generate a deck from a short topic
  bun ${SCRIPT} --content-file outline.md [options]
  bun ${SCRIPT} --resume <generationId>      keep waiting for a generation that timed out

Options:
  --format pdf|pptx          export format (default: pdf)
  --pages N                  number of slides (Free plan: up to 10)
  --output path              where to save (default: ~/Downloads/gamma-<time>.<ext>)
  --text-mode MODE           generate | condense | preserve (default: generate)
  --card-split MODE          auto | inputTextBreaks (one slide per --- section)
  --theme-id ID              Gamma theme ID
  --external-access LEVEL    noAccess | view | comment | edit (default: noAccess = private)
  --max-wait SECONDS         how long to wait before giving up (default: 600)
  --dry-run                  print the request that would be sent and stop (no credits)`

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2))

  if (opts.command === 'help') { console.log(USAGE); return }
  if (opts.command === 'setup') { await runSetup(); return }

  const apiKey = await readApiKey()
  if (!apiKey && !opts.dryRun) {
    console.error('No Gamma API key found.')
    console.error('The person using this computer should open Terminal and run:')
    console.error(`  ${RUN} --setup`)
    console.error('Never paste the key into a chat.')
    process.exitCode = 1
    return
  }

  if (opts.command === 'check') {
    const me = await gamma(apiKey!, 'GET', '/me')
    console.log('The key works.')
    console.log(`Workspace: ${me.workspaceName ?? '(unknown)'} | plan: ${me.planTier ?? '(unknown)'} | ` +
      `max slides per deck: ${me.maxGenerateCards ?? '(unknown)'} | credits left: ${me.creditsRemaining ?? '(unknown)'}`)
    return
  }

  if (opts.command === 'resume') {
    await finish(apiKey!, opts.resumeId!, opts)
    return
  }

  if (opts.contentFile) opts.content = await readFile(opts.contentFile, 'utf8')
  if (!opts.topic && !opts.content) throw new UsageError('Give --topic, --content, or --content-file.')
  const inputText = opts.content
    ?? `Create a presentation about: ${opts.topic}${opts.pages ? `. Target ${opts.pages} slides.` : ''}`

  if (opts.content?.includes('\n---\n') && !opts.cardSplit && opts.textMode === 'generate') {
    console.log('Tip: the content has --- separators. Add --text-mode preserve --card-split inputTextBreaks to keep one slide per section.')
  }

  const body = buildRequestBody(inputText, opts)
  if (opts.dryRun) {
    console.log(JSON.stringify({ endpoint: `POST ${GAMMA_API}/generations`, body }, null, 2))
    return
  }

  console.log(`Starting Gamma (textMode: ${opts.textMode}, export: ${body.exportAs}, sharing outside workspace: ${opts.externalAccess})...`)
  let created: any
  try {
    created = await gamma(apiKey!, 'POST', '/generations', body)
  } catch (e) {
    if (!(e instanceof ApiError)) {
      // No answer from Gamma: the deck may have been created anyway.
      throw new Error(`${(e as Error).message}. Gamma may have started the deck anyway; ` +
        'check gamma.app for a new deck before trying again.')
    }
    throw e
  }
  const generationId: string = created.generationId
  if (!generationId) throw new Error('Gamma did not return a generation ID.')
  console.log(`Generation ID: ${generationId}`)
  if (created.warnings) console.log(`Gamma warning (tell the user): ${created.warnings}`)
  await finish(apiKey!, generationId, opts)
}

if (import.meta.main) {
  main().catch(e => {
    console.error(e instanceof UsageError ? `${e.message}\n\n${USAGE}` : `Error: ${e.message}`)
    process.exitCode = 1
  })
}
