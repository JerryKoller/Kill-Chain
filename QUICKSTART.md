# Quick Start Guide — New Features

## How to See What Was Added

### 1. Start the Development Server
```bash
cd audio-playground
npm run dev
```
Then open http://localhost:5173 in your browser. Click anywhere to initialize the audio context.

### 2. Load an Audio File
- Open the Transport Bar at the bottom
- Click the file icon to select an audio file to process
- Start playback

### 3. Explore Each New Feature

#### **Advanced Metering** (Real-time Dashboard)
📍 **Location:** Playground view, right side below the macro buttons
- Shows 3 horizontal meters: RMS, Peak, Peak Hold
- Watch them react as your music plays
- Bottom line shows: Spectral Centroid frequency, Spread, and Crest Factor

**What to look for:**
- RMS moves with overall volume
- Peak jumps during transients (drums, guitar attack)
- Spectral Centroid shifts when you boost/cut high frequencies

#### **EQ Response Curve** (Frequency Response Visualization)
📍 **Location:** Playground view, below the EQ canvas on the left
- Shows a glowing cyan curve
- Grid background with frequency decades (20Hz, 50Hz, 100Hz, etc.)
- dB markers on the left (-12 to +12 dB)

**What to try:**
1. Drag the "Bass" knob (leftmost tone knob) to the right
   → Curve jumps up on the left side (low frequencies)
2. Drag the "Air" knob (second from right) to the left
   → Curve dips on the right side (high frequencies)
3. Watch the curve update in real-time as you drag

**How it works:**
The curve mathematically computes how each EQ band filters the signal. It's not guessing—it's calculating the actual transfer function of your biquad filters.

#### **Snapshot Comparator** (A/B Testing Tool)
📍 **Location:** Sidebar, click the ⬚ icon labeled "Snapshots"

**Workflow:**
1. Type a name: "Bright Mix" or "Warm Version"
2. Click **Capture** button
3. Tweak some knobs (e.g., increase Bass and Warmth)
4. Click Capture again with a different name: "Bassy Mix"
5. Now click on both snapshot thumbnails in the grid
6. Side-by-side comparison shows:
   - All parameters for each snapshot
   - Which parameters differ (highlighted)
   - Percentage change for each parameter
   - "Load This" button to instantly restore that tuning

**Pro tip:** Use this to compare your tuning from different days/sessions or to test variations before committing.

#### **Collections & Favorites** (Preset Organization)
📍 **Location:** Presets view (currently still shows the original PresetsView)

**If you want to use the enhanced version:**
1. Import `EnhancedPresetsView` in `src/App.tsx` instead of `PresetsView`
2. Replace the route:
   ```tsx
   {view === "presets" && <EnhancedPresetsView />}
   ```
3. The new view adds:
   - Left sidebar: Collections (Favorites, Recently Used, custom collections)
   - Heart icons on every preset to add to Favorites
   - "New Collection" button to create genre/mood groups
   - Persistent storage (saved to localStorage)

**Use cases:**
- Create "Mastering" collection with all pro presets
- Create "Experimentation" collection for random tweaks
- Heart your 5 go-to presets
- Recently Used auto-tracks your last 20 used presets

---

## Architecture for Developers

### New Imports You'll See
```typescript
// Real-time metering
import { AdvancedMeter } from "@/components/Metering/AdvancedMeter";

// EQ visualization
import { EQResponseCurve } from "@/components/Playground/EQResponseCurve";

// A/B snapshot tool
import { SnapshotComparator } from "@/components/Snapshot/SnapshotComparator";

// Preset collections state
import { useFavoritesStore } from "@/state/favoritesStore";

// Enhanced presets UI
import { EnhancedPresetsView } from "@/components/Presets/EnhancedPresetsView";
```

### New Store
```typescript
// Zustand store with persistence
const { collections, metadata, toggleFavorite, recordPresetUse } = useFavoritesStore();

// Methods available:
toggleFavorite(presetId)              // ❤️ toggle
addTag(presetId, "jazz")              // tag a preset
createCollection("My Presets")        // new collection
addPresetToCollection(id, collId)     // organize
getFavoritedPresets()                 // query
getTrendingPresets()                  // trending by use count
```

### Component Props
```typescript
// AdvancedMeter — no props, reads from audioStore
<AdvancedMeter />

// EQResponseCurve — no props, reads from audioStore
<EQResponseCurve />

// SnapshotComparator — no props, manages internal state
<SnapshotComparator />

// EnhancedPresetsView — no props, manages internal state
<EnhancedPresetsView />
```

