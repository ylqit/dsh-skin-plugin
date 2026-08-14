# __THEME_NAME__

1. 将 Light/Dark 图片保存为 `assets/backdrop-light.webp` 与 `assets/backdrop-dark.webp`。
2. 编辑 `theme.json` 中的 Token、背景和 Part Styles。
3. 编辑 `experience/client.tsx` 与同目录 CSS Module；只导出 `skin.config.json` 已登记的 Placement。
4. 在插件目录执行 `pnpm skin:pack <此主题目录>`。

Experience 组件只接收 `themeId`、当前 `mode` 与不可变 `assets` URL 映射；它不会获得 Harness `ctx`、会话 Hook 或业务操作。
