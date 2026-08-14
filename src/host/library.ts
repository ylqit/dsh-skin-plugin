import { randomUUID } from 'node:crypto'
import {
  mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile,
} from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  parseSkinArchive, parseSkinFiles, type ParsedSkinArchive,
} from './archive.ts'
import type {
  CommitSkinResult, PrepareSkinResult, SkinHostState, StoredSkinSummary, ThemeLayerDefinition,
} from '../shared/contracts.ts'

const FINGERPRINT = /^[a-f0-9]{64}$/
const PREPARATION_TTL_MS = 60_000

interface DurableState {
  active?: string
  previousConfirmed?: string
  activationRevision: number
}

interface Preparation {
  id: string
  fingerprint?: string
  expiresAt: number
}

/** Host-owned immutable skin library and two-phase activation authority. */
export class SkinLibrary {
  private readonly skins = new Map<string, ParsedSkinArchive>()
  private readonly preparations = new Map<string, Preparation>()
  private readonly listeners = new Set<() => void>()
  private mutationTail: Promise<void> = Promise.resolve()

  private constructor(
    private readonly root: string,
    private state: DurableState,
    private readonly warn: (error: unknown) => void,
  ) {}

  /** Load and authenticate every persisted version before serving the WebUI. */
  static async open(root: string, warn: (error: unknown) => void = () => {}): Promise<SkinLibrary> {
    await mkdir(root, { recursive: true })
    const library = new SkinLibrary(root, await readDurableState(root, warn), warn)
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !FINGERPRINT.test(entry.name)) continue
      try {
        const parsed = await readStoredSkin(join(root, entry.name))
        if (parsed.fingerprint !== entry.name) throw new TypeError(`stored skin ${entry.name} content fingerprint does not match its directory`)
        library.skins.set(entry.name, parsed)
      } catch (error) {
        warn(error)
      }
    }
    await library.recoverConfirmedSelection()
    return library
  }

  /** Subscribe to library or activation changes. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Snapshot used by the JSON API and all browser clients. */
  snapshot(): SkinHostState {
    const active = this.state.active === undefined ? undefined : this.skins.get(this.state.active)
    return Object.freeze({
      activationRevision: this.state.activationRevision,
      ...(active === undefined ? {} : { activeFingerprint: active.fingerprint, activeLayer: active.layer }),
      ...(this.state.previousConfirmed === undefined ? {} : { previousConfirmed: this.state.previousConfirmed }),
      skins: Object.freeze([...this.skins.values()].map(summary).sort((left, right) => left.name.localeCompare(right.name))),
    })
  }

  /** Synchronous first-paint source registered with Harness Theme Boot. */
  activeBoot(): { activationRevision: number; contentFingerprint: string; layer: ThemeLayerDefinition } | undefined {
    if (this.state.active === undefined) return undefined
    const active = this.skins.get(this.state.active)
    if (active === undefined) return undefined
    return {
      activationRevision: this.state.activationRevision,
      contentFingerprint: active.fingerprint,
      layer: active.layer,
    }
  }

  /** Validate and atomically add one content-addressed .dshskin archive. */
  async import(archive: Uint8Array): Promise<StoredSkinSummary> {
    return this.mutate(async () => {
      const parsed = parseSkinArchive(archive)
      const present = this.skins.get(parsed.fingerprint)
      if (present !== undefined) return summary(present)
      const destination = join(this.root, parsed.fingerprint)
      try {
        await readFile(join(destination, 'manifest.json'))
        throw new Error(`skin directory ${parsed.fingerprint} exists but was not accepted during startup`)
      } catch (error) {
        if (!isMissing(error)) throw error
      }
      const staging = await mkdtemp(join(this.root, '.import-'))
      try {
        for (const [name, bytes] of parsed.files) {
          const target = join(staging, ...name.split('/'))
          await mkdir(dirname(target), { recursive: true })
          await writeFile(target, bytes, { flag: 'wx' })
        }
        await rename(staging, destination)
      } catch (error) {
        await rm(staging, { recursive: true, force: true })
        throw error
      }
      this.skins.set(parsed.fingerprint, parsed)
      this.publish()
      return summary(parsed)
    })
  }

  /** Begin activation of a stored fingerprint, or of the Harness default when omitted. */
  prepare(fingerprint?: string): PrepareSkinResult {
    const skin = fingerprint === undefined ? undefined : this.requireSkin(fingerprint)
    this.expirePreparations()
    const prepared: Preparation = {
      id: randomUUID(),
      ...(fingerprint === undefined ? {} : { fingerprint }),
      expiresAt: Date.now() + PREPARATION_TTL_MS,
    }
    this.preparations.set(prepared.id, prepared)
    return {
      preparationId: prepared.id,
      ...(fingerprint === undefined ? {} : { fingerprint }),
      activationRevision: this.state.activationRevision,
      ...(skin === undefined ? {} : { layer: skin.layer }),
    }
  }

  /** Commit one live preparation and publish the durable activation revision. */
  async commit(preparationId: string): Promise<CommitSkinResult> {
    return this.mutate(async () => {
      this.expirePreparations()
      const prepared = this.preparations.get(preparationId)
      if (prepared === undefined) throw new TypeError('skin preparation is missing or expired')
      const skin = prepared.fingerprint === undefined ? undefined : this.requireSkin(prepared.fingerprint)
      const previous = this.state.active
      const next: DurableState = {
        ...(prepared.fingerprint === undefined ? {} : { active: prepared.fingerprint }),
        ...(previous === undefined ? {} : { previousConfirmed: previous }),
        activationRevision: this.state.activationRevision + 1,
      }
      await this.writeState(next)
      this.preparations.delete(preparationId)
      this.state = next
      this.publish()
      return {
        ...(prepared.fingerprint === undefined ? {} : { fingerprint: prepared.fingerprint }),
        activationRevision: this.state.activationRevision,
        ...(skin === undefined ? {} : { layer: skin.layer }),
      }
    })
  }

  /** Cancel one preparation without changing the confirmed selection. */
  cancel(preparationId: string): void {
    if (!this.preparations.delete(preparationId)) throw new TypeError('skin preparation is missing or expired')
  }

  /** Delete one inactive, non-fallback immutable version. */
  async delete(fingerprint: string): Promise<void> {
    await this.mutate(async () => {
      this.requireSkin(fingerprint)
      if (this.state.active === fingerprint) throw new TypeError('the active skin cannot be deleted')
      if (this.state.previousConfirmed === fingerprint) throw new TypeError('the previous confirmed fallback cannot be deleted')
      await rm(join(this.root, fingerprint), { recursive: true })
      this.skins.delete(fingerprint)
      this.publish()
    })
  }

  /** Read a validated immutable image for the public asset route. */
  asset(fingerprint: string, filename: string): { bytes: Uint8Array; mimeType: string } {
    const skin = this.requireSkin(fingerprint)
    const path = `assets/${filename}`
    const declaration = skin.manifest.assets.find(asset => asset.path === path)
    const bytes = skin.files.get(path)
    if (declaration === undefined || bytes === undefined) throw new TypeError('skin asset does not exist')
    return { bytes, mimeType: declaration.mimeType }
  }

  /** Read one validated layer for a remote-capable, read-only preview request. */
  layer(fingerprint: string): ThemeLayerDefinition {
    return this.requireSkin(fingerprint).layer
  }

  private requireSkin(fingerprint: string): ParsedSkinArchive {
    if (!FINGERPRINT.test(fingerprint)) throw new TypeError('skin fingerprint must be lowercase SHA-256')
    const skin = this.skins.get(fingerprint)
    if (skin === undefined) throw new TypeError('skin fingerprint is not installed')
    return skin
  }

  private expirePreparations(): void {
    const now = Date.now()
    for (const [id, preparation] of this.preparations) {
      if (preparation.expiresAt <= now) this.preparations.delete(id)
    }
  }

  /** Keep durable state and the in-memory index in the same mutation order. */
  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation)
    this.mutationTail = result.then(() => undefined, () => undefined)
    return result
  }

  private async recoverConfirmedSelection(): Promise<void> {
    const activeAccepted = this.state.active !== undefined && this.skins.has(this.state.active)
    if (activeAccepted) return
    const fallback = this.state.previousConfirmed !== undefined && this.skins.has(this.state.previousConfirmed)
      ? this.state.previousConfirmed
      : undefined
    if (this.state.active === undefined && fallback === undefined) return
    this.warn(new Error('dsh-skin-plugin: active skin was unavailable; restored the previous confirmed skin or Harness default'))
    const next: DurableState = {
      ...(fallback === undefined ? {} : { active: fallback }),
      activationRevision: this.state.activationRevision + 1,
    }
    await this.writeState(next)
    this.state = next
  }

  private async writeState(state: DurableState): Promise<void> {
    const target = join(this.root, 'state.json')
    const staging = join(this.root, `.state-${randomUUID()}.tmp`)
    await writeFile(staging, `${JSON.stringify(state, null, 2)}\n`, { flag: 'wx' })
    try {
      await rename(staging, target)
    } catch (error) {
      if (!isReplaceFailure(error)) {
        await rm(staging, { force: true })
        throw error
      }
      await rm(target, { force: true })
      await rename(staging, target)
    }
  }

  private publish(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch (error) {
        this.warn(error)
      }
    }
  }
}

