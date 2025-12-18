# FF7 LGP Explorer

A simple web-based archive explorer for **Final Fantasy VII** PC LGP files. Browse, preview, extract, and modify game assets directly in your browser.

## Features

- **Browse Archives** — Navigate folder structures with a familiar file browser interface
- **Quick Look** — Press `Space` to preview files (hex viewer for binary, image preview for TEX textures)
- **Extract Files** — Download individual files or batch extract multiple selections
- **Modify Archives** — Replace existing files or insert new ones

## Live Demo

Open LGP Explorer in your browser: **[ff7-lgp-explorer](https://maciej-trebacz.github.io/ff7-lgp-explorer/)**

## Usage

1. Click **Open** or drag-and-drop an `.lgp` file
2. Browse the archive structure using the file list
3. Click a file to select it, `Ctrl+Click` for multi-select, `Shift+Click` for range select
4. Double-click or press `Space` to Quick Look the selected file
5. Use the toolbar to **Extract**, **Replace**, or **Insert** files
6. Click **Save** to download your modified archive

## Development

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Build for production
pnpm build
```

## Built With

- [React 19](https://react.dev/) — UI framework
- [Vite](https://vite.dev/) — Build tool
- [TanStack Virtual](https://tanstack.com/virtual) — Virtualized lists for large archives
- [binary-parser](https://github.com/nickelullu/node-binary-parser) — Binary format parsing

## Acknowledgements

- [FF7 Wiki authors](https://wiki.ffrtt.ru/index.php/FF7) - invaluable resource for learning about FF7 internals
- [KimeraCS](https://github.com/LaZar00/KimeraCS/tree/master) - 3d model previews were based on learnings from its code
- Ifalna - Ficedula's original tool for viewing FF7 models, LGP Explorer uses its model database for name/animations mapping
- ... and the whole Qhimm and FF7 community.

## License

MIT
