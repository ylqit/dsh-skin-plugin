import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { PART_GUIDE_FILENAMES } from '../shared/part-guides.ts'
import { MAX_ARCHIVE_BYTES, SkinArchiveError } from './archive.ts'
import { SkinLibrary } from './library.ts'

const PREFIX = '/api/dsh-skin'
const JSON_BODY_LIMIT = 64 * 1024
const FINGERPRINT = '[a-f0-9]{64}'
const ASSET_NAME = '[A-Za-z0-9][A-Za-z0-9._-]{0,127}'
const GUIDE_NAMES = new Set<string>(PART_GUIDE_FILENAMES)

export interface SkinWebServer {
  register(route: {
    kind: 'prefix'
    path: string
    handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
  }): () => void
  tapIndex(transform: (html: string) => string): () => void
}

/** Register the same-origin management, immutable asset, and invalidation endpoints. */
export function registerSkinHttp(server: SkinWebServer, library: SkinLibrary, guidesRoot: string): () => void {
  const streams = new Set<ServerResponse>()
  const heartbeat = setInterval(() => {
    for (const response of [...streams]) {
      try {
        response.write(`: heartbeat ${String(Date.now())}\n\n`)
      } catch {
        streams.delete(response)
      }
    }
  }, 20_000)
  heartbeat.unref()
  const publish = (): void => {
    const revision = library.snapshot().activationRevision
    for (const response of [...streams]) {
      try {
        response.write(`event: skin-change\ndata: ${JSON.stringify({ activationRevision: revision })}\n\n`)
      } catch {
        streams.delete(response)
      }
    }
  }
  const unsubscribe = library.subscribe(publish)
  const unregister = server.register({
    kind: 'prefix',
    path: PREFIX,
    handler: async (request, response) => {
      try {
        await dispatch(request, response, library, guidesRoot, streams)
      } catch (error) {
        const status = error instanceof HttpError ? error.status : error instanceof TypeError ? 400 : 500
        const message = status === 500 ? 'Internal skin service error' : error instanceof Error ? error.message : String(error)
        if (status === 500) console.error('[dsh-skin-plugin]', error)
        json(response, status, {
          ok: false,
          error: message,
          ...(error instanceof SkinArchiveError ? {
            code: error.code,
            ...(error.field === undefined ? {} : { field: error.field }),
          } : {}),
        })
      }
    },
  })
  return () => {
    clearInterval(heartbeat)
    unsubscribe()
    unregister()
    for (const response of streams) response.end()
    streams.clear()
  }
}

