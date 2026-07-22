# Third-Party Notices

Kill Chain includes open-source and third-party software. This file is a
**working inventory** — run a full license audit before commercial release.

## Runtime and framework

| Component | License | Notes |
|-----------|---------|-------|
| [Electron](https://www.electronjs.org/) | MIT | Desktop shell |
| Chromium (via Electron) | BSD-style | Rendering engine |
| [React](https://react.dev/) | MIT | UI |
| [Vite](https://vitejs.dev/) | MIT | Build tool (dev) |
| [Zustand](https://github.com/pmndrs/zustand) | MIT | State |
| [Framer Motion](https://www.framer.com/motion/) | MIT | UI motion |
| [Tailwind CSS](https://tailwindcss.com/) | MIT | Styling |
| [music-metadata](https://github.com/Borewit/music-metadata) | MIT | Library tags |
| [@breezystack/lamejs](https://github.com/breezystack/lamejs) | LGPL-3.0 | MP3 encode — verify LGPL compliance for distribution |

## Fonts

UI fonts may be loaded from Google Fonts in the GitHub Pages download site only.
The packaged Electron app uses system fonts unless otherwise noted.

## Compatibility profiles

Frequency-response profiles reference publicly known device names for user
convenience. Trademark owners are not affiliated with Kill Chain.

## Generating a complete notice file

Before shipping commercially, run a dependency license scan (e.g.
`npx license-checker --production`) and merge results with Electron's
`LICENSE` files from the built `release/win-unpacked` tree.
