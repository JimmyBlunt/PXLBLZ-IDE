import { createHash, randomBytes } from 'node:crypto'
import type { Page } from '@playwright/test'

const redirectUri = 'http://127.0.0.1:3160/callback'
const protocolVersion = '2025-11-25'

export interface SafeMcpCall {
  name: string
  code: unknown
  operation_id?: unknown
  receipt?: { status?: unknown; settlement?: unknown; reason?: unknown }
}

export interface ShowMcpClient {
  bindingId: string
  safeTranscript: SafeMcpCall[]
  tool(name: string, args?: object): Promise<Record<string, unknown>>
  close(): Promise<void>
}

/** A synthetic, dynamically registered external MCP client for the mounted Show editor. */
export async function connectShowMcp(page: Page, expectedShowId: string): Promise<ShowMcpClient> {
  const request = page.context().request
  const origin = new URL(page.url()).origin
  const resource = `${origin}/mcp`
  const registered = await request.post(`${origin}/oauth/register`, {
    data: {
      client_name: 'Show qualification 1160',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
  })
  if (registered.status() !== 201) throw new Error(`MCP registration transport: HTTP ${registered.status()}`)
  const clientId = (await registered.json() as { client_id?: unknown }).client_id
  if (typeof clientId !== 'string') throw new Error('MCP registration omitted client_id')

  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const state = randomBytes(16).toString('hex')
  const authorization = await request.get(`${origin}/oauth/authorize?${new URLSearchParams({
    agent: '1', client_id: clientId, redirect_uri: redirectUri, response_type: 'code',
    scope: 'agent:connect', state, resource, code_challenge_method: 'S256', code_challenge: challenge,
  })}`)
  if (authorization.status() !== 200) throw new Error(`MCP authorization transport: HTTP ${authorization.status()}`)
  const consentPage = await authorization.text()
  const nonce = consentPage.match(/name="nonce" value="([^"]+)"/)?.[1]
  if (!nonce) throw new Error('MCP consent page omitted nonce')
  const consent = await request.post(`${origin}/oauth/authorize`, {
    headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
    data: new URLSearchParams({ nonce, decision: 'allow' }).toString(),
    maxRedirects: 0,
  })
  if (consent.status() !== 303) throw new Error(`MCP consent transport: HTTP ${consent.status()}`)
  const location = consent.headers().location
  if (!location) throw new Error('MCP consent omitted redirect')
  const callback = new URL(location)
  if (callback.origin !== new URL(redirectUri).origin || callback.pathname !== new URL(redirectUri).pathname || callback.searchParams.get('state') !== state) {
    throw new Error('MCP consent returned a different callback or state')
  }
  const code = callback.searchParams.get('code')
  if (!code) throw new Error('MCP consent omitted code')
  const token = await request.post(`${origin}/oauth/token`, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    data: new URLSearchParams({ client_id: clientId, resource, grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri }).toString(),
  })
  // Never include the response body in an error or transcript: it contains credentials.
  if (token.status() !== 200) throw new Error(`MCP token transport: HTTP ${token.status()}`)
  const issued = await token.json() as { access_token?: unknown; refresh_token?: unknown }
  if (typeof issued.access_token !== 'string' || typeof issued.refresh_token !== 'string') throw new Error('MCP token response omitted credentials')
  const accessToken = issued.access_token
  const refreshToken = issued.refresh_token
  let rpcId = 0
  const safeTranscript: SafeMcpCall[] = []
  async function rpc(method: string, params: object): Promise<Record<string, unknown>> {
    const response = await request.post(resource, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': protocolVersion,
      },
      data: { jsonrpc: '2.0', id: ++rpcId, method, params },
    })
    if (response.status() !== 200) throw new Error(`MCP ${method} transport: HTTP ${response.status()}`)
    if (!response.headers()['content-type']?.includes('application/json')) throw new Error(`MCP ${method} transport: non-JSON response`)
    const body = await response.json() as { error?: { code?: unknown }; result?: Record<string, unknown> }
    if (body.error || !body.result) throw new Error(`MCP ${method} protocol: ${String(body.error?.code ?? 'missing result')}`)
    return body.result
  }
  const initialized = await rpc('initialize', {
    protocolVersion, capabilities: {}, clientInfo: { name: 'Show qualification 1160', version: '1' },
  })
  if ((initialized as { protocolVersion?: unknown }).protocolVersion !== protocolVersion) throw new Error('MCP protocol version mismatch')
  async function tool(name: string, args: object = {}): Promise<Record<string, unknown>> {
    const result = await rpc('tools/call', { name, arguments: args })
    const content = result.structuredContent
    if (!content || typeof content !== 'object' || Array.isArray(content)) throw new Error(`MCP ${name} omitted structuredContent`)
    const value = content as Record<string, unknown>
    const receipt = value.receipt as Record<string, unknown> | undefined
    safeTranscript.push({ name, code: value.code, ...(value.operation_id ? { operation_id: value.operation_id } : {}),
      ...(receipt ? { receipt: { status: receipt.status, settlement: receipt.settlement, reason: receipt.reason } } : {}) })
    return value
  }
  const pendingConnection = tool('get_connection')
  const answer = page.getByRole('button', { name: 'Answer', exact: true })
  await Promise.race([pendingConnection, answer.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined)])
  if (await answer.isVisible()) await answer.click()
  const connection = await pendingConnection
  if (connection.code !== 'bound' || connection.show_id !== expectedShowId || typeof connection.binding_id !== 'string') {
    throw new Error(`MCP bound wrong Show: ${JSON.stringify({ code: connection.code, show_id: connection.show_id })}`)
  }
  return {
    bindingId: connection.binding_id,
    safeTranscript,
    tool,
    async close() {
      const disconnect = page.getByRole('complementary', { name: 'Agent drawer', exact: true }).getByRole('button', { name: 'Disconnect', exact: true })
      if (!page.isClosed() && await disconnect.isVisible()) await disconnect.click()
      const revoked = await request.post(`${origin}/oauth/token`, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        data: new URLSearchParams({ client_id: clientId, resource, token: refreshToken }).toString(),
      })
      if (revoked.status() !== 200) throw new Error(`MCP token revocation transport: HTTP ${revoked.status()}`)
    },
  }
}
