# `ui/EditorTheme.h` / `EditorTheme.cpp`

Gives the whole application the dark editor look: the **Fusion** style (identical on every platform), a dark `QPalette` that matches the viewport's ImGui overlay, and a small stylesheet for docks, tabs, toolbars and the status bar.

## Colours (anonymous namespace)
`kWindow #2b2b2e` (panels and menus), `kBase #1e1e21` (list and edit backgrounds), `kAltBase #252528` (alternating rows), `kButton #353539`, `kText #dcdcdc`, `kDisabledText #7a7a7f`, and the accent `kAccent #3d8ee6` (selection and highlight). The stylesheet uses the same hex values, so the two must be kept in sync.

## Stylesheet highlights
- Dock separators turn the accent colour on hover.
- The selected tab has a 2 px accent top border.
- Checked tool buttons get a blue background, which shows the active gizmo tool.
- Named labels: `#PanelHint`, `#EmptyState` and `#SectionHeader` (bold).

## `void EditorTheme::Apply(QApplication& app)`
Call it once, right after the `QApplication` is created and before any window is built, so every widget picks up the palette. It:
1. Sets the style to `QStyleFactory::create("Fusion")`. Fusion respects the palette fully; the native Windows style does not.
2. Fills a `QPalette` with every colour role: window, base, text, button, highlight, link, tooltip and placeholder, with light, mid, dark and shadow shades derived from the base colours.
3. For the **Disabled** group, sets every text role to `kDisabledText` and the highlight to the button colour.
4. Calls `app.setPalette(palette)` and `app.setStyleSheet(kStyleSheet)`.
