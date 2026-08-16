import type { ComponentType } from 'react'
import type { SkinExperienceDescriptor, SkinPlacement } from '../shared/contracts.ts'

export interface SkinExperienceComponentProps {
  themeId: string
  mode: 'light' | 'dark'
  assets: Readonly<Record<string, string>>
}

export interface ActiveSkinExperience {
  descriptor: SkinExperienceDescriptor
  themeId: string
  skinId: string | undefined
  mode: 'light' | 'dark'
  components: Readonly<Partial<Record<SkinPlacement, ComponentType<SkinExperienceComponentProps>>>>
}

export interface ClientModuleService {
  version: 'client'
  import(specifier: string, parentURL?: string, attrs?: Record<string, unknown>): Promise<unknown>
  invalidate(id: string): void
}

type BundleLoader = (descriptor: SkinExperienceDescriptor) => Promise<void>

/** Owns the load, validation, switching and teardown boundary for skin-only React decorations. */
export class SkinExperienceRuntime {
  private readonly listeners = new Set<() => void>()
  private snapshotValue: ActiveSkinExperience | undefined
  private generation = 0
  private mode: 'light' | 'dark' = 'light'

  constructor(
    private readonly modules: ClientModuleService,
    private readonly loadBundle: BundleLoader = loadExperienceBundle,
  ) {}

  getSnapshot = (): ActiveSkinExperience | undefined => this.snapshotValue

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async install(descriptor: SkinExperienceDescriptor, themeId: string, skinId?: string): Promise<void> {
    const current = this.snapshotValue
    if (current?.descriptor.moduleId === descriptor.moduleId && current.descriptor.rev === descriptor.rev) {
      this.publish({ ...current, descriptor, themeId, skinId })
      return
    }

    const generation = ++this.generation
    if (current?.descriptor.moduleId === descriptor.moduleId) {
      this.cleanupModule(current.descriptor.moduleId)
      this.publish(undefined)
    }
    try {
      await this.loadBundle(descriptor)
      const components = validateExperienceExports(
        await this.modules.import(descriptor.moduleId, window.location.href, {}),
        descriptor,
      )
      if (generation !== this.generation) {
        if (this.snapshotValue?.descriptor.moduleId !== descriptor.moduleId) this.cleanupModule(descriptor.moduleId)
        return
      }
      const previous = this.snapshotValue
      this.publish({
        descriptor,
        themeId,
        skinId,
        mode: this.mode,
        components,
      })
      if (previous !== undefined && previous.descriptor.moduleId !== descriptor.moduleId) {
        this.cleanupModule(previous.descriptor.moduleId)
      }
    } catch (error) {
      if (this.snapshotValue?.descriptor.moduleId !== descriptor.moduleId) this.cleanupModule(descriptor.moduleId)
      throw error
    }
  }

  setMode(mode: 'light' | 'dark'): void {
    this.mode = mode
    if (this.snapshotValue === undefined || this.snapshotValue.mode === mode) return
    this.publish({ ...this.snapshotValue, mode })
  }

  clear(): void {
    this.generation += 1
    const current = this.snapshotValue
    this.publish(undefined)
    if (current !== undefined) this.cleanupModule(current.descriptor.moduleId)
  }

  private cleanupModule(moduleId: string): void {
    this.modules.invalidate(moduleId)
    for (const style of document.querySelectorAll('style[data-plugin]')) {
      if (style.getAttribute('data-plugin') === moduleId) style.remove()
    }
  }

  private publish(value: ActiveSkinExperience | undefined): void {
    this.snapshotValue = value
    for (const listener of [...this.listeners]) listener()
  }
}

async function loadExperienceBundle(descriptor: SkinExperienceDescriptor): Promise<void> {
  if (!/^\/api\/dsh-skin\/experience\/[a-f0-9]{64}\/client\.js$/u.test(descriptor.url)) {
    throw new TypeError('Experience bundle URL is not managed by dsh-skin-plugin')
  }
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.async = true
    script.src = `${descriptor.url}?rev=${encodeURIComponent(descriptor.rev)}`
    script.addEventListener('load', () => { script.remove(); resolve() }, { once: true })
    script.addEventListener('error', () => {
      script.remove()
      reject(new TypeError(`Experience bundle failed to load: ${descriptor.moduleId}`))
    }, { once: true })
    document.head.append(script)
  })
}

function validateExperienceExports(
  moduleExports: unknown,
  descriptor: SkinExperienceDescriptor,
): Readonly<Partial<Record<SkinPlacement, ComponentType<SkinExperienceComponentProps>>>> {
  const value = object(moduleExports, 'Experience module exports')
  if (value.apiVersion !== 1) throw new TypeError('Experience module exports apiVersion must be 1')
  const source = object(value.components, 'Experience components')
  const declared = new Set<string>(descriptor.placements)
  const components: Partial<Record<SkinPlacement, ComponentType<SkinExperienceComponentProps>>> = {}
  for (const [placement, component] of Object.entries(source)) {
    if (!declared.has(placement)) throw new TypeError(`Experience component uses undeclared placement ${JSON.stringify(placement)}`)
    if (typeof component !== 'function') throw new TypeError(`Experience component ${JSON.stringify(placement)} must be a React component`)
    components[placement as SkinPlacement] = component as ComponentType<SkinExperienceComponentProps>
  }
  for (const placement of descriptor.placements) {
    if (components[placement] === undefined) throw new TypeError(`Experience is missing declared placement ${JSON.stringify(placement)}`)
  }
  return Object.freeze(components)
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`)
  return value as Record<string, unknown>
}
