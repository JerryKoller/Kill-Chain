# Kill Chain — Audio Playground (source)

**Kill Chain — a universal Windows audio engine for headphones, speakers, and home theater.**

Correction profiles for headphones, portable speakers, soundbars, and TVs; spatial processing for headphone and room layouts; full DSP, analysis, and restoration.

Windows desktop app (Electron + React + TypeScript + Web Audio + WebGL2).

## Quick start

```bash
npm install
npm run dev:electron
```

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev:electron` | Vite + Electron dev stack |
| `npm run build` | Production renderer + main build |
| `npm run dist` | Windows NSIS installer |
| `npm run typecheck` | TypeScript check |
| `npm run smoke` | Critical-path CDP smoke suite |

## Playback Correction

Fresh installs default to the **Neutral** output profile (flat correction). Compatibility curves for specific headphones, speakers, soundbars, and TVs live in `src/audio/headphoneProfiles.ts` and `src/audio/deviceProfiles.ts`. Brand names appear in profile labels only — not as product endorsements.

Global defaults: `src/audio/defaultCorrectionProfile.ts`. Per-model curves (e.g. Sony WH-1000XM6): `src/audio/profiles/`.

## Legal

- `LICENSE` — proprietary (not open source)
- `LEGAL/EULA.md`, `LEGAL/PRIVACY.md` — drafts for attorney review
- `THIRD_PARTY_NOTICES.md` — dependency inventory

Public distribution site and installer live on the `main` branch of [Kill-Chain](https://github.com/JerryKoller/Kill-Chain).
