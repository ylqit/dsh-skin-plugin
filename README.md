# DSH Skin Plugin

DeepSeek Harness WebUI 的同步组件换肤插件。一次主题切换同时发布 Light/Dark Token、背景、公共 Component Part 样式，以及挂载在专用主题 Slot 中的 React 装饰组件；它不替换会话、输入区、侧栏等业务组件逻辑，也不会把 Cordis `ctx`、会话 Hook 或业务操作交给主题组件。

## 兼容范围

插件需要包含以下合同的 DeepSeek Harness：`THEME_PARTS_VERSION = 1`、`ThemeRuntime.installSkin()`、六个 `skin.*` Slot，以及 `modules.loadDynamic()`。该包同时声明 `dsh.bundle` 与 `dsh.client`：Host 管理不可变主题库、首屏样式和本地管理 API，Browser 负责 Active/Preview 同步、动态 Experience 生命周期与主题工作室。

## 构建、安装与上传

```powershell
pnpm install
pnpm build
dsh plugin --profile web add D:\soft\AI\company-project\dsh-skin-plugin
dsh --profile web
```

启动后打开“设置 → 外观主题”：

1. 在“内置主题”中试穿皮卡丘、杰尼龟或妙蛙种子，或点击“导入 `.dshskin`”上传本地包。
2. Studio 先加载并校验 Light/Dark 图片、结构化 Part Styles 和完整 Experience Bundle；任一环节失败都会保留上一套有效主题。
3. 点击“编辑与试穿”进入 Preview，或点击“激活”执行 Host prepare/commit。
4. 刷新后 Host 在模块脚本之前注入 Active Token、背景与 Part CSS，并预加载 Active Experience；Browser 接管同一修订后挂载主题组件。

只有从 Host 本机访问的同源页面可以导入、编辑、删除或激活主题。远程客户端可呈现 Active Skin 并接收 SSE 修订通知，但管理请求返回 403。主题库位于 `$DSH_HOME/skins`；本地版本以内容指纹写入不可变目录，`state.json` 保存 `active`、`previousConfirmed` 与 `activationRevision`。内置主题从包内 `builtins/` 读取且不可删除。

## `.dshskin` v1 / v2

v1 继续支持安全数据皮肤：`manifest.json`、`theme.json` 和可选 `assets/*`，能力限于 Token、背景与 Part Styles。

v2 在同一 ZIP 中增加 Light/Dark 卡片封面与可选的 `experience/client.js`：

```json
{
  "schemaVersion": 2,
  "id": "example-skin",
  "name": "Example Skin",
  "version": "1.0.0",
  "themePartsVersion": 1,
  "capabilities": ["tokens", "backdrop", "component-parts", "component-experience"],
  "preview": {
    "light": "asset:assets/backdrop-light.webp",
    "dark": "asset:assets/backdrop-dark.webp"
  },
  "assets": [],
  "experience": {
    "apiVersion": 1,
    "moduleId": "dsh-skin:00000000-0000-4000-8000-000000000000",
    "entry": "experience/client.js",
    "sha256": "...",
    "bytes": 1,
    "placements": ["skin.shell.top"]
  }
}
```

Experience 组件只接收：

```ts
interface SkinExperienceComponentProps {
  themeId: string
  mode: 'light' | 'dark'
  assets: Readonly<Record<string, string>>
}
```

可用 Placement 为 `skin.shell.top`、`skin.shell.bottom`、`skin.shell.floating`、`skin.sidebar.brand`、`skin.conversation.hero` 与 `skin.composer.decorator`。Bundle 必须预编译为 Harness 的受管 CommonJS handoff；浏览器按 `moduleId + rev` 共享加载，在最后一个句柄释放时删除模块缓存和所属 CSS。

Host 对 v1/v2 都拒绝路径穿越、未登记文件、MIME/图片签名不符、哈希或字节数不符、压缩炸弹、外部字体与 Host/Node 代码。v2 Experience 会按用户选择直接在 WebUI 主页面执行，技术上能够访问 DOM、网络和浏览器全局对象；它不是安全沙箱，只应导入你信任的包。

## 创建高级主题

先构建插件，然后创建模板：

```powershell
pnpm skin:create my-theme
```

该命令在当前目录创建 `my-theme/`。编辑：

- `skin.config.json`：名称、版本、封面与 Placement；
- `theme.json`：Token、Light/Dark 背景和 Part Styles；
- `assets/backdrop-light.webp`、`assets/backdrop-dark.webp`：图片；
- `experience/client.tsx` 与 CSS Module：无业务能力的主题装饰组件。

打包命令会编译 TSX/CSS Modules、生成随机模块 ID、检查运行时 import、登记每个资源的 MIME/大小/SHA-256，并输出经过静态校验的 v2 包：

```powershell
pnpm skin:pack D:\path\to\my-theme
```

默认输出为 `<theme-directory>/dist/<id>-<version>.dshskin`。也可以直接运行 `dsh-skin pack <theme-directory> <output.dshskin>` 指定位置。Host 导入时仍会使用当前 Harness 的权威 Part Catalog 和主题编译器重新验证。

## 内置宝可梦演示主题

- 皮卡丘：黄色电属性 Token、能量顶栏、精灵球纹样、同步招式槽与闪电浮动徽章。
- 杰尼龟：蓝色水属性 Token、水舱背景、气泡浮层、水枪招式计量条。
- 妙蛙种子：绿色草/毒属性 Token、藤叶品牌区、搭档状态与藤鞭成长卡。

六张 Light/Dark 场景由图像生成工具创建，角色透明图来自 [PokeAPI sprites 的 official-artwork 目录](https://github.com/PokeAPI/sprites/tree/master/sprites/pokemon/other/official-artwork)。这些素材仅作为本地个人演示资源；Pokémon 角色、名称与相关商标归其权利人所有，公开或商业分发前需自行取得授权。你可直接用有授权的同名 WebP 替换 `themes/*/assets/` 后重新运行 `skin:pack`。

## 验证

```powershell
pnpm typecheck
pnpm test
pnpm build
```

聚合测试位于 `tests/skin-data-chain.spec.ts`，覆盖 v1/v2 归档、内置/本地库、两阶段激活、动态组件加载、回退和资源释放。联合工作区默认从 `reference/deepseek-harness` 读取本次 Harness 合同；独立检出时可设置 `DSH_HARNESS_ROOT`。
