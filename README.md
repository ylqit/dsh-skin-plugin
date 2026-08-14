# DSH Skin Plugin

DeepSeek Harness WebUI 的同步组件换肤插件。一个皮肤会在同一呈现修订中切换 Light/Dark 语义 Token、背景和已登记核心组件的外观状态；它不替换 React 组件、DOM 结构、业务行为或可访问性语义。

## 兼容范围

本插件需要包含同步皮肤合同的 DeepSeek Harness：`THEME_PARTS_VERSION = 1`、`ThemeRuntime.installSkin()`、`registerThemeBootSource()` 和公共 Component Part 属性必须同时存在。它是一个树外 npm 包，并在同一个 `package.json` 中声明 `dsh.bundle` 与 `dsh.client`；Host 负责持久化与管理 API，Browser 插件负责 Active Skin 同步和主题工作室。

## 构建与安装

```powershell
pnpm install
pnpm build
dsh plugin --profile web add D:\soft\AI\company-project\dsh-skin-plugin
```

源码开发时也可以把最后一个参数换成本工作树路径。构建产物是 `lib/index.js` 与 `lib/client.js`。安装后在 WebUI 的“设置 → 外观主题”打开主题工作室。

主题库位于 `$DSH_HOME/skins`。每次导入按内容指纹写入不可变目录；`state.json` 记录 `active`、`previousConfirmed` 与 `activationRevision`。激活使用 prepare/commit 两阶段：浏览器先安装完整 Preview，Host 确认持久化 Active 后，浏览器观察并安装同一 Active Revision，最后才卸载 Preview。

只有从 Host 本机访问的同源页面可以导入、编辑、删除或激活主题。远程客户端可读取并呈现 Active Skin，也会通过 SSE 收到修订通知，但管理请求返回 403。

## `.dshskin` 格式

`.dshskin` 是受限 ZIP 容器，必须包含 `manifest.json` 与 `theme.json`。例如：

```json
{
  "schemaVersion": 1,
  "tokens": {
    "--dsw-alias-brand-primary": {
      "light": "#315efb",
      "dark": "#7c9cff"
    }
  },
  "backdrop": {
    "light": {
      "fallbackColor": "#f4f7fb",
      "focusX": 0.5,
      "focusY": 0.5,
      "dim": 0.12,
      "blurPx": 0
    },
    "dark": {
      "fallbackColor": "#0b1020",
      "focusX": 0.5,
      "focusY": 0.5,
      "dim": 0.28,
      "blurPx": 0
    }
  },
  "partStyles": [
    {
      "part": "primitive.button",
      "variant": "primary",
      "state": "hover",
      "style": {
        "light": { "background": "#244edb", "borderRadiusPx": 14 },
        "dark": { "background": "#9ab0ff", "borderRadiusPx": 14 }
      }
    }
  ]
}
```

对应的 `manifest.json` 必须声明 `schemaVersion: 1`、`themePartsVersion: 1`、实际使用的 `capabilities`，并为每个 PNG/JPEG/WebP 背景资源登记路径、MIME、字节数和 SHA-256。持久化主题只用 `asset:assets/<name>` 引用资源；Host 验证后才改写为不可变同源 URL。

容器不接受 `theme.css`、JavaScript、React Bundle、自定义字体、任意选择器、CSS 变量定义、URL、`!important` 或改变布局/交互语义的属性。Host 会拒绝路径穿越、重复或伪造资源、哈希不符、非法图片签名、超限条目和压缩炸弹。Host 与 Client 都使用 Harness 的同一份 Part Catalog、验证器和 CSS 编译器。

## 主题工作室

工作室支持：

- Light/Dark Token、背景焦点/暗化/模糊与图片编辑；
- 按 Part、Variant、State 编辑允许的结构化组件字段；
- 使用真实 Button、Input、Dialog、Menu 等 Primitives 预览；
- 在当前 Shell、Conversation、Message、Composer、Tool Card 与 Settings 页面实时试穿；
- 导入、保存、导出、Preview、激活、恢复默认和删除。

每次编辑都会生成一份完整 Draft Layer。校验或图片解码失败时，页面保留最后一份有效 Preview，不执行部分 DOM 写入。

## 开发验证

```powershell
pnpm typecheck
pnpm test
pnpm build
```

测试集中在少量聚合文件中，覆盖安全归档、不可变主题库、两阶段激活、回退，以及 Host 状态到 Browser `installSkin()` 的数据链。在独立检出本插件时，可把 `DSH_HARNESS_ROOT` 指向包含同步皮肤合同的 Harness 源码；当前联合工作区会自动发现 `reference/deepseek-harness`。