function summary(skin: ParsedSkinArchive): StoredSkinSummary {
  return Object.freeze({
    fingerprint: skin.fingerprint,
    id: skin.manifest.id,
    name: skin.manifest.name,
    version: skin.manifest.version,
    capabilities: skin.manifest.capabilities,
  })
}

async function readStoredSkin(directory: string): Promise<ParsedSkinArchive> {
  const entries: Record<string, Uint8Array> = {
    'manifest.json': await readFile(join(directory, 'manifest.json')),
    'theme.json': await readFile(join(directory, 'theme.json')),
  }
  const assetsDirectory = join(directory, 'assets')
  try {
    for (const entry of await readdir(assetsDirectory, { withFileTypes: true })) {
      if (!entry.isFile()) throw new TypeError(`stored skin contains unsupported asset entry ${JSON.stringify(entry.name)}`)
      entries[`assets/${entry.name}`] = await readFile(join(assetsDirectory, entry.name))
    }
  } catch (error) {
    if (!isMissing(error)) throw error
  }
  return parseSkinFiles(entries)
}

async function readDurableState(root: string, warn: (error: unknown) => void): Promise<DurableState> {
  try {
    const value = JSON.parse(await readFile(join(root, 'state.json'), 'utf8')) as unknown
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('skin state must be an object')
    const source = value as Record<string, unknown>
    const active = source.active
    const previousConfirmed = source.previousConfirmed
    if (active !== undefined && (typeof active !== 'string' || !FINGERPRINT.test(active))) throw new TypeError('skin state active fingerprint is invalid')
    if (previousConfirmed !== undefined && (typeof previousConfirmed !== 'string' || !FINGERPRINT.test(previousConfirmed))) throw new TypeError('skin state fallback fingerprint is invalid')
    if (!Number.isSafeInteger(source.activationRevision) || (source.activationRevision as number) < 0) throw new TypeError('skin state activationRevision is invalid')
    return {
      ...(active === undefined ? {} : { active }),
      ...(previousConfirmed === undefined ? {} : { previousConfirmed }),
      activationRevision: source.activationRevision as number,
    }
  } catch (error) {
    if (!isMissing(error)) warn(error)
    return { activationRevision: 0 }
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'ENOENT'
}

function isReplaceFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const code = (error as NodeJS.ErrnoException).code
  return code === 'EEXIST' || code === 'EPERM'
}
