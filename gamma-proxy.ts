#!/usr/bin/env bun
/**
 * Gamma API Proxy — sidecar for CLIProxyAPI
 * Authenticates with the same MAGI proxy key, forwards to Gamma API with centralized key.
 *
 * Runs on port 8318 (CLIProxyAPI is 8317).
 *
 * Usage:
 *   bun run gamma-proxy.ts
 *
 * Client:
 *   curl -X POST http://127.0.0.1:8318/v1/gamma/generations \
 *     -H "Authorization: Bearer your-proxy-key" \
 *     -H "Content-Type: application/json" \
 *     -d '{"inputText":"About AI","textMode":"generate","exportAs":"pdf"}'
 *
 *   curl http://127.0.0.1:8318/v1/gamma/generations/{id} \
 *     -H "Authorization: Bearer your-proxy-key"
 */

const PORT = 8318
const GAMMA_API = 'https://public-api.gamma.app/v1.0'

// --- Config ---
interface Config {
  magiKey: string
  gammaKey: string
  whitelist: string[] // list of allowed MAGI keys (for multi-user)
}

async function loadConfig(): Promise<Config> {
  // MAGI proxy key from CLIProxyAPI config
  const magiKey = process.env.GAMMA_PROXY_AUTH_KEY || 'change-me'

  // Gamma key from managed config
  let gammaKey = process.env.GAMMA_API_KEY || ''
  if (!gammaKey) {
    try {
      const config = JSON.parse(await Bun.file(`${process.env.HOME}/.gamma/config.json`).text())
      gammaKey = config.api_key || ''
    } catch {}
  }
  if (!gammaKey) {
    console.error('Error: No Gamma API key. Set GAMMA_API_KEY or ~/.gamma/config.json')
    process.exit(1)
  }

  // Whitelist: main key + any additional keys
  let whitelist = [magiKey]
  try {
    const wl = JSON.parse(await Bun.file(`${process.env.HOME}/.gamma/whitelist.json`).text())
    if (Array.isArray(wl)) whitelist = [...whitelist, ...wl]
  } catch {}

  return { magiKey, gammaKey, whitelist }
}

// --- Auth ---
function extractKey(req: Request): string | null {
  const auth = req.headers.get('Authorization')
  if (auth?.startsWith('Bearer ')) return auth.slice(7)
  return req.headers.get('X-API-KEY')
}

// --- Server ---
const config = await loadConfig()
console.log(`Gamma Proxy starting on port ${PORT}`)
console.log(`Whitelist: ${config.whitelist.length} key(s)`)

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)

    // Health check
    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', service: 'gamma-proxy', port: PORT })
    }

    // Auth check
    const key = extractKey(req)
    if (!key || !config.whitelist.includes(key)) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // POST /v1/gamma/generations — create generation
    if (url.pathname === '/v1/gamma/generations' && req.method === 'POST') {
      const body = await req.json()
      const res = await fetch(`${GAMMA_API}/generations`, {
        method: 'POST',
        headers: {
          'X-API-KEY': config.gammaKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      return Response.json(data, { status: res.status })
    }

    // GET /v1/gamma/generations/:id — poll status
    const pollMatch = url.pathname.match(/^\/v1\/gamma\/generations\/([^/]+)$/)
    if (pollMatch && req.method === 'GET') {
      const id = pollMatch[1]
      const res = await fetch(`${GAMMA_API}/generations/${id}`, {
        headers: { 'X-API-KEY': config.gammaKey },
      })
      const data = await res.json()
      return Response.json(data, { status: res.status })
    }

    // GET /v1/gamma/credits — check remaining credits
    if (url.pathname === '/v1/gamma/credits' && req.method === 'GET') {
      // Use a lightweight poll of a known generation to check credits
      return Response.json({ message: 'Credits are shown in generation responses' })
    }

    return Response.json({ error: 'Not found', routes: [
      'POST /v1/gamma/generations',
      'GET  /v1/gamma/generations/:id',
      'GET  /health',
    ]}, { status: 404 })
  },
})

console.log(`Gamma Proxy running at http://127.0.0.1:${PORT}`)
