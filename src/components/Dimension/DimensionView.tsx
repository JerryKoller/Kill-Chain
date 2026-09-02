import { useEffect, useRef, useState } from "react";
import { ActionBar } from "@/components/shared/ActionBar";
import { GlassPanel } from "@/components/shared/GlassPanel";
import { Room3DCanvas } from "./Room3DCanvas";
import {
  useDimensionStore,
  flushDimensionPersist,
  SPEAKER_META,
  LAYOUTS,
  ROOM_LIMITS,
  ROOM_PRESETS,
  ABSORPTION_LIMITS,
  MOTION_BANDS,
  MOTION_PATTERNS,
  MOTION_PRESETS,
  SCENE_PRESETS,
  MISSION_PROFILES,
  bandPlacementFor,
  speakersMatchLayout,
  type SpeakerType,
  type DimMode,
  type DimSignal,
} from "@/state/dimensionStore";
import { useEqStore } from "@/state/eqStore";
import { useUIStore } from "@/state/uiStore";
import { getEngine } from "@/audio/AudioEngine";
import { computeRT60, distanceGainDb, itdSeconds } from "@/audio/dsp/Spatializer3D";

const SPEAKER_ORDER: SpeakerType[] = [
  "tower",
  "bookshelf",
  "center",
  "surround",
  "height",
  "subwoofer",
  "soundbar",
];

