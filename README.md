# DSH Skin Plugin

DeepSeek Harness WebUI 的换肤插件。通过导入 `.dshskin` 主题包，一次切换 Light/Dark 配色、背景与组件样式，并提供内置主题库与可视化的主题工作室。插件不修改会话、输入区等业务组件的逻辑。

## 快速开始

```powershell
pnpm install
pnpm build
dsh plugin --profile web add <插件目录>
dsh --profile web
```

启动后打开“设置 → 外观主题”：

1. 在“内置主题”中试穿皮卡丘、杰尼龟或妙蛙种子，或点击“导入 `.dshskin`”上传本地主题包。
2. 主题工作室会校验主题包中的图片与样式数据；校验失败时保留上一套有效主题。
3. 点击“编辑与试穿”进入预览，或点击“激活”应用主题。
4. 刷新页面后主题继续生效。

主题的导入、编辑、删除与激活仅对从 Host 本机访问的同源页面开放，远程客户端只显示已激活的主题。主题库存放在 `$DSH_HOME/skins`；内置主题来自包内 `builtins/` 目录，不可删除。

## 皮肤包格式（`.dshskin`）

v1 主题包包含 `manifest.json`、`theme.json` 与可选的 `assets/*`，支持配色、背景与组件样式。v2 在同一包中增加 Light/Dark 封面图与可选的 Experience 组件：

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

Experience 组件接收以下 props：

```ts
interface SkinExperienceComponentProps {
  themeId: string
  mode: 'light' | 'dark'
  assets: Readonly<Record<string, string>>
}
```

可用的 Placement 为 `skin.shell.top`、`skin.shell.bottom`、`skin.shell.floating`、`skin.sidebar.brand`、`skin.conversation.hero` 与 `skin.composer.decorator`。

导入时插件会校验文件完整性与图片签名，拒绝路径穿越、哈希不符、压缩炸弹等非法内容。Experience 组件直接在 WebUI 页面中执行，不是沙箱，请只导入你信任的包。

## 创建主题

```powershell
pnpm skin:create my-theme
```

该命令在当前目录创建 `my-theme/` 模板，需要编辑的文件：

- `skin.config.json`：名称、版本、封面与 Placement；
- `theme.json`：配色、Light/Dark 背景与组件样式；
- `assets/backdrop-light.webp`、`assets/backdrop-dark.webp`：背景图片；
- `experience/client.tsx` 与 CSS Module：主题装饰组件。

打包命令会编译主题源码并生成经过校验的 v2 主题包：

```powershell
pnpm skin:pack <主题目录>
```

默认输出为 `<主题目录>/dist/<id>-<version>.dshskin`，也可以用 `dsh-skin pack <主题目录> <输出.dshskin>` 指定输出位置。

## 内置演示主题

内置皮卡丘（电）、杰尼龟（水）、妙蛙种子（草/毒）三个主题，各自包含对应属性的配色、背景与装饰组件。

Light/Dark 场景图由图像生成工具创建，角色透明图来自 [PokeAPI sprites 的 official-artwork 目录](https://github.com/PokeAPI/sprites/tree/master/sprites/pokemon/other/official-artwork)。这些素材仅作为本地个人演示资源；Pokémon 角色、名称与相关商标归其权利人所有，公开或商业分发前需自行取得授权。你可以用有授权的图像替换 `themes/*/assets/` 后重新运行 `skin:pack`。

## 开发与验证

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm check    # typecheck + test + build + 合同校验脚本（scripts/check-contract.mjs）
```

测试位于 `tests/` 目录，覆盖主题包导入、激活、回退、首屏注入与组件样式打标等链路。
