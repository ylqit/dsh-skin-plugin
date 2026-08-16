import type { ThemePartId } from './contracts.ts'

export const PART_GUIDE_FILENAMES = Object.freeze([
  'shell.webp',
  'menu.webp',
  'dialog.webp',
  'settings.webp',
] as const)

export type PartGuideFilename = typeof PART_GUIDE_FILENAMES[number]
export type PartGuideGroup = '框架' | '会话' | '基础控件' | '菜单与弹窗' | '工具' | '设置'

export interface PartGuideEntry {
  readonly label: string
  readonly group: PartGuideGroup
  readonly purpose: string
  readonly filename: PartGuideFilename
  readonly highlight: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }
}

/** Internal current-DSH visual guide metadata; deliberately absent from the public package exports. */
export const THEME_PART_GUIDES = Object.freeze({
  'app.root': {
    label: '应用画布', group: '框架', purpose: '整个 DSH WebUI 的基础表面与前景。', filename: 'shell.webp',
    highlight: { x: 0, y: 0, width: 1, height: 1 },
  },
  'shell.backdrop': {
    label: '应用背景', group: '框架', purpose: '位于侧栏和会话内容下方的全局背景层。', filename: 'shell.webp',
    highlight: { x: 0.22, y: 0, width: 0.78, height: 1 },
  },
  'shell.sidebar': {
    label: '侧栏', group: '框架', purpose: '工作区、会话入口和设置入口所在的左侧导航。', filename: 'shell.webp',
    highlight: { x: 0, y: 0, width: 0.22, height: 1 },
  },
  'shell.main': {
    label: '主内容区', group: '框架', purpose: '承载会话、编辑器和其他主要页面的内容区域。', filename: 'shell.webp',
    highlight: { x: 0.22, y: 0, width: 0.78, height: 1 },
  },
  'shell.details': {
    label: '详情侧栏', group: '框架', purpose: '任务详情或辅助信息出现时使用的右侧面板。', filename: 'shell.webp',
    highlight: { x: 0.78, y: 0.08, width: 0.2, height: 0.84 },
  },
  'conversation.root': {
    label: '会话区域', group: '会话', purpose: '一次会话的标题、消息和输入区整体表面。', filename: 'shell.webp',
    highlight: { x: 0.28, y: 0.24, width: 0.68, height: 0.52 },
  },
  'conversation.header': {
    label: '会话标题', group: '会话', purpose: '会话顶部的标题、状态和辅助操作区域。', filename: 'shell.webp',
    highlight: { x: 0.48, y: 0.31, width: 0.24, height: 0.09 },
  },
  'conversation.scroller': {
    label: '消息滚动区', group: '会话', purpose: '会话消息与工具执行结果的纵向滚动容器。', filename: 'shell.webp',
    highlight: { x: 0.3, y: 0.2, width: 0.64, height: 0.43 },
  },
  'conversation.message': {
    label: '消息气泡', group: '会话', purpose: '用户、助手和系统提示的单条消息外层。', filename: 'shell.webp',
    highlight: { x: 0.42, y: 0.38, width: 0.46, height: 0.14 },
  },
  'conversation.message-content': {
    label: '消息内容', group: '会话', purpose: '消息气泡中的正文、Markdown 和代码内容。', filename: 'shell.webp',
    highlight: { x: 0.45, y: 0.4, width: 0.4, height: 0.1 },
  },
  'conversation.composer': {
    label: '输入框', group: '会话', purpose: '输入提示词、添加附件和发送消息的主要输入区域。', filename: 'shell.webp',
    highlight: { x: 0.3, y: 0.46, width: 0.61, height: 0.17 },
  },
  'conversation.composer-toolbar': {
    label: '输入工具栏', group: '会话', purpose: '输入框内的工作区、模式、模型和发送操作。', filename: 'shell.webp',
    highlight: { x: 0.3, y: 0.41, width: 0.61, height: 0.21 },
  },
  'primitive.button': {
    label: '按钮', group: '基础控件', purpose: '新会话、确认、发送等通用按钮。', filename: 'shell.webp',
    highlight: { x: 0.01, y: 0.1, width: 0.2, height: 0.06 },
  },
  'primitive.input': {
    label: '输入容器', group: '基础控件', purpose: '文本框、选择器等输入控件的外层表面。', filename: 'shell.webp',
    highlight: { x: 0.3, y: 0.46, width: 0.61, height: 0.17 },
  },
  'primitive.input-control': {
    label: '输入控件', group: '基础控件', purpose: '输入容器内部可编辑或可选择的实际控件。', filename: 'shell.webp',
    highlight: { x: 0.31, y: 0.48, width: 0.59, height: 0.11 },
  },
  'primitive.dialog-mask': {
    label: '对话框遮罩', group: '菜单与弹窗', purpose: '对话框打开时覆盖页面的半透明背景。', filename: 'dialog.webp',
    highlight: { x: 0, y: 0, width: 1, height: 1 },
  },
  'primitive.dialog-surface': {
    label: '对话框面板', group: '菜单与弹窗', purpose: '声明、确认和其他模态内容的面板表面。', filename: 'dialog.webp',
    highlight: { x: 0.26, y: 0.29, width: 0.48, height: 0.42 },
  },
  'primitive.menu-surface': {
    label: '菜单面板', group: '菜单与弹窗', purpose: '模式、模型和操作菜单展开后的浮层表面。', filename: 'menu.webp',
    highlight: { x: 0.4, y: 0.14, width: 0.27, height: 0.41 },
  },
  'primitive.menu-item': {
    label: '菜单项', group: '菜单与弹窗', purpose: '菜单中可选择、悬停和禁用的单项内容。', filename: 'menu.webp',
    highlight: { x: 0.41, y: 0.16, width: 0.24, height: 0.12 },
  },
  'primitive.tooltip': {
    label: '工具提示', group: '菜单与弹窗', purpose: '图标按钮和紧凑控件的悬停说明。', filename: 'menu.webp',
    highlight: { x: 0.4, y: 0, width: 0.12, height: 0.08 },
  },
  'tool.card': {
    label: '工具卡片', group: '工具', purpose: '工具调用的运行、成功和失败状态容器。', filename: 'shell.webp',
    highlight: { x: 0.4, y: 0.34, width: 0.46, height: 0.18 },
  },
  'settings.panel': {
    label: '设置面板', group: '设置', purpose: '设置窗口的导航与内容主面板。', filename: 'settings.webp',
    highlight: { x: 0.18, y: 0.03, width: 0.64, height: 0.93 },
  },
  'settings.row': {
    label: '设置项', group: '设置', purpose: '设置页面中的单行选项、说明与当前值。', filename: 'settings.webp',
    highlight: { x: 0.35, y: 0.12, width: 0.45, height: 0.1 },
  },
} as const satisfies Readonly<Record<ThemePartId, PartGuideEntry>>)