async function dispatch(
  request: IncomingMessage,
  response: ServerResponse,
  library: SkinLibrary,
  guidesRoot: string,
  streams: Set<ServerResponse>,
): Promise<void> {
  const method = request.method ?? 'GET'
  const pathname = new URL(request.url ?? '/', 'http://dsh.local').pathname
  if (method === 'GET' && pathname === `${PREFIX}/state`) {
    json(response, 200, { ok: true, value: library.snapshot() })
    return
  }
  if (method === 'GET' && pathname === `${PREFIX}/events`) {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Content-Type-Options': 'nosniff',
    })
    response.write(`event: ready\ndata: ${JSON.stringify({ activationRevision: library.snapshot().activationRevision })}\n\n`)
    streams.add(response)
    request.once('close', () => { streams.delete(response) })
    return
  }
  const skinMatch = new RegExp(`^${PREFIX}/skins/(${FINGERPRINT})$`).exec(pathname)
  if (method === 'GET' && skinMatch !== null) {
    json(response, 200, { ok: true, value: library.draft(skinMatch[1] as string) })
    return
  }
  const assetMatch = new RegExp(`^${PREFIX}/assets/(${FINGERPRINT})/(${ASSET_NAME})$`).exec(pathname)
  if (method === 'GET' && assetMatch !== null) {
    const asset = library.asset(assetMatch[1] as string, assetMatch[2] as string)
    response.writeHead(200, {
      'Content-Type': asset.mimeType,
      'Content-Length': asset.bytes.byteLength,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    })
    response.end(asset.bytes)
    return
  }
  const guideMatch = new RegExp(`^${PREFIX}/guides/(${ASSET_NAME})$`).exec(pathname)
  if (method === 'GET' && guideMatch !== null && GUIDE_NAMES.has(guideMatch[1] as string)) {
    const bytes = await readFile(join(guidesRoot, guideMatch[1] as string))
    response.writeHead(200, {
      'Content-Type': 'image/webp',
      'Content-Length': bytes.byteLength,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    })
    response.end(bytes)
    return
  }
  const experienceMatch = new RegExp(`^${PREFIX}/experience/(${FINGERPRINT})/client\\.js$`).exec(pathname)
  if (method === 'GET' && experienceMatch !== null) {
    const experience = library.experience(experienceMatch[1] as string)
    response.writeHead(200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Content-Length': experience.bytes.byteLength,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    })
    response.end(experience.bytes)
    return
  }

  authorizeMutation(request)
  if (method === 'POST' && pathname === `${PREFIX}/import`) {
    const archive = await readBody(request, MAX_ARCHIVE_BYTES)
    json(response, 201, { ok: true, value: await library.import(archive) })
    return
  }
  if (method === 'POST' && pathname === `${PREFIX}/prepare`) {
    const body = await readJsonObject(request)
    exactKeys(body, ['fingerprint'], 'prepare request')
    if (body.fingerprint !== undefined && typeof body.fingerprint !== 'string') throw new TypeError('prepare request fingerprint must be a string')
    json(response, 200, { ok: true, value: library.prepare(body.fingerprint) })
    return
  }
  if (method === 'POST' && pathname === `${PREFIX}/commit`) {
    const body = await readJsonObject(request)
    exactKeys(body, ['preparationId'], 'commit request')
    if (typeof body.preparationId !== 'string') throw new TypeError('commit request preparationId must be a string')
    json(response, 200, { ok: true, value: await library.commit(body.preparationId) })
    return
  }
  if (method === 'POST' && pathname === `${PREFIX}/cancel`) {
    const body = await readJsonObject(request)
    exactKeys(body, ['preparationId'], 'cancel request')
    if (typeof body.preparationId !== 'string') throw new TypeError('cancel request preparationId must be a string')
    library.cancel(body.preparationId)
    json(response, 200, { ok: true, value: { cancelled: true } })
    return
  }
  if (method === 'DELETE' && skinMatch !== null) {
    await library.delete(skinMatch[1] as string)
    json(response, 200, { ok: true, value: { deleted: true } })
    return
  }
  throw new HttpError(404, 'Skin endpoint not found')
}

function authorizeMutation(request: IncomingMessage): void {
  const address = request.socket.remoteAddress ?? ''
  const loopback = address === '::1' || address === '127.0.0.1' || address.startsWith('::ffff:127.')
  if (!loopback) throw new HttpError(403, 'Skin management is available only from the Host machine')
  const origin = request.headers.origin
  const authority = request.headers.host
  if (origin !== undefined && authority !== undefined) {
    let originAuthority: string
    try {
      originAuthority = new URL(origin).host
    } catch {
      throw new HttpError(403, 'Skin management request has an invalid Origin')
    }
    if (originAuthority !== authority) throw new HttpError(403, 'Cross-origin skin management is forbidden')
  }
}

async function readJsonObject(request: IncomingMessage): Promise<Record<string, unknown>> {
  const bytes = await readBody(request, JSON_BODY_LIMIT)
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } catch (error) {
    throw new TypeError('request body must be valid UTF-8 JSON', { cause: error })
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('request body must be a JSON object')
  return value as Record<string, unknown>
}

async function readBody(request: IncomingMessage, limit: number): Promise<Uint8Array> {
  const declared = Number(request.headers['content-length'])
  if (Number.isFinite(declared) && declared > limit) throw new HttpError(413, 'Skin request body is too large')
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of request) {
    const bytes = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : new Uint8Array(chunk)
    total += bytes.byteLength
    if (total > limit) throw new HttpError(413, 'Skin request body is too large')
    chunks.push(bytes)
  }
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], subject: string): void {
  const unknown = Object.keys(value).find(key => !allowed.includes(key))
  if (unknown !== undefined) throw new TypeError(`${subject} contains unsupported field ${JSON.stringify(unknown)}`)
}

function json(response: ServerResponse, status: number, value: unknown): void {
  if (response.headersSent) {
    response.end()
    return
  }
  const bytes = Buffer.from(JSON.stringify(value))
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': bytes.byteLength,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(bytes)
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}
