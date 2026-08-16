# dsh-skin-plugin

DeepSeek Harness `0.1.0-rc.5` 的安全声明式换肤插件。`0.4.0` 仅接受 `.dshskin` schema v4；v1、v2、v3 均直接拒绝且不会写入磁盘。

## 安装

```bash
pnpm add @ylq77147/dsh-skin-plugin@0.4.0
```

插件只使用 DSH 的公开 Host/Client 服务，不修改 DSH 源码。用户数据存放在独立的 `$DSH_HOME/skins-v4`，不会读取、迁移或删除旧版皮肤目录。

## v4 安全边界

- Theme Layer v2：受控 Token、背景和 Theme Parts v2 外观。
- Skin Visuals v1：受控组件表面图、装饰图标和固定模板。
- 固定模板：`image-mark`、`compact-brand`、`status-chip`。
- 安全槽位：侧栏品牌、会话空状态、输入区、工具卡和设置分区。
- 禁止 JavaScript、HTML、任意 CSS、外部 URL、布局修改与功能性图标替换。
- 不存在动态主题模块、固定顶栏/底栏或常驻悬浮挂件。

## 主题目录

```text
skin.config.json
theme.json
visuals.json
assets/
  backdrop-light.webp
  backdrop-dark.webp
  mark-light.webp
  mark-dark.webp
```

创建与打包：

```bash
pnpm build
pnpm skin:create my-theme
pnpm skin:pack ./my-theme ./my-theme.dshskin
```

CLI 在输出前使用同一个公开 v4 Parser 校验 ZIP 路径、大小、图片签名、哈希、协议、Part、视觉槽位和素材引用。

## 声明式视觉示例

```json
{
  "schemaVersion": 1,
  "items": [
    {
      "id": "partner-mark",
      "slot": "conversation.composer-mark",
      "template": "image-mark",
      "modes": {
        "light": {
          "assetUrl": "asset:assets/mark-light.webp",
          "fit": "contain",
          "positionX": 0.5,
          "positionY": 0.5
        },
        "dark": {
          "assetUrl": "asset:assets/mark-dark.webp",
          "fit": "contain",
          "positionX": 0.5,
          "positionY": 0.5
        }
      }
    }
  ]
}
```

## 内置主题

- 杰尼龟水舱 `3.0.0`：水舱背景、共享玻璃层与水系标志。
- 妙蛙种子生长舱 `3.0.0`：植物背景、共享玻璃层与紧凑品牌标志。
- 皮卡丘电能 `3.0.0`：电能背景、共享玻璃层与输入区状态标志。

三套主题使用完全相同的运行时与 Part 布局，只切换经过验证的 Token、背景、组件样式和声明式素材。

## 工作室

设置 → 外观主题提供：

- 大尺寸真实 DSH 导览图、可点击 Part 高亮区与“在当前页面定位”。
- 外观、图片与图标、状态三个编辑区。
- Light/Dark 缩略图、拖放替换、删除、cover/contain 与焦点位置。
- 固定小组件模板、局部效果对照、全页试穿、撤销/重做和恢复 DSH 默认。
- `插件 0.4.0 · 协议 v4` 版本握手；Host/Client 不一致时只读并提示重启。

## 开发验证

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm pack
```

`pnpm check` 包含类型检查、单元/集成测试、构建与公共接口门禁。
