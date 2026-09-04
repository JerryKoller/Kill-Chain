---
{
  "id": "singularity-visual-overhaul",
  "title": "SINGULARITY visualizer — visual overhaul (first creative field mission)",
  "goal": "Make the SINGULARITY visualizer dramatically better looking while preserving its conceptual identity as a raymarched energy core in a turbulent void, its WebGL2 pipeline, its audio reactivity and the Kill Chain visual language. Form your own visual hypotheses by studying the strongest existing visualizers; do not wait to be told what to change.",
  "level": 2,
  "allowedPaths": [
    "src/components/Visualizer/singularity.ts"
  ],
  "readOnlyPaths": [
    "src/components/Visualizer/renderers.ts",
    "src/components/Visualizer/modeFactory.ts",
    "src/components/Visualizer/VisualizerOverlay.tsx",
    "src/components/Visualizer/visualIntel.ts",
    "src/components/Visualizer/director.ts",
    "src/components/Visualizer/lumaKey.ts",
    "src/state/visualizerStore.ts"
  ],
  "forbiddenPaths": [
    "src/audio/**",
    "src/state/**",
    "src/lib/sourceArbiter.ts",
    "electron/**",
    "package.json",
    "package-lock.json",
    "src/components/FireCommand/**",
    "src/components/Playground/**",
    "src/components/Visualizer/renderers.ts",
    "src/components/Visualizer/modeFactory.ts",
    "src/components/Visualizer/VisualizerOverlay.tsx",
    "src/components/Visualizer/visualIntel.ts"
  ],
  "acceptance": [
    "SINGULARITY still renders and is still selectable as a visualizer mode",
    "createSingularity(pal) is still exported and still satisfies the ModeRenderer contract",
    "The WebGL2 pipeline and its non-WebGL2 fallback both still exist",
    "Audio reactivity still comes from the shared VisualIntel snapshot; no new analyser is created",
    "The internal pixel budget (MAX_PIXELS) still caps internal resolution",
    "dispose() still releases GPU resources",
    "No AudioEngine, DSP, routing, source-ownership, Mission State or persistence change",
    "No other visualizer is modified",
    "No new third-party dependency",
    "npm run typecheck passes",
    "npm run build passes",
    "Frame rate does not fall below 70% of the measured baseline",
    "At least 4 genuine visual iterations were captured in the visual diary",
    "A human can open 00-baseline.png and final.png side by side and see a clear difference"
  ],
  "validation": {
    "required": ["typecheck", "build"],
    "optional": [],
    "restoreTsbuildinfo": true
  },
  "maxPhases": 12,
  "maxRetriesPerPhase": 3,
  "maxWallClockMs": 10800000,
  "maxModelCalls": 56,
  "sessionTimeoutMs": 900000,
  "proposalRounds": 1,
  "checkpointPolicy": "state-only",
  "commitPolicy": "none",
  "corpus": "if-stale",
  "diff": {
    "maxFiles": 1,
    "maxInsertions": 900,
    "warnOnly": true
  },
  "ux": {
    "workflow": "A user switches the visualizer to SINGULARITY and it should look like the best thing in the app, not the weakest.",
    "manualReview": "The aesthetic verdict belongs to the human. Deterministic checks (typecheck, build, guard, fps, vision screen) can only prove the candidate is not broken. They cannot prove it looks good."
  }
}
---

# SINGULARITY — visual overhaul

This is Robo Puppy's first creative field assignment. Every prior mission told
you exactly what to change. This one does not.

The human's assessment: **most Kill Chain visualizers look excellent.
SINGULARITY looks bad.** Your job is to work out why and fix it.

## What you own

One file: `src/components/Visualizer/singularity.ts`.

Everything inside it is yours — the GLSL shaders, the raymarch, the ring
system, the bloom chain, the composite pass, colour treatment, motion, depth
cues, density, how audio drives all of it, and any Singularity-local helper you
want to add inside that file.

You have real creative latitude here. Nobody has prescribed an aesthetic.

## What you must not break

Singularity is *a raymarched energy core in a turbulent void*, rendered on a
private WebGL2 canvas and blitted into the shared 2D canvas. That is its
identity. Change how it looks, not what it is.

