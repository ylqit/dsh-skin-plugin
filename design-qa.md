# Design QA — dsh-skin-plugin 0.4.0

## Capture conditions

- Browser viewport: 1432 × 768 CSS px.
- Implementation screenshots: 1432 × 768 pixels at device scale factor 1.
- User references: 2864 × 1536 pixels, normalized to 1432 × 768 for the paired comparison.
- Shared state: current DSH empty conversation, expanded sidebar, Light mode, no user data.
- Studio state: Appearance settings open, 800 × 720 settings dialog, Pikachu draft, `conversation.composer`, “图片与图标”.

## Paired comparisons

| Surface | User reference | Implementation | Combined comparison |
| --- | --- | --- | --- |
| Pikachu home | `C:\Users\wwwab\AppData\Local\Temp\codex-clipboard-50b84b95-e23f-40c2-bd94-1451b75ac6b5.png` | `C:\Users\wwwab\.codex\visualizations\2026\08\16\01a009d8-4e26-7e31-b4b4-72a68d9c7242\v4-qa\pikachu-light-final-v2.png` | `C:\Users\wwwab\.codex\visualizations\2026\08\16\01a009d8-4e26-7e31-b4b4-72a68d9c7242\v4-qa\compare-pikachu.png` |
| Squirtle home | `C:\Users\wwwab\AppData\Local\Temp\codex-clipboard-da364e07-fc21-477e-9b66-17adc2df0602.png` | `C:\Users\wwwab\.codex\visualizations\2026\08\16\01a009d8-4e26-7e31-b4b4-72a68d9c7242\v4-qa\squirtle-light-final-v2.png` | `C:\Users\wwwab\.codex\visualizations\2026\08\16\01a009d8-4e26-7e31-b4b4-72a68d9c7242\v4-qa\compare-squirtle.png` |
| Component Studio | `C:\Users\wwwab\AppData\Local\Temp\codex-clipboard-3ed43464-b54f-477e-9551-ac462b1cb5b5.png` | `C:\Users\wwwab\.codex\visualizations\2026\08\16\01a009d8-4e26-7e31-b4b4-72a68d9c7242\v4-qa\studio-editor-final-v2.png` | `C:\Users\wwwab\.codex\visualizations\2026\08\16\01a009d8-4e26-7e31-b4b4-72a68d9c7242\v4-qa\compare-studio.png` |

## Inspection history

1. Removed the oversized opaque conversation seat that hid theme backgrounds.
2. Removed top, bottom and fixed floating theme placements; replaced them with safe declarative semantic slots.
3. Removed the sidebar containing-block effects that constrained the fixed DSH settings dialog.
4. Hid sidebar decoration in the collapsed rail, preserving the original open and settings controls.
5. Repositioned the Pikachu status chip into the composer’s unused center area without covering model or access controls.
6. Ensured Studio previews never steal the live page visual target.
7. Verified Light/Dark, expanded/collapsed sidebar, current-page locate, rapid three-theme switching and one-slot cleanup.
8. Compared each final implementation and its user reference in a single paired image; no remaining P0, P1 or P2 visual defects were observed.

## Result

passed
