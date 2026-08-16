import type { ThemePartId, VisualSlotId, VisualTemplateKind } from '../shared/contracts.ts'

export interface VisualSlotDefinition {
  part: ThemePartId
  label: string
  purpose: string
  templates: readonly VisualTemplateKind[]
  recommendedSize: string
}

/** Single semantic allowlist shared by Studio, controller validation and the renderer. */
export const VISUAL_SLOT_CATALOG: Readonly<Record<VisualSlotId, VisualSlotDefinition>> = Object.freeze({
  'sidebar.brand-mark': Object.freeze({
    part: 'shell.sidebar', label: '侧栏品牌装饰', purpose: '非交互品牌图形或紧凑品牌卡',
    templates: ['image-mark', 'compact-brand'] as const, recommendedSize: '160 × 160 px（标志）',
  }),
  'conversation.empty-mark': Object.freeze({
    part: 'conversation.root', label: '空状态装饰', purpose: '空会话中的主题图形或状态标签',
    templates: ['image-mark', 'status-chip'] as const, recommendedSize: '240 × 240 px',
  }),
  'conversation.composer-mark': Object.freeze({
    part: 'conversation.composer', label: '输入区装饰', purpose: '输入框内不承担操作含义的主题标志',
    templates: ['image-mark', 'status-chip'] as const, recommendedSize: '96 × 96 px',
  }),
  'tool.card-mark': Object.freeze({
    part: 'tool.card', label: '工具卡装饰', purpose: '工具卡右上角的非功能性主题标志',
    templates: ['image-mark', 'status-chip'] as const, recommendedSize: '96 × 96 px',
  }),
  'settings.section-mark': Object.freeze({
    part: 'settings.panel', label: '设置分区装饰', purpose: '设置分区内的非功能性主题标志',
    templates: ['image-mark', 'status-chip'] as const, recommendedSize: '96 × 96 px',
  }),
})

export const VISUAL_SLOT_BY_PART: Readonly<Partial<Record<ThemePartId, VisualSlotId>>> = Object.freeze(
  Object.fromEntries(Object.entries(VISUAL_SLOT_CATALOG).map(([slot, definition]) => [definition.part, slot])) as Partial<Record<ThemePartId, VisualSlotId>>,
)