A deterministic guard (`singularityGuard.mjs`) will reject any candidate that
loses:

- the `createSingularity(pal)` export or the `ModeRenderer` contract
  (`resize`, `draw`, `dispose`)
- the WebGL2 context request
- the non-WebGL2 fallback path
- audio reactivity via the shared `intel` snapshot
- the `MAX_PIXELS` internal resolution budget
- the scene shader stage or the composite shader stage
- more than half the file's lines

**If the guard rejects you, restore the missing behaviour. Do not delete more
code to make the error go away.** That has happened before and it is not a
repair.

## Out of scope — BLOCK rather than reach

AudioEngine, DSP, `claimSource`, `rewireFront`, Mission State, source
ownership, audio routing, persistence, Fire Command, every other visualizer,
`renderers.ts`, `modeFactory.ts`, `VisualizerOverlay.tsx`, `visualIntel.ts`,
`package.json`.

If a visual improvement genuinely requires one of these, **stop and BLOCK with
the reason**. Do not widen scope quietly. Wanting a new uniform is not a reason
to edit the overlay — everything you need is already on `RenderFrame`.

## Step 1 — study the references before you touch anything

Read these and work out what Kill Chain's visual language actually is:

| Renderer | Lines | Why it is worth studying |
|---|---|---|
| `createStrikeField` | 839 | the largest and most developed; also the default mode |
| `createWarpTunnel` | 337 | depth and forward motion |
| `createRadialReactor` | 290 | radial composition and band mapping |
| `createPulseLattice` | 210 | density and rhythmic structure |
| `createAuroraFlow` | 180 | colour blending and softness |

All in `src/components/Visualizer/renderers.ts` (read-only).

Look for: motion character, visual density, contrast handling, colour
discipline, depth cues, how hard they lean on the beat, and what they do when
audio is quiet.

Then answer, in your investigation, in your own words:

> **Why does SINGULARITY fail to meet the bar these set?**

One observation is offered free, because it is structural rather than
aesthetic: Singularity is the *only* WebGL renderer. Every other mode is 2D
canvas. Whether that helps or hurts it is your call to make — but it means it
did not evolve alongside the others, and it may simply not share their visual
vocabulary. Investigate; do not assume.

## Step 2 — the creative loop

Do not stop because the build passed. **Build success is necessary, not
sufficient.**

```
OBSERVE            capture the current frame
STUDY REFERENCES   read the strong renderers
HYPOTHESIS         one specific, stated visual change and why you expect it to help
EDIT               singularity.ts only
GUARD              singularityGuard must pass
TYPECHECK / BUILD  npm run typecheck && npm run build
CAPTURE            screenshot the mode
VISUAL REVIEW      local vision screen, then the human/Cursor verdict
DECIDE             KEEP | REVISE | REVERT | UNCERTAIN
CHECKPOINT         record the iteration in the diary
NEXT HYPOTHESIS
```

Target **5–10 genuine iterations**. Several should be rejected or reverted —
a run where everything is kept is a run that was not really experimenting.

If a hypothesis is rejected, revert to the last kept state before trying the
next one. Do not stack a new idea on top of a rejected one.

## Step 3 — the visual diary

This matters more to the human than the code does. Prior autonomous work was
invisible infrastructure; this time they want to *see* what you did.

Write to `tools/killchain-ai/data/missions/singularity-visual-overhaul/diary/`:

```
00-baseline.png
01-iteration.png
02-iteration.png
...
final.png
DIARY.md
```

One `DIARY.md` entry per iteration, in this shape:

```markdown
## 03 — tighten the accretion falloff

ITERATION:   03
HYPOTHESIS:  The core reads flat because the radial falloff is linear; an
             exponential falloff should give it volume against the void.
FILES:       src/components/Visualizer/singularity.ts
VALIDATION:  guard PASS · typecheck PASS · build PASS
PERFORMANCE: 58.4 fps (baseline 61.2, -4.6%)
VISUAL:      vision screen — visible YES, bright core YES, depth YES, detail HIGH
DECISION:    KEEP
NOTE:        Core now separates from the background. Rings still feel pasted on.
```

Keep the images; do not save redundant near-duplicates. One PNG per kept or
notable iteration is enough.

## Step 4 — capture and measurement

