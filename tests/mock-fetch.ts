// Preload: replaces fetch with a fake Gamma. Scenario via MOCK_SCENARIO.
const log: any[] = []
const scenario = process.env.MOCK_SCENARIO ?? 'ok'
let polls = 0
globalThis.fetch = (async (url: any, init: any = {}) => {
  const u = String(url)
  log.push({ u, method: init.method ?? 'GET', headers: init.headers, body: init.body })
  await Bun.write(process.env.MOCK_LOG!, JSON.stringify(log))
  const json = (o: any, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
  if (u.endsWith('/v1.0/me')) return scenario === 'badkey' ? json({ message: 'Invalid API key' }, 401) : json({ workspaceName: 'W', planTier: 'free', maxGenerateCards: 10, creditsRemaining: 400, email: 'secret@example.com' })
  if (u.endsWith('/v1.0/generations') && init.method === 'POST') {
    if (scenario === 'nocredit') return json({ message: 'Insufficient credits remaining' }, 402)
    if (scenario === 'postnet') throw new TypeError('fetch failed')
    return json(scenario === 'warn' ? { generationId: 'gen123', warnings: 'externalAccess was ignored' } : { generationId: 'gen123' })
  }
  if (u.includes('/v1.0/generations/')) {
    polls++
    if (scenario === 'netfail') throw new TypeError('fetch failed')
    if (scenario === 'flaky' && polls === 1) return new Response('upstream', { status: 503, headers: { 'retry-after': '1' } })
    if (scenario === 'pending') return json({ status: 'pending' })
    if (scenario === 'failed') return json({ status: 'failed', error: { message: 'boom' } })
    if (polls < 2) return json({ status: 'pending' })
    const ext = scenario === 'html' ? 'html' : 'pdf'
    return json({ status: 'completed', gammaUrl: 'https://gamma.app/docs/x', exportUrl: `https://files.example.invalid/deck.${ext}`, credits: { deducted: 42, remaining: 358 } })
  }
  if (u.startsWith('https://files.example.invalid/')) {
    if (scenario === 'dlfail') throw new TypeError('connection reset')
    if (u.endsWith('.html')) return new Response('<html>login</html>', { status: 200 })
    return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]), { status: 200 })
  }
  return new Response('not found', { status: 404 })
}) as any
// make polling fast for tests
const realSetTimeout = globalThis.setTimeout
globalThis.setTimeout = ((fn: any, _ms: number, ...a: any[]) => realSetTimeout(fn, 1, ...a)) as any