function fmtHz(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)} kHz` : `${Math.round(hz)} Hz`;
}

export function DimensionView() {
  const active = useDimensionStore((s) => s.active);
  const mode = useDimensionStore((s) => s.mode);
  const signal = useDimensionStore((s) => s.signal);
  const room = useDimensionStore((s) => s.room);
  const absorption = useDimensionStore((s) => s.absorption);
  const listenerYaw = useDimensionStore((s) => s.listenerYaw);
  const speakers = useDimensionStore((s) => s.speakers);
  const selectedId = useDimensionStore((s) => s.selectedId);
  const paletteType = useDimensionStore((s) => s.paletteType);

  const bands = useEqStore((s) => s.bands);
  const activeBands = bands.filter((b) => b.enabled);
  const stage = useDimensionStore((s) => s.stage);
  const space = useDimensionStore((s) => s.space);

  const setActive = useDimensionStore((s) => s.setActive);
  const setMode = useDimensionStore((s) => s.setMode);
  const setSignal = useDimensionStore((s) => s.setSignal);
  const setStage = useDimensionStore((s) => s.setStage);
  const setSpace = useDimensionStore((s) => s.setSpace);
  const setRoom = useDimensionStore((s) => s.setRoom);
  const setAbsorption = useDimensionStore((s) => s.setAbsorption);
  const applyRoomPreset = useDimensionStore((s) => s.applyRoomPreset);
  const setListenerYaw = useDimensionStore((s) => s.setListenerYaw);
  const setPaletteType = useDimensionStore((s) => s.setPaletteType);
  const applyLayout = useDimensionStore((s) => s.applyLayout);
  const applyScenePreset = useDimensionStore((s) => s.applyScenePreset);
  const scene = useDimensionStore((s) => s.scene);
  const addSpeaker = useDimensionStore((s) => s.addSpeaker);
  const autoArrangeBands = useDimensionStore((s) => s.autoArrangeBands);
  const resetDimension = useDimensionStore((s) => s.reset);

  const [confirmReset, setConfirmReset] = useState(false);
  const resetTimer = useRef<number | null>(null);
  const toast = useUIStore((s) => s.toast);

  // Push current scene into the engine whenever the view mounts. Opening is
  // silent: engagement is off until Enter 3D Space.
  useEffect(() => {
    useDimensionStore.getState().syncStructure();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      ) {
        return;
      }
      if (confirmReset) {
        e.preventDefault();
        if (resetTimer.current != null) {
          window.clearTimeout(resetTimer.current);
          resetTimer.current = null;
        }
        setConfirmReset(false);
        return;
      }
      // Browser Esc already leaves the cockpit; don't steal it.
      if (document.fullscreenElement) return;
      if (useDimensionStore.getState().walkMode) {
        e.preventDefault();
        useDimensionStore.getState().setWalkMode(false);
        toast("Walk Mode off");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmReset, toast]);

  useEffect(
    () => () => {
      if (resetTimer.current != null) window.clearTimeout(resetTimer.current);
      flushDimensionPersist();
    },
    [],
  );

  // Band mode tracks the live Sculptor bands — resync when they change.
  useEffect(() => {
    if (mode === "band") useDimensionStore.getState().syncStructure();
  }, [bands, mode]);

  const deployScene = (id: string, label: string) => {
    applyScenePreset(id);
    toast(
      useDimensionStore.getState().active
        ? `${label} deployed`
        : `${label} set — Enter 3D Space to hear it`,
    );
  };

  const selectedSpeaker = speakers.find((s) => s.id === selectedId) ?? null;
  const headTracking = useDimensionStore((s) => s.headTracking);
  const rt60 = computeRT60(room.width, room.height, room.depth, absorption);

  return (
    <div className="space-y-4 pb-6">
      <ActionBar
        title="3rd Dimension"
        code="KC-09"
        subtitle="Place sources in a virtual room — silent until you Enter 3D Space"
        showActions={false}
      />

      {/* v2.0 — Mission Profiles: complete one-click spatial deployments. */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-[10px] uppercase tracking-[0.3em] text-dim">Mission Profiles</div>
          <SceneFileButtons />
        </div>
        <div className="flex flex-wrap items-stretch gap-2">
          {MISSION_PROFILES.map((p) => (
            <button
              key={p.id}
              onClick={() => deployScene(p.id, p.label)}
              title={p.desc}
              className={`flex-1 min-w-[150px] rounded-xl border px-3 py-2 text-left transition ${
                scene === p.id
                  ? "border-cyan/60 bg-cyan/10 shadow-[0_0_18px_rgb(var(--c-cyan)/0.2)]"
                  : "border-white/10 bg-white/[0.03] hover:bg-white/[0.07] hover:border-white/20"
              }`}
            >
              <div className={`text-sm font-semibold ${scene === p.id ? "text-cyan" : "text-white/85"}`}>
                {p.icon} {p.label}
              </div>
              <div className="text-[10px] text-white/40 mt-0.5 leading-snug line-clamp-2">
                {p.desc}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* v1.5 — Cinema-seat scene presets (compact row). */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-[0.25em] text-dim mr-1">Seats</span>
        {SCENE_PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => deployScene(p.id, p.label)}
            title={p.desc}
            className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
              scene === p.id
                ? "border-cyan/60 bg-cyan/10 text-cyan"
                : "border-white/10 bg-white/[0.03] text-white/70 hover:bg-white/[0.07]"
            }`}
          >
            {p.icon} {p.label}
          </button>
        ))}
      </div>

      {/* Master controls */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => setActive(!active)}
          title={
            active
              ? "Return to the stereo output (Sculptor bypass / chain as they were)"
              : "Replace the stereo output with this binaural room. 3D is the output even if the chain is bypassed."
          }
          className={`rounded-xl px-5 py-3 text-sm font-bold tracking-wide uppercase border transition ${
            active
              ? "border-cyan/70 bg-cyan/20 text-cyan shadow-[0_0_24px_rgb(var(--c-cyan)/0.35)]"
              : "border-white/15 bg-white/5 text-white/80 hover:bg-white/10"
          }`}
        >
          {active ? "● 3D Engaged — click to exit" : "Enter 3D Space"}
        </button>

        <Segmented<DimMode>
          value={mode}
          onChange={setMode}
          options={[
            { id: "speaker", label: "Speaker Mode" },
            { id: "band", label: "Band Mode" },
            { id: "motion", label: "Motion Mode" },
          ]}
        />

        {/* Headphone Stage: intimate near-field halo tuned for HRTF imaging;
            Room Stage: the physical placement simulation. */}
        <Segmented<"head" | "room">
          value={stage}
          onChange={setStage}
          options={[
            { id: "head", label: "🎧 Headphone Stage" },
            { id: "room", label: "⌂ Room Stage" },
          ]}
        />

        <Segmented<DimSignal>
          value={signal}
          onChange={setSignal}
          options={[
            { id: "eqd", label: "Sculpted" },
            { id: "raw", label: "Raw Track" },
          ]}
        />

        {active && <HoldToCompare />}

        <span className="text-[11px] text-dim">
          {active
            ? signal === "eqd"
              ? "Spatializing your sculpted sound"
              : "Spatializing the source before Sculptor"
            : "Opening this tab is silent until you Enter 3D Space."}
        </span>

        <div className="flex-1" />

        <button
          onClick={() => {
            if (confirmReset) {
              if (resetTimer.current != null) {
                window.clearTimeout(resetTimer.current);
                resetTimer.current = null;
              }
              setConfirmReset(false);
              resetDimension();
              toast("Room restored — 3D off");
            } else {
              setConfirmReset(true);
              if (resetTimer.current != null) window.clearTimeout(resetTimer.current);
              resetTimer.current = window.setTimeout(() => setConfirmReset(false), 2400);
            }
          }}
          className={`rounded-lg border px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] font-semibold transition ${
            confirmReset
              ? "border-rose-400/70 bg-rose-500/20 text-rose-200"
              : "border-white/10 text-white/40 hover:text-rose-200/80 hover:border-rose-400/30"
          }`}
          title="Restore the default room, 2.0 layout, Walk Mode off, and 3D off. Sculptor knobs are unchanged."
        >
          {confirmReset ? "CONFIRM RESET" : "✕ Reset room"}
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.6fr_1fr] gap-4">
        {/* 3D stage */}
        <GlassPanel intense className="p-2">
          <div className="h-[58vh] min-h-[360px] rounded-xl bg-black/40 overflow-hidden">
            <Room3DCanvas />
          </div>
        </GlassPanel>

        {/* Right rail */}
        <div className="space-y-4">
          {/* Room / soundstage */}
          <GlassPanel className="p-4">
            <PanelTitle>Room · Soundstage</PanelTitle>
            <div className="flex gap-2 mt-3">
              {ROOM_PRESETS.map((p) => {
                const current =
                  Math.abs(room.width - p.width) < 0.01 &&
                  Math.abs(room.height - p.height) < 0.01 &&
                  Math.abs(room.depth - p.depth) < 0.01 &&
                  Math.abs(absorption - p.absorption) < 0.005;
                return (
                  <button
                    key={p.id}
                    onClick={() => applyRoomPreset(p.id)}
                    title={p.desc}
                    className={`flex-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold border transition ${
                      current
                        ? "border-cyan/60 bg-cyan/10 text-cyan"
                        : "border-white/10 bg-white/[0.03] text-white/70 hover:bg-white/[0.06]"
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
            <div className="space-y-3 mt-3">
              <RoomSlider
                label="Width"
                value={room.width}
                min={ROOM_LIMITS.width.min}
                max={ROOM_LIMITS.width.max}
                onChange={(width) => setRoom({ width })}
              />
              <RoomSlider
                label="Height"
                value={room.height}
                min={ROOM_LIMITS.height.min}
                max={ROOM_LIMITS.height.max}
                onChange={(height) => setRoom({ height })}
              />
              <RoomSlider
                label="Depth"
                value={room.depth}
                min={ROOM_LIMITS.depth.min}
                max={ROOM_LIMITS.depth.max}
                onChange={(depth) => setRoom({ depth })}
              />
              <div>
                <div className="flex justify-between text-[11px] text-dim mb-1">
                  <span>Wall absorption</span>
                  <span>
                    {Math.round(absorption * 100)}% ·{" "}
                    {absorption >= 0.38 ? "dead" : absorption >= 0.2 ? "damped" : "live"}
                  </span>
                </div>
                <input
                  type="range"
                  min={ABSORPTION_LIMITS.min}
                  max={ABSORPTION_LIMITS.max}
                  step={0.01}
                  value={absorption}
                  onChange={(e) => setAbsorption(Number(e.target.value))}
                  className="w-full accent-cyan"
                />
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-dim">Reverb time (Sabine RT60)</span>
                <span className="text-cyan/90 font-semibold tabular-nums">
                  {Math.min(2.5, rt60).toFixed(2)} s{rt60 > 2.5 ? " · capped" : ""}
                </span>
              </div>
              <div>
                <div className="flex justify-between text-[11px] text-dim mb-1">
                  <span>Space · ambience</span>
                  <span>
                    {Math.round(space * 100)}%
                    {stage === "head" ? " · near-field" : ""}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={space}
                  onChange={(e) => setSpace(Number(e.target.value))}
                  className="w-full accent-cyan"
                  title="How much of the room you hear around the sources. 0 = bone dry (maximum clarity), 50% = physically accurate, 100% = lush."
                />
              </div>
              <div>
                <div className="flex justify-between text-[11px] text-dim mb-1">
                  <span>Listener facing</span>
                  <span>{Math.round((listenerYaw * 180) / Math.PI)}°</span>
                </div>
                <input
                  type="range"
                  min={-180}
                  max={180}
                  step={1}
                  value={Math.round((listenerYaw * 180) / Math.PI)}
                  onChange={(e) =>
                    setListenerYaw((Number(e.target.value) * Math.PI) / 180)
                  }
                  className="w-full accent-cyan"
                  title={
                    headTracking
                      ? "Base facing — head tracking adds on top"
                      : "Listener facing in the room"
                  }
                />
              </div>
            </div>
          </GlassPanel>

          <HeadTrackingPanel />

          <WalkModePanel />

          {mode === "speaker" ? (
            <>
              <GlassPanel className="p-4">
                <PanelTitle>Layout Presets</PanelTitle>
                <div className="grid grid-cols-2 gap-2 mt-3">
                  {LAYOUTS.map((l) => (
                    <button
                      key={l.id}
                      onClick={() => applyLayout(l.id)}
                      className={`text-left rounded-lg px-3 py-2 border transition ${
                        speakersMatchLayout(speakers, l.id)
                          ? "border-cyan/60 bg-cyan/10"
                          : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
                      }`}
                    >
                      <div className="text-sm font-semibold text-white/90">{l.label}</div>
                      <div className="text-[10px] text-dim">{l.desc}</div>
                    </button>
                  ))}
                </div>
              </GlassPanel>

              <GlassPanel className="p-4">
                <PanelTitle>Add Speaker</PanelTitle>
                <div className="text-[11px] text-dim mt-1 mb-2">
                  Pick a type, then double-click the floor — or hit Add.
                </div>
                <div className="flex flex-wrap gap-2">
                  {SPEAKER_ORDER.map((t) => (
                    <button
                      key={t}
                      onClick={() => setPaletteType(t)}
                      className={`rounded-lg px-2.5 py-1.5 text-xs border transition flex items-center gap-1.5 ${
                        paletteType === t
                          ? "border-white/40 bg-white/10"
                          : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
                      }`}
                    >
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-sm"
                        style={{ background: SPEAKER_META[t].color }}
                      />
                      {SPEAKER_META[t].short}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => addSpeaker(paletteType)}
                  className="mt-3 w-full rounded-lg border border-cyan/40 bg-cyan/10 hover:bg-cyan/20 px-3 py-2 text-sm font-semibold text-cyan transition"
                >
                  + Add {SPEAKER_META[paletteType].short}
                </button>
              </GlassPanel>

              <SpeakerInspector speaker={selectedSpeaker} />
            </>
          ) : mode === "motion" ? (
            <MotionPanel active={active} />
          ) : (
            <BandPanel
              activeCount={activeBands.length}
              onAutoArrange={autoArrangeBands}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Motion Mode: the track splits into frequency bands that MOVE around your
 * head on their own — height follows frequency, distance and speed follow
 * each band's live energy, and (in Fly-by) sudden surges race right past
 * your ear. Pure headphone immersion; no speakers to place.
 */
function MotionPanel({ active }: { active: boolean }) {
  const motion = useDimensionStore((s) => s.motion);
  const setMotion = useDimensionStore((s) => s.setMotion);
  const applyMotionPreset = useDimensionStore((s) => s.applyMotionPreset);
  const pattern = MOTION_PATTERNS.find((p) => p.id === motion.pattern) ?? MOTION_PATTERNS[0];

  return (
    <>
      <GlassPanel className="p-4">
        <PanelTitle>Motion Characters</PanelTitle>
        <div className="grid grid-cols-2 gap-2 mt-3">
          {MOTION_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => applyMotionPreset(p.id)}
              title={p.desc}
              className="text-left rounded-lg px-3 py-2 border border-white/10 bg-white/[0.03] hover:bg-cyan/10 hover:border-cyan/40 transition"
            >
              <div className="text-sm font-semibold text-white/90">{p.label}</div>
              <div className="text-[10px] text-dim truncate">{p.desc.split("—")[0].trim()}</div>
            </button>
          ))}
        </div>
      </GlassPanel>

      <GlassPanel className="p-4">
        <PanelTitle>Motion Pattern</PanelTitle>
        <div className="grid grid-cols-2 gap-2 mt-3">
          {MOTION_PATTERNS.map((p) => (
            <button
              key={p.id}
              onClick={() => setMotion({ pattern: p.id })}
              title={p.desc}
              className={`text-left rounded-lg px-3 py-2 border transition ${
                motion.pattern === p.id
                  ? "border-cyan/60 bg-cyan/10"
                  : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
              }`}
            >
              <div className="text-sm font-semibold text-white/90">{p.label}</div>
            </button>
          ))}
        </div>
        <div className="text-[11px] text-dim mt-2 leading-relaxed">{pattern.desc}.</div>

        <div className="space-y-3 mt-4">
          <MotionSlider
            label="Speed"
            hint="Base movement rate"
            value={motion.speed}
            onChange={(speed) => setMotion({ speed })}
          />
          <MotionSlider
            label="Intensity"
            hint="How far things travel (radius, height swing)"
            value={motion.intensity}
            onChange={(intensity) => setMotion({ intensity })}
          />
          <MotionSlider
            label="Reactivity"
            hint="How hard each band's own energy drives it (louder → closer, faster)"
            value={motion.reactivity}
            onChange={(reactivity) => setMotion({ reactivity })}
          />
          <MotionSlider
            label="Cohesion"
            hint="How locked the bands are into ONE formation — high = a constellation turning together (musical), low = every band on its own trajectory (chaotic)"
            value={motion.cohesion}
            onChange={(cohesion) => setMotion({ cohesion })}
          />
        </div>

        <button
          onClick={() => setMotion({ anchorLows: !motion.anchorLows })}
          data-ui-sound="toggle"
          data-ui-on={motion.anchorLows ? "true" : "false"}
          className={`mt-3 w-full rounded-lg px-3 py-2 text-sm font-semibold border transition ${
            motion.anchorLows
              ? "border-cyan/50 bg-cyan/10 text-cyan"
              : "border-white/15 bg-white/5 text-white/70 hover:bg-white/10"
          }`}
          title="Pin Sub + Bass dead ahead so the fundament never smears. Moving bass sounds phasey — anchored lows are what keep motion HI-FI. Turn off for full chaos."
        >
          {motion.anchorLows ? "⚓ Solid bass — lows anchored" : "○ Lows free-flying"}
        </button>

        <button
          onClick={() => setMotion({ bpmSync: !motion.bpmSync })}
          data-ui-sound="toggle"
          data-ui-on={motion.bpmSync ? "true" : "false"}
          className={`mt-2 w-full rounded-lg px-3 py-2 text-sm font-semibold border transition ${
            motion.bpmSync
              ? "border-cyan/50 bg-cyan/10 text-cyan"
              : "border-white/15 bg-white/5 text-white/70 hover:bg-white/10"
          }`}
          title="Lock the formation to the track's beat grid: the constellation turns with the bars and presses in on every beat (uses the shared BPM analysis)."
        >
          {motion.bpmSync ? "🎵 BPM lock — moving on the grid" : "○ Free motion — ignore the beat"}
        </button>

        {!active && (
          <div className="mt-3 text-[11px] text-amber-300/80">
            Hit “Enter 3D Space” and play something — the bands come alive with the music.
          </div>
        )}
      </GlassPanel>

      <GlassPanel className="p-4">
        <PanelTitle>The Moving Bands</PanelTitle>
        <div className="text-[11px] text-dim mt-2 leading-relaxed">
          Your sound splits into {MOTION_BANDS.length} bands on a Linkwitz-Riley crossover
          (they sum back flat — no smear at rest). Lows hold the floor, highs circle
          overhead. A passing truck lives in Sub/Bass; a jet fly-over sweeps Presence and
          Air right across your head.
        </div>
        <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] tabular-nums">
          {MOTION_BANDS.map((b) => (
            <div key={b.id} className="flex justify-between gap-2">
              <span className="text-dim">
                {b.anchor ? "⚓ " : ""}{b.label}
              </span>
              <span className="text-white/85 font-semibold">
                {b.lo === null ? `< ${fmtHz(b.hi!)}` : b.hi === null ? `> ${fmtHz(b.lo)}` : `${fmtHz(b.lo)}–${fmtHz(b.hi)}`}
              </span>
            </div>
          ))}
        </div>
      </GlassPanel>
    </>
  );
}

function MotionSlider({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div title={hint}>
      <div className="flex justify-between text-[11px] text-dim mb-1">
        <span>{label}</span>
        <span>{Math.round(value * 100)}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="kc-slider w-full"
        style={{ ["--kc-fill" as string]: `${value * 100}%` }}
      />
    </div>
  );
}

function PanelTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-[0.3em] text-dim">{children}</div>
  );
}

/** v2.0 — save / load the whole spatial scene as a `.kdim` file. */
function SceneFileButtons() {
  const exportScene = useDimensionStore((s) => s.exportScene);
  const importScene = useDimensionStore((s) => s.importScene);
  const toast = useUIStore((s) => s.toast);
  const desktop = typeof window !== "undefined" && !!window.playground?.files;
  if (!desktop) return null;

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => {
          void exportScene().then((ok) => {
            if (ok) toast("Scene saved as .kdim");
          });
        }}
        className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] font-semibold text-white/70 hover:bg-white/[0.08] transition"
        title="Save the current spatial scene (layout, room, stage, motion, space) as a .kdim file"
      >
        ⬇ Save .kdim
      </button>
      <button
        onClick={() => {
          void importScene().then((res) => {
            if (!res.ok) {
              if (res.reason === "invalid") toast("Couldn't read that .kdim file");
              return;
            }
            toast(
              useDimensionStore.getState().active
                ? `Scene "${res.name}" deployed`
                : `Scene "${res.name}" set — Enter 3D Space to hear it`,
            );
          });
        }}
        className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] font-semibold text-white/70 hover:bg-white/[0.08] transition"
        title="Load a saved .kdim spatial scene"
      >
        ⬆ Load
      </button>
    </div>
  );
}

/**
 * v2.0 Walk Mode — WASD (R/F for up/down) translates the listener through
 * the room in real time; speakers keep their positions so walking toward
 * one makes it louder, closer and more direct. Drag the character in the
 * room view for the same effect.
 */
function WalkModePanel() {
  const walkMode = useDimensionStore((s) => s.walkMode);
  const setWalkMode = useDimensionStore((s) => s.setWalkMode);
  const listenerPos = useDimensionStore((s) => s.listenerPos);
  const resetListenerPos = useDimensionStore((s) => s.resetListenerPos);
  const active = useDimensionStore((s) => s.active);

  // Held-key movement loop: rAF integrates velocity while keys are down.
  const keysRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!walkMode) return;
    const keys = keysRef.current;
    keys.clear();
    const WALK_KEYS = new Set(["w", "a", "s", "d", "r", "f"]);
    const isTyping = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    };
    const onDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (!WALK_KEYS.has(k) || isTyping(e)) return;
      e.preventDefault();
      keys.add(k);
    };
    const onUp = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
    const onBlur = () => keys.clear();
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);

    let raf = 0;
    let last = performance.now();
    const SPEED = 1.7; // metres per second — a comfortable walking pace
    const loop = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (keys.size > 0) {
        const fwd = (keys.has("w") ? 1 : 0) - (keys.has("s") ? 1 : 0);
        const strafe = (keys.has("d") ? 1 : 0) - (keys.has("a") ? 1 : 0);
        const up = (keys.has("r") ? 1 : 0) - (keys.has("f") ? 1 : 0);
        if (fwd !== 0 || strafe !== 0 || up !== 0) {
          useDimensionStore.getState().nudgeListener(fwd * SPEED * dt, strafe * SPEED * dt, up * SPEED * dt * 0.6);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
      keys.clear();
    };
  }, [walkMode]);

  const off = Math.hypot(listenerPos.x, listenerPos.y, listenerPos.z);

  return (
    <GlassPanel className="p-4">
      <div className="flex items-center justify-between gap-2">
        <PanelTitle>Walk Mode</PanelTitle>
        <button
          onClick={() => setWalkMode(!walkMode)}
          data-ui-sound="toggle"
          data-ui-on={walkMode ? "true" : "false"}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold border transition ${
            walkMode
              ? "border-cyan/60 bg-cyan/15 text-cyan shadow-[0_0_14px_rgb(var(--c-cyan)/0.3)]"
              : "border-white/15 bg-white/5 text-white/75 hover:bg-white/10"
          }`}
        >
          {walkMode ? "● Walking" : "Enable"}
        </button>
      </div>
      <div className="text-[11px] text-dim mt-2 leading-relaxed">
        Move through the room:{" "}
        <span className="font-mono text-white/70">W A S D</span> walk ·{" "}
        <span className="font-mono text-white/70">R / F</span> rise & duck —
        or drag your character in the room view. Speakers stay planted, so
        distance and direction change as you move.
      </div>
      {!active && walkMode && (
        <div className="mt-2 text-[11px] text-amber-300/80">
          Enter 3D Space to hear the walk.
        </div>
      )}
      <div className="mt-3 flex items-center gap-2">
        <span className="text-[11px] font-mono tabular-nums text-white/70">
          x {listenerPos.x.toFixed(1)} · y {listenerPos.y.toFixed(1)} · z {listenerPos.z.toFixed(1)} m
        </span>
        <div className="flex-1" />
        <button
          onClick={resetListenerPos}
          disabled={off < 0.05}
          className={`rounded-lg px-2.5 py-1 text-[11px] border transition ${
            off >= 0.05
              ? "border-white/15 bg-white/5 text-white/80 hover:bg-white/10"
              : "border-white/8 text-white/25 cursor-not-allowed"
          }`}
          title="Walk back to the sweet spot (room centre)"
        >
          ⌂ Sweet spot
        </button>
      </div>
    </GlassPanel>
  );
}

/**
 * Head tracking — listens for opentrack-protocol UDP packets (Tobii via
 * opentrack, AITrack/webcam trackers, phone or headphone IMU bridges) and
 * steers the full 6DOF listener pose: yaw, pitch and roll aim the head,
 * X/Y/Z (when the tracker supplies them) translate it. The room stays put
 * in physical space while you move through it.
 */
function HeadTrackingPanel() {
  const headTracking = useDimensionStore((s) => s.headTracking);
  const port = useDimensionStore((s) => s.headTrackPort);
  const pose = useDimensionStore((s) => s.headTrackPose);
  const zero = useDimensionStore((s) => s.headTrackZero);
  const error = useDimensionStore((s) => s.headTrackError);
  const setHeadTracking = useDimensionStore((s) => s.setHeadTracking);
  const setHeadTrackPort = useDimensionStore((s) => s.setHeadTrackPort);
  const recenter = useDimensionStore((s) => s.recenterHeadTracking);

  const [portText, setPortText] = useState(String(port));
  const desktop = typeof window !== "undefined" && !!window.playground?.headtrack;

  // Stand the tracker down when the app closes this view's whole feature —
  // NOT on unmount: tracking should keep steering while you browse other
  // tabs (that's the point). Nothing to clean up here.

  const rel = pose
    ? {
        yaw: pose.yaw - zero.yaw,
        pitch: pose.pitch - zero.pitch,
        roll: pose.roll - zero.roll,
        x: (pose.x - zero.x) / 100,
        y: (pose.y - zero.y) / 100,
        z: (pose.z - zero.z) / 100,
      }
    : null;
  const hasPos = rel !== null && (Math.abs(rel.x) > 0.005 || Math.abs(rel.y) > 0.005 || Math.abs(rel.z) > 0.005);
  const fmtDeg = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}°`;

  return (
    <GlassPanel className="p-4">
      <div className="flex items-center justify-between gap-2">
        <PanelTitle>Head Tracking</PanelTitle>
        <button
          onClick={() => void setHeadTracking(!headTracking)}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold border transition ${
            headTracking
              ? "border-cyan/60 bg-cyan/15 text-cyan shadow-[0_0_14px_rgb(var(--c-cyan)/0.3)]"
              : "border-white/15 bg-white/5 text-white/75 hover:bg-white/10"
          }`}
          disabled={!desktop}
          title={
            desktop
              ? "Listen for opentrack UDP packets and steer the listener with your head"
              : "Available in the desktop app"
          }
        >
          {headTracking ? "● Tracking" : "Enable"}
        </button>
      </div>

      <div className="text-[11px] text-dim mt-2 leading-relaxed">
        Feed it any <span className="text-white/70">opentrack-compatible</span> tracker
        (Tobii, AITrack webcam, phone/headphone IMU) via &ldquo;UDP over network&rdquo; →
        <span className="font-mono text-white/70"> 127.0.0.1:{port}</span>.
        Full 6DOF: turn, tilt or lean and the room stays put — trackers that
        send position move you through it. Tracking keeps steering if you
        switch tabs.
      </div>

      {!desktop && (
        <div className="mt-2 text-[11px] text-amber-300/80">
          Head tracking needs the desktop app (UDP listener).
        </div>
      )}
      {error && <div className="mt-2 text-[11px] text-rose-300/90">{error}</div>}

      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <label className="flex items-center gap-1.5 text-[11px] text-dim">
          Port
          <input
            value={portText}
            onChange={(e) => setPortText(e.target.value.replace(/[^\d]/g, "").slice(0, 5))}
            onBlur={() => {
              const p = Number(portText) || 4242;
              setPortText(String(p));
              setHeadTrackPort(p);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setPortText(String(port));
              }
            }}
            className="w-[64px] bg-black/50 border border-white/10 rounded-lg px-2 py-1 text-xs font-mono text-white/90 outline-none focus:border-cyan/50"
            inputMode="numeric"
          />
        </label>
        <button
          onClick={recenter}
          disabled={!headTracking || pose === null}
          className={`rounded-lg px-2.5 py-1 text-[11px] border transition ${
            headTracking && pose !== null
              ? "border-white/15 bg-white/5 text-white/80 hover:bg-white/10"
              : "border-white/8 text-white/25 cursor-not-allowed"
          }`}
          title="Capture the current head pose (orientation + position) as straight-ahead"
        >
          ⌖ Recenter
        </button>
        <div className="flex-1" />
        <span className="text-[11px] font-mono tabular-nums text-white/70">
          {headTracking
            ? rel !== null
              ? `yaw ${fmtDeg(rel.yaw)} · pit ${fmtDeg(rel.pitch)} · rol ${fmtDeg(rel.roll)}`
              : "waiting for packets…"
            : "off"}
        </span>
      </div>
      {headTracking && hasPos && rel && (
        <div className="mt-1.5 text-right text-[11px] font-mono tabular-nums text-cyan/80">
          pos {rel.x >= 0 ? "+" : ""}{rel.x.toFixed(2)} · {rel.y >= 0 ? "+" : ""}{rel.y.toFixed(2)} · {rel.z >= 0 ? "+" : ""}{rel.z.toFixed(2)} m
        </div>
      )}
    </GlassPanel>
  );
}