```
node tools/killchain-ai/src/cli.mjs puppy            # your own status card
```

### Read this first — capture is the one unsolved prerequisite

This was tested during mission preparation, not assumed. Two gates and one
hard blocker were found by capturing and then *looking at the picture*:

1. A legal modal (`Agree to continue`) covers the app. Seeded automatically.
2. The 7-step onboarding tour covers it too. Seeded automatically.
3. **The visualizer cannot be reached in the Vite web build at all.** The
   `▦ VISUALIZER` button (`.kc-vz-launch`) lives inside the Library view's
   controls block, and on the web build that whole block is replaced by a
   "Library needs the desktop app" empty state. The overlay's `open` flag is
   session-only by design, so it cannot be seeded around.

So there are exactly two ways to see Singularity, and **neither requires a
production change**:

**Route A — tooling-only harness (recommended, NOT BUILT YET).**
A small Vite entry under `tools/killchain-ai/` that imports `createSingularity`
from the production module and drives it on a bare canvas with a synthetic
`IntelSnapshot` (scripted bpm/beat/band values). Deterministic frames, no
audio, no gates, no desktop shell, and fast enough to iterate. **If you build
this, it is tooling-only — it must live under `tools/` and must not be
imported by the app.** Building it is in scope for this mission only if you
first propose it and the critic approves; otherwise use Route B.

**Route B — attach to the desktop shell (works today).**
```
npx cross-env NODE_ENV=development electron . --remote-debugging-port=9222
```
Load one track so the Library controls render, click `▦ VISUALIZER`, then:
```js
import { captureVisualizer, measureVisualizerFps } from "./tools/killchain-ai/src/ui/captureVisualizer.mjs";
await captureVisualizer({ mode: "singularity", outPath: "<diary>/03-iteration.png", attachPort: 9222 });
await measureVisualizerFps({ mode: "singularity" });
```
`attachPort` attaches to the running app and never closes it.

**If you cannot capture a frame, BLOCK.** Do not iterate blind and do not claim
a visual improvement you never saw. A diary with a baseline and no candidates
plus a clean BLOCK is an honest outcome; a diary of unverified claims is not.

### Audio reactivity caveat

Every renderer is driven by the shared VisualIntel snapshot. With nothing
playing, rms/low/mid/high/beat sit near zero and the frame shows the IDLE look.
That is fine for judging composition, colour and depth as long as baseline and
candidate are captured identically — but an idle frame proves nothing about
beat response, ring spawns or transient bloom. Say which you measured.

## Step 5 — who judges the pictures

Two different critics, and they are not interchangeable:

- **CODE CRITIC** — the normal critic gate. Evidence, scope, contract, no
  invented paths. Unchanged from every other mission.
- **VISUAL CRITIC** — looks at the actual pixels.

You do **not** have visual judgement. This was tested, not assumed: asked to
inspect a JPEG through your `read` tool you read the bytes and correctly
answered `CANNOT_SEE_IMAGES`. So never claim a screenshot looks good.

What exists instead:

1. A **local vision screen** (`visualCritic.mjs`) that the foreman runs by
   calling Ollama directly with the image. It answers mechanical questions —
   is the frame empty, is there a bright core, is it blown out, is there depth,
   how much detail. It is a safety net for "did the core vanish", not taste.
2. **Cursor / the supervisor** is the senior visual critic for this mission.
3. **The human** gives the final aesthetic verdict. Nothing overrides that.

State honestly in each diary entry which of these judged the frame.

## Validation

The runner runs `npm run typecheck` then `npm run build`. Do not claim either
passed unless the runner actually ran it. `npm run smoke` is available if you
believe a change could affect anything beyond the canvas — it should not, and
if you think it might, that is a signal you have left your scope.

## When to BLOCK

Block cleanly, with the reason, if:

- the improvement requires a forbidden path
- the guard keeps rejecting your candidates and you cannot satisfy it
- typecheck or build cannot be made to pass
- frame rate falls below 70% of baseline and you cannot recover it
- you run out of visual hypotheses that you can state and justify
- you cannot tell whether your change helped

A clean BLOCK with a diary showing four honest attempts is a good outcome.
Silently declaring victory because the build went green is not.
