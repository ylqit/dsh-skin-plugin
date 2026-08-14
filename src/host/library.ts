import { randomUUID } from 'node:crypto'
import {
  mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile,
} from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import {
  parseSkinArchive, parseSkinFiles, type ParsedSkinArchive,
} from './archive.ts'
import type {
  CommitSkinResult, PrepareSkinResult, SkinExperienceDescriptor, SkinHostState,
  SkinSource, StoredSkinSummary, ThemeLayerDefinition,
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

interface InstalledSkin {
  archive: ParsedSkinArchive
  source: SkinSource
}

/** Host-owned immutable skin library and two-phase activation authority. */
export class SkinLibrary {
  private readonly skins = new Map<string, InstalledSkin>()
  private readonly preparations = new Map<string, Preparation>()
  private readonly listeners = new Set<() => void>()
  private mutationTail: Promise<void> = Promise.resolve()

  private constructor(
    private readonly root: string,
    private state: DurableState,
    private readonly warn: (error: unknown) => void,
  ) {}

  /** Load built-in packages and every persisted local version before serving the WebUI. */
  static async open(
    root: string,
    warn: (error: unknown) => void = () => {},
    builtinsRoot?: string,
  ): Promise<SkinLibrary> {
    await mkdir(root, { recursive: true })
    const library = new SkinLibrary(root, await readDurableState(root, warn), warn)
    if (builtinsRoot !== undefined) await library.loadBuiltins(builtinsRoot)
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !FINGERPRINT.test(entry.name)) continue
      try {
        const archive = await readStoredSkin(join(root, entry.name))
        if (archive.fingerprint !== entry.name) throw new TypeError(`stored skin ${entry.name} content fingerprint does not match its directory`)
        if (!library.skins.has(entry.name)) library.skins.set(entry.name, { archive, source: 'local' })
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
    const active = this.state.active === undefined ? undefined : this.skins.get(this.state.active)?.archive
    return Object.freeze({
      activationRevision: this.state.activationRevision,
      ...(active === undefined ? {} : {
        activeFingerprint: active.fingerprint,
        activeLayer: active.layer,
        ...(active.experience === undefined ? {} : { activeExperience: active.experience }),
      }),
      ...(this.state.previousConfirmed === undefined ? {} : { previousConfirmed: this.state.previousConfirmed }),
      skins: Object.freeze([...this.skins.values()]
        .map(skin => summary(skin.archive, skin.source))
        .sort((left, right) => left.source.localeCompare(right.source) || left.name.localeCompare(right.name))),
    })
  }

  /** Synchronous first-paint source registered with Harness Theme Boot. */
  activeBoot(): { activationRevision: number; contentFingerprint: string; layer: ThemeLayerDefinition } | undefined {
    const active = this.activeArchive()
    if (active === undefined) return undefined
    return {
      activationRevision: this.state.activationRevision,
      contentFingerprint: active.fingerprint,
      layer: active.layer,
    }
  }

  /** Active experience descriptor used to preload its same-origin bundle in index.html. */
  activeExperience(): SkinExperienceDescriptor | undefined {
    return this.activeArchive()?.experience
  }

  /** Validate and atomically add one content-addressed local .dshskin archive. */
  async import(archiveBytes: Uint8Array): Promise<StoredSkinSummary> {
    return this.mutate(async () => {
      const archive = parseSkinArchive(archiveBytes)
      const present = this.skins.get(archive.fingerprint)
      if (present !== undefined) return summary(present.archive, present.source)
      const destination = join(this.root, archive.fingerprint)
      try {
        await readFile(join(destination, 'manifest.json'))
        throw new Error(`skin directory ${archive.fingerprint} exists but was not accepted during startup`)
      } catch (error) {
        if (!isMissing(error)) throw error
      }
      const staging = await mkdtemp(join(this.root, '.import-'))
      try {
        for (const [name, bytes] of archive.files) {
          const target = join(staging, ...name.split('/'))
          await mkdir(dirname(target), { recursive: true })
          await writeFile(target, bytes, { flag: 'wx' })
        }
        await rename(staging, destination)
      } catch (error) {
        await rm(staging, { recursive: true, force: true })
        throw error
      }
      this.skins.set(archive.fingerprint, { archive, source: 'local' })
      this.publish()
      return summary(archive, 'local')
    })
  }

  /** Begin activation of a stored fingerprint, or of the Harness default when omitted. */
  prepare(fingerprint?: string): PrepareSkinResult {
    const skin = fingerprint === undefined ? undefined : this.requireSkin(fingerprint).archive
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
      ...(skin === undefined ? {} : {
        layer: skin.layer,
        ...(skin.experience === undefined ? {} : { experience: skin.experience }),
      }),
    }
  }

  /** Commit one live preparation and publish the durable activation revision. */
  async commit(preparationId: string): Promise<CommitSkinResult> {
    return this.mutate(async () => {
      this.expirePreparations()
      const prepared = this.preparations.get(preparationId)
      if (prepared === undefined) throw new TypeError('skin preparation is missing or expired')
      const skin = prepared.fingerprint === undefined ? undefined : this.requireSkin(prepared.fingerprint).archive
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
        ...(skin === undefined ? {} : {
          layer: skin.layer,
          ...(skin.experience === undefined ? {} : { experience: skin.experience }),
        }),
      }
    })
  }

  /** Cancel one preparation without changing the confirmed selection. */
  cancel(preparationId: string): void {
    if (!this.preparations.delete(preparationId)) throw new TypeError('skin preparation is missing or expired')
  }

  /** Delete one inactive, non-fallback local version. */
  async delete(fingerprint: string): Promise<void> {
    await this.mutate(async () => {
      const skin = this.requireSkin(fingerprint)
      if (skin.source === 'builtin') throw new TypeError('built-in skins cannot be deleted')
      if (this.state.active === fingerprint) throw new TypeError('the active skin cannot be deleted')
      if (this.state.previousConfirmed === fingerprint) throw new TypeError('the previous confirmed fallback cannot be deleted')
      await rm(join(this.root, fingerprint), { recursive: true })
      this.skins.delete(fingerprint)
      this.publish()
    })
  }

  /** Read a validated immutable image for the public asset route. */
  asset(fingerprint: string, filename: string): { bytes: Uint8Array; mimeType: string } {
    const skin = this.requireSkin(fingerprint).archive
    const path = `assets/${filename}`
    const declaration = skin.manifest.assets.find(asset => asset.path === path)
    const bytes = skin.files.get(path)
    if (declaration === undefined || bytes === undefined) throw new TypeError('skin asset does not exist')
    return { bytes, mimeType: declaration.mimeType }
  }

  /** Read a validated executable client bundle for the same-origin dynamic module route. */
  experience(fingerprint: string): { bytes: Uint8Array; descriptor: SkinExperienceDescriptor } {
    const skin = this.requireSkin(fingerprint).archive
    const descriptor = skin.experience
    const entry = skin.manifest.schemaVersion === 2 ? skin.manifest.experience?.entry : undefined
    const bytes = entry === undefined ? undefined : skin.files.get(entry)
    if (descriptor === undefined || bytes === undefined) throw new TypeError('skin experience does not exist')
    return { bytes, descriptor }
  }

  /** Read one validated layer for a read-only preview request. */
  layer(fingerprint: string): ThemeLayerDefinition {
    return this.requireSkin(fingerprint).archive.layer
  }

  private activeArchive(): ParsedSkinArchive | undefined {
    return this.state.active === undefined ? undefined : this.skins.get(this.state.active)?.archive
  }

  private requireSkin(fingerprint: string): InstalledSkin {
    if (!FINGERPRINT.test(fingerprint)) throw new TypeError('skin fingerprint must be lowercase SHA-256')
    const skin = this.skins.get(fingerprint)
    if (skin === undefined) throw new TypeError('skin fingerprint is not installed')
    return skin
  }

  private async loadBuiltins(root: string): Promise<void> {
    let entries
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch (error) {
      if (isMissing(error)) return
      throw error
    }
    for (const entry of entries) {
      if (!entry.isFile() || extname(entry.name).toLowerCase() !== '.dshskin') continue
      try {
        const archive = parseSkinArchive(await readFile(join(root, entry.name)))
        const collision = this.skins.get(archive.fingerprint)
        if (collision !== undefined) throw new TypeError(`duplicate built-in skin fingerprint ${archive.fingerprint}`)
        this.skins.set(archive.fingerprint, { archive, source: 'builtin' })
      } catch (error) {
        this.warn(new Error(`dsh-skin-plugin: rejected built-in skin ${entry.name}`, { cause: error }))
      }
    }
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

function summary(skin: ParsedSkinArchive, source: SkinSource): StoredSkinSummary {
  const manifest = skin.manifest
  return Object.freeze({
    fingerprint: skin.fingerprint,
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    capabilities: manifest.capabilities,
    source,
    ...(manifest.schemaVersion === 1 ? { tags: Object.freeze([]) } : {
      ...(manifest.author === undefined ? {} : { author: manifest.author }),
      ...(manifest.description === undefined ? {} : { description: manifest.description }),
      tags: manifest.tags ?? Object.freeze([]),
      ...(skin.preview === undefined ? {} : { preview: skin.preview }),
      ...(skin.experience === undefined ? {} : { experience: skin.experience }),
    }),
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
  try {
    entries['experience/client.js'] = await readFile(join(directory, 'experience', 'client.js'))
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