/**
 * Momentary A/B: hold to hear stereo without 3D, release to return to the
 * binaural render. That stereo path is the chain as it currently is
 * (sculpted, or bypassed) — not a second "untouched" render. Uses the
 * engine's smoothed rewire so it's click-free.
 */
function HoldToCompare() {
  const [holding, setHolding] = useState(false);
  const holdingRef = useRef(false);

  const release = (e?: React.PointerEvent<HTMLButtonElement>) => {
    if (!holdingRef.current) return;
    holdingRef.current = false;
    setHolding(false);
    if (e) {
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    }
    if (useDimensionStore.getState().active) getEngine().setDimensionActive(true);
  };

  // Never leave the engine bypassed if the button unmounts mid-hold.
  useEffect(() => () => {
    if (holdingRef.current && useDimensionStore.getState().active) {
      getEngine().setDimensionActive(true);
    }
  }, []);

  return (
    <button
      onPointerDown={(e) => {
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        holdingRef.current = true;
        setHolding(true);
        getEngine().setDimensionActive(false);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      className={`rounded-xl px-4 py-3 text-xs font-bold tracking-wide uppercase border transition select-none ${
        holding
          ? "border-amber-400/70 bg-amber-400/20 text-amber-200"
          : "border-white/15 bg-white/5 text-white/80 hover:bg-white/10"
      }`}
    >
      {holding ? "Hearing stereo (no 3D)" : "Hold to hear stereo"}
    </button>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: string }[];
}) {
  return (
    <div className="kc-seg">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`kc-seg-btn ${value === o.id ? "kc-on" : ""}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function RoomSlider({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex justify-between text-[11px] text-dim mb-1">
        <span>{label}</span>
        <span>{value.toFixed(1)} m</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={0.5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="kc-slider w-full"
        style={{ ["--kc-fill" as string]: `${((value - min) / (max - min)) * 100}%` }}
      />
    </div>
  );
}

function SpeakerInspector({
  speaker,
}: {
  speaker: ReturnType<typeof useDimensionStore.getState>["speakers"][number] | null;
}) {
  const setSpeakerType = useDimensionStore((s) => s.setSpeakerType);
  const setSpeakerGain = useDimensionStore((s) => s.setSpeakerGain);
  const toggleSpeakerEnabled = useDimensionStore((s) => s.toggleSpeakerEnabled);
  const removeSpeaker = useDimensionStore((s) => s.removeSpeaker);
  const moveSpeaker = useDimensionStore((s) => s.moveSpeaker);
  const room = useDimensionStore((s) => s.room);
  const listenerYaw = useDimensionStore((s) => s.listenerYaw);
  const listenerPos = useDimensionStore((s) => s.listenerPos);
  const headTrackPose = useDimensionStore((s) => s.headTrackPose);

  if (!speaker) {
    return (
      <GlassPanel className="p-4">
        <PanelTitle>Selected Speaker</PanelTitle>
        <div className="text-[12px] text-dim mt-3">
          Click a speaker in the room to edit it.
        </div>
      </GlassPanel>
    );
  }

  // Acoustic truth for the selected speaker — same math the audio graph uses,
  // measured from the live listener (Walk Mode + head tracking), not room origin.
  const wx = speaker.nx * (room.width / 2);
  const wy = speaker.ny * (room.height / 2);
  const wz = speaker.nz * (room.depth / 2);
  let lx = listenerPos.x;
  let ly = listenerPos.y;
  let lz = listenerPos.z;
  let yaw = listenerYaw;
  void headTrackPose; // re-render when the tracker pose ticks
  try {
    const pose = getEngine().dimension.getListenerPose();
    lx = pose.x;
    ly = pose.y;
    lz = pose.z;
    yaw = pose.yaw;
  } catch { /* engine not built yet */ }
  const dist = Math.hypot(wx - lx, wy - ly, wz - lz);
  // Azimuth relative to the listener's facing: 0° = ahead, + = to the right.
  let azimuth = Math.atan2(wx - lx, -(wz - lz)) - yaw;
  while (azimuth > Math.PI) azimuth -= 2 * Math.PI;
  while (azimuth < -Math.PI) azimuth += 2 * Math.PI;
  const elevation = Math.atan2(wy - ly, Math.hypot(wx - lx, wz - lz));
  const attenDb = distanceGainDb(dist);
  const itdUs = itdSeconds(azimuth) * 1e6;

  return (
    <GlassPanel className="p-4">
      <div className="flex items-center justify-between">
        <PanelTitle>Selected Speaker</PanelTitle>
        <button
          onClick={() => removeSpeaker(speaker.id)}
          className="text-[11px] text-rose-300/80 hover:text-rose-200 transition"
        >
          ✕ Remove
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] tabular-nums">
        <Stat label="Distance" value={`${dist.toFixed(2)} m`} />
        <Stat label="Azimuth" value={`${azimuth >= 0 ? "+" : ""}${Math.round((azimuth * 180) / Math.PI)}°`} />
        <Stat label="Elevation" value={`${elevation >= 0 ? "+" : ""}${Math.round((elevation * 180) / Math.PI)}°`} />
        <Stat label="Distance loss" value={`${attenDb.toFixed(1)} dB`} />
        <Stat
          label="ITD (approx)"
          value={
            Math.abs(itdUs) < 5
              ? "0 µs"
              : `${Math.abs(Math.round(itdUs))} µs · ${itdUs > 0 ? "R" : "L"} first`
          }
        />
        <Stat
          label="At listener"
          value={`${(speaker.gainDb + attenDb) > 0 ? "+" : ""}${(speaker.gainDb + attenDb).toFixed(1)} dB`}
        />
      </div>

      <div className="mt-3 space-y-3">
        <label className="block">
          <span className="text-[11px] text-dim">Type</span>
          <select
            value={speaker.type}
            onChange={(e) => setSpeakerType(speaker.id, e.target.value as SpeakerType)}
            className="mt-1 w-full bg-black/50 border border-white/10 rounded-lg px-2 py-1.5 text-sm"
          >
            {SPEAKER_ORDER.map((t) => (
              <option key={t} value={t}>
                {SPEAKER_META[t].label}
              </option>
            ))}
          </select>
        </label>

        <div>
          <div className="flex justify-between text-[11px] text-dim mb-1">
            <span>Level</span>
            <span>{speaker.gainDb > 0 ? "+" : ""}{speaker.gainDb.toFixed(1)} dB</span>
          </div>
          <input
            type="range"
            min={-12}
            max={12}
            step={0.5}
            value={speaker.gainDb}
            onChange={(e) => setSpeakerGain(speaker.id, Number(e.target.value))}
            className="w-full accent-cyan"
          />
        </div>

        <div>
          <div className="flex justify-between text-[11px] text-dim mb-1">
            <span>Height</span>
            <span>{speaker.ny > 0.05 ? "Up" : speaker.ny < -0.05 ? "Low" : "Ear level"}</span>
          </div>
          <input
            type="range"
            min={-1}
            max={1}
            step={0.02}
            value={speaker.ny}
            onChange={(e) => moveSpeaker(speaker.id, { ny: Number(e.target.value) })}
            className="w-full accent-cyan"
          />
        </div>

        <button
          onClick={() => toggleSpeakerEnabled(speaker.id)}
          className={`w-full rounded-lg px-3 py-2 text-sm font-semibold border transition ${
            speaker.enabled
              ? "border-white/15 bg-white/5 text-white/80 hover:bg-white/10"
              : "border-rose-400/40 bg-rose-500/10 text-rose-200"
          }`}
        >
          {speaker.enabled ? "Mute this speaker" : "Un-mute speaker"}
        </button>
      </div>
    </GlassPanel>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-dim">{label}</span>
      <span className="text-white/85 font-semibold">{value}</span>
    </div>
  );
}

function BandPanel({
  activeCount,
  onAutoArrange,
}: {
  activeCount: number;
  onAutoArrange: () => void;
}) {
  const bands = useEqStore((s) => s.bands);
  const selectedId = useDimensionStore((s) => s.selectedId);
  const select = useDimensionStore((s) => s.select);
  const placeBand = useDimensionStore((s) => s.placeBand);
  const bandPlacements = useDimensionStore((s) => s.bandPlacements);
  const list = bands.filter((b) => b.enabled);

  return (
    <GlassPanel className="p-4">
      <div className="flex items-center justify-between">
        <PanelTitle>Active Bands · {activeCount}</PanelTitle>
        <button
          onClick={onAutoArrange}
          className="text-[11px] rounded-lg border border-cyan/40 bg-cyan/10 hover:bg-cyan/20 px-2.5 py-1 text-cyan transition"
        >
          ✧ Auto-arrange
        </button>
      </div>
      <div className="text-[11px] text-dim mt-2">
        Each active Sculptor band becomes a point of sound. Drag them in the room,
        or auto-arrange them low→high across the stage.
      </div>
      <div className="mt-3 space-y-1.5 max-h-[34vh] overflow-y-auto sidebar-scroll -mr-1 pr-1">
        {list.length === 0 && (
          <div className="text-[12px] text-dim py-4 text-center">
            No active bands. Enable bands in the Sculptor first.
          </div>
        )}
        {list.map((b, i) => {
          const sel = selectedId === b.id;
          const auto = bandPlacementFor(i, list.length);
          const pl = bandPlacements[b.id];
          return (
            <div
              key={b.id}
              className={`rounded-lg px-3 py-2 border transition cursor-pointer ${
                sel ? "border-cyan/60 bg-cyan/10" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
              }`}
              onClick={() => select(b.id)}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-white/90">{fmtHz(b.freq)}</span>
                <span className="text-[10px] text-dim">
                  {pl ? "placed" : "auto"}
                </span>
              </div>
              {sel && (
                <div className="mt-2">
                  <div className="flex justify-between text-[10px] text-dim mb-1">
                    <span>Height</span>
                  </div>
                  <input
                    type="range"
                    min={-1}
                    max={1}
                    step={0.02}
                    value={pl?.ny ?? auto.ny}
                    onChange={(e) => placeBand(b.id, { ny: Number(e.target.value) })}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full accent-cyan"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </GlassPanel>
  );
}