---

## File Locations

```
New Components:
src/components/Metering/AdvancedMeter.tsx        (163 lines)
src/components/Playground/EQResponseCurve.tsx    (139 lines)
src/components/Snapshot/SnapshotComparator.tsx   (293 lines)
src/components/Presets/EnhancedPresetsView.tsx   (318 lines)

New Store:
src/state/favoritesStore.ts                      (232 lines)

Documentation:
EXPERIMENT_SUMMARY.md                            (Quick overview)
ENHANCEMENTS.md                                  (Detailed features)
MANIFEST.md                                      (Architecture)
QUICKSTART.md                                    (This file)

Modified Files:
src/App.tsx                                      (+2 lines)
src/components/Playground/PlaygroundView.tsx     (+4 lines)
src/state/uiStore.ts                            (+1 line)
src/components/Layout/Sidebar.tsx               (+1 line)
```

---

## Keyboard Shortcuts (Unchanged)

The new features don't add shortcuts, but existing ones still work:
- **Space:** Play/pause
- **A:** Store A/B snapshot
- **B:** Swap A/B
- **Shift+R:** Reset to neutral
- **?:** Show hotkey overlay

---

## Common Questions

**Q: Where does the metering data come from?**  
A: The `AdvancedMeter` reads from `AudioEngine.analyserPost`, which is the post-DSP analyser. It measures the output after all your EQ/effects.

**Q: Is the EQ response curve mathematically accurate?**  
A: Yes! It evaluates the actual transfer function of each biquad filter. The curve is computed at 512 frequency points using the complex magnitude of the filter coefficients.

**Q: Can I export snapshots?**  
A: Currently they're stored in component state (lost on page refresh). To persist them, add localStorage save in `SnapshotComparator`. The data structure is already JSON-serializable.

**Q: Why no MIDI learn?**  
A: It's on the wishlist but requires deeper integration with the audio engine's parameter automation system. The store infrastructure is ready for it.

**Q: Can I delete the new features?**  
A: Yes! They're all opt-in. Just don't import them. All existing features work unchanged.

---

## Performance Notes

- **Metering:** Uses `requestAnimationFrame`, runs at 60 fps, CPU efficient
- **EQ Curve:** Draws only when params change (debounced)
- **Snapshots:** In-memory storage (no disk I/O)
- **Collections:** localStorage write is batched (Zustand's persist middleware)

**Hardware requirements:** No change from original. Works on same systems.

---

## Next Steps

1. **Try it out:** Run `npm run dev` and explore
2. **Review code:** Read the 5 new component files—they're well-commented
3. **Test features:** Follow the workflows above
4. **Customize:** Modify colors, add new analysis metrics, etc.
5. **Extend:** Build on top (MIDI learn, export, etc.)

---

## Troubleshooting

**Metering shows zeros:**
→ Make sure you've clicked in the window to initialize AudioContext, then loaded an audio file

**EQ curve not updating:**
→ Check browser console (F12) for any errors; verify EQ knobs are being dragged

**Snapshots not saving:**
→ Snapshots use component state, not persistent storage yet. They'll reset on page refresh.

**Can't see the curve or meters:**
→ Make sure you're on the "Playground" view, not another view

**Types errors on build:**
→ Run `npm run typecheck` to see details; file might have been edited accidentally

---

## Pro Tips

💡 **Metering trick:** Watch the Crest Factor when you enable "Glue" (compression). It should decrease as the compressor reduces dynamic range.

💡 **Curve trick:** Set one tone knob extreme (e.g., Sparkle at max), then watch the curve. The response shows exactly where that knob is working.

💡 **Snapshot trick:** Before using a new preset, capture a snapshot of your current settings. That way you can always A/B compare later.

💡 **Collections trick:** Tag presets as you create them so you can search/filter later.

---

## Support

📖 See detailed docs in:
- `EXPERIMENT_SUMMARY.md` — Overview of all features
- `ENHANCEMENTS.md` — Technical deep dives
- `MANIFEST.md` — Full architecture

🔧 Code comments are inline in each component for specific implementation details.

💬 All TypeScript interfaces are self-documenting with JSDoc comments.

---

*Happy exploring! The audio engineering playground just got richer.* 🎵
