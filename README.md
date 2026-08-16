# DSH Skin Plugin 0.3

面向 DeepSeek Harness `0.1.0-rc.5` WebUI 的独立换肤插件。它只通过 DSH 插件与 Web 客户端服务工作，不修改 DSH 源码，也不替换会话、输入区等业务组件的 React 逻辑。

本版本只接受 `.dshskin` schema v3、Theme Layer v2 与 Theme Parts v2。其他协议版本会在写盘前被拒绝，并保持当前主题和激活状态不变。

## 安装

```powershell
dsh plugin --profile web add @ylq77147/dsh-skin-plugin
dsh --profile web
```

插件必须安装到 DSH profile。启动后进入“设置 → 外观主题”，可以直接看到杰尼龟水舱、妙蛙种子生长舱和皮卡丘电能三个内置示例。

0.3 使用独立的 `$DSH_HOME/skins-v3` 目录。它不会读取、迁移或删除其他皮肤目录；首次启动保持 DSH 原始主题，直到用户主动激活皮肤。

## 外观主题页面

- 导入或导出 v3 `.dshskin`，管理不可变的本地皮肤版本。
- 编辑 Light/Dark Token、背景、组件 Variant、State 与安全视觉属性。
- 搜索 Shell、侧栏、会话、消息、输入区、基础控件、菜单、对话框、工具卡片和设置页面的 Part。
- 为受支持的组件表面设置包内 PNG、JPEG 或 WebP 素材。
- 使用局部预览或全页试穿；全页试穿始终显示独立的“退出全页试穿”按钮。
- “恢复 DSH 默认”通过删除对应 Part 规则实现，不隐藏或删除 DSH 组件。
- 撤销/重做、离开前未保存提示和修改摘要均在本地草稿中生效。

编辑内置示例会创建本地副本，内置归档始终只读。保存后由完整归档内容生成新的不可变 SHA-256 指纹。

## v3 皮肤包

归档只允许以下条目：

```text
manifest.json
theme.json
assets/<安全文件名>
experience/client.js   # 可选
```

最小清单示例：

```json
{
  "schemaVersion": 3,
  "id": "example-skin",
  "name": "Example Skin",
  "version": "2.0.0",
  "tags": [],
  "themePartsVersion": 2,
  "capabilities": ["tokens", "backdrop", "component-parts"],
  "assets": []
}
```

`theme.json` 必须使用 `schemaVersion: 2`。Part 规则只支持颜色、边框、圆角、结构化阴影、透明度、背景模糊、字体、间距、状态样式和受控包内背景素材；不接受任意 CSS、选择器、外部 URL、脚本 URL 或布局结构修改。

导入流程先在内存中完成 ZIP 路径、展开大小、压缩比、清单、哈希、图片签名、能力和 Part 属性校验，通过后才原子落盘。稳定错误码为：

- `UNSUPPORTED_PROTOCOL`：协议版本不受支持；
- `INVALID_ARCHIVE`：清单、Theme Layer 或 Part 数据无效；
- `INVALID_ASSET`：素材缺失、哈希、大小或图片签名错误；
- `SECURITY_LIMIT`：路径、URL、ZIP 展开或其他安全限制被触发。

有效 v3 皮肤不要求导入时当前页面已经出现所有 DOM 锚点。未出现的 Part 会暂时跳过，进入相应页面后再生效，编辑器会显示“当前页面暂无锚点”。

## Experience 装饰组件

Experience 只能为插件自己的挂件与浮层提供 React 组件。可用 Placement：

- `skin.shell.top`
- `skin.shell.bottom`
- `skin.shell.floating`
- `skin.sidebar.brand`
- `skin.conversation.hero`
- `skin.composer.decorator`

组件 props：

```ts
interface SkinExperienceComponentProps {
  themeId: string
  mode: 'light' | 'dark'
  assets: Readonly<Record<string, string>>
}
```

Bundle 只能依赖 DSH 提供的 React 运行时。插件会校验导出组件只能使用清单声明的 Placement，并在切换、停用或卸载时撤销挂件、模块记录和归属样式。Experience 在 WebUI 中执行，不是安全沙箱，只导入可信归档。

## 创建与打包

```powershell
pnpm install
pnpm build
pnpm skin:create my-theme
pnpm skin:pack my-theme
```

模板和 CLI 只生成 v3。默认输出位于 `<主题目录>/dist/<id>-<version>.dshskin`。三个内置示例的源码位于 `themes/`，归档位于 `builtins/`；两者都通过相同的公开 v3 Parser 验证，没有示例专用路径。

## 开发与发布验收

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm check
pnpm pack
```

发布包必须包含 `lib/`、`builtins/`、`templates/`、`cordis.patch.yml` 与本说明，并能从 tarball 安装到干净的目标 DSH profile。三个内置归档不依赖源码目录。

## 卸载

```powershell
dsh plugin --profile web remove @ylq77147/dsh-skin-plugin
```

卸载插件不会删除 `$DSH_HOME/skins-v3`，以避免不可恢复的数据丢失；需要清理时由用户明确手动处理。
