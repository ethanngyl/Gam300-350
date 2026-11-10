# Application icon

The engine's icon is the GENESIS logo (the same logo as the web app,
`packages/src/web-app/GenesisLogo.svg`) in white on the web app's
violet-to-cyan gradient tile.

| File | Used for |
| --- | --- |
| `genesis-app-icon.svg` | Source. Edit this one. |
| `genesis.ico` | Windows exe icon via `../genesis.rc` (Explorer, taskbar, shortcuts, Add/Remove Programs) and the NSIS installer / uninstaller (`CPACK_NSIS_MUI_ICON`). Holds 16, 20, 24, 32, 40, 48, 64, 128 and 256 px. |
| `png/genesis-<size>.png` | Qt window icon (title bar, Alt+Tab, Linux / macOS), compiled in under `:/icons` by `qt_add_resources` and set in `src/main.cpp`. |

The logo's thin lines disappear at small sizes, so the 16-24 px images use
a stroke width of 7 and the 32-48 px images 5 (the SVG's own value is 3).

## Regenerating after editing the SVG

Render each size to PNG with any SVG rasterizer, applying the stroke widths
above, then pack the sizes listed in the table into `genesis.ico`. For example,
with ImageMagick:

```sh
magick -background none genesis-app-icon.svg -resize 256x256 png/genesis-256.png
magick png/genesis-16.png png/genesis-24.png png/genesis-32.png \
       png/genesis-48.png png/genesis-64.png png/genesis-128.png \
       png/genesis-256.png genesis.ico
```

Then rebuild the engine. Windows caches exe icons, so Explorer may keep
showing the old one until the icon cache refreshes (sign out and back in,
or run `ie4uinit.exe -show`).
