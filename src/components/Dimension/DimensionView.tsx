import { useEffect, useState } from "react";
import { ActionBar } from "@/components/shared/ActionBar";
import { GlassPanel } from "@/components/shared/GlassPanel";
import { Room3DCanvas } from "./Room3DCanvas";
import {
  useDimensionStore,
  SPEAKER_META,
  LAYOUTS,
  ROOM_LIMITS,
  ROOM_PRESETS,
  ABSORPTION_LIMITS,
  MOTION_BANDS,
  MOTION_PATTERNS,
  MOTION_PRESETS,
  motionBandCentre,
  type SpeakerType,
  type DimMode,
  type DimSignal,
} from "@/state/dimensionStore";
import { useEqStore } from "@/state/eqStore";
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
  const layout = useDimensionStore((s) => s.layout);
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
  const addSpeaker = useDimensionStore((s) => s.addSpeaker);
  const autoArrangeBands = useDimensionStore((s) => s.autoArrangeBands);
  const resetDimension = useDimensionStore((s) => s.reset);

  const [confirmReset, setConfirmReset] = useState(false);

  // Push current scene into the engine whenever the view mounts.
  useEffect(() => {
    useDimensionStore.getState().syncStructure();
  }, []);

  // Band mode tracks the live Sculptor bands — resync when they change.
  useEffect(() => {
    if (mode === "band") useDimensionStore.getState().syncStructure();
  }, [bands, mode]);

  const selectedSpeaker = speakers.find((s) => s.id === selectedId) ?? null;

  return (
    <div className="space-y-4 pb-6">
      <ActionBar title="3rd Dimension" code="KC-09" subtitle="Deploy sound anywhere in a virtual room — position every source in space" />

      {/* Master controls */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => setActive(!active)}
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

        {active && (
          <span className="text-[11px] text-dim">
            {signal === "eqd"
              ? "Spatializing your sculpted sound"
              : "Spatializing the untouched source"}
          </span>
        )}

        <div className="flex-1" />

        <button
          onClick={() => {
            if (confirmReset) {
              setConfirmReset(false);
              resetDimension();
            } else {
              setConfirmReset(true);
              window.setTimeout(() => setConfirmReset(false), 2400);
            }
          }}
          className={`rounded-lg border px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] font-semibold transition ${
            confirmReset
              ? "border-rose-400/70 bg-rose-500/20 text-rose-200"
              : "border-white/10 text-white/40 hover:text-rose-200/80 hover:border-rose-400/30"
          }`}
          title="Delete every placed speaker and restore the default room + layout"
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
                  {Math.min(2.5, computeRT60(room.width, room.height, room.depth, absorption)).toFixed(2)} s
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
                />
              </div>
            </div>
          </GlassPanel>

          <HeadTrackingPanel />

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
                        layout === l.id
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
        className="w-full accent-cyan"
      />
    </div>
  );
}

function PanelTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-[0.3em] text-dim">{children}</div>
  );
}

/**
 * Head tracking (issue #9): listens for opentrack-protocol UDP packets
 * (Tobii via opentrack, AITrack/webcam trackers, phone or headphone IMU
 * bridges) and steers the 3D listener's facing — turn your head and the
 * virtual room stays put in physical space.
 */
function HeadTrackingPanel() {
  const headTracking = useDimensionStore((s) => s.headTracking);
  const port = useDimensionStore((s) => s.headTrackPort);
  const yawDeg = useDimensionStore((s) => s.headTrackYawDeg);
  const zeroDeg = useDimensionStore((s) => s.headTrackZeroDeg);
  const error = useDimensionStore((s) => s.headTrackError);
  const setHeadTracking = useDimensionStore((s) => s.setHeadTracking);
  const setHeadTrackPort = useDimensionStore((s) => s.setHeadTrackPort);
  const recenter = useDimensionStore((s) => s.recenterHeadTracking);

  const [portText, setPortText] = useState(String(port));
  const desktop = typeof window !== "undefined" && !!window.playground?.headtrack;

  // Stand the tracker down when the app closes this view's whole feature —
  // NOT on unmount: tracking should keep steering while you browse other
  // tabs (that's the point). Nothing to clean up here.

  const relDeg = yawDeg !== null ? yawDeg - zeroDeg : null;

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
        Turn your head and the room stays put.
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
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            className="w-[64px] bg-black/50 border border-white/10 rounded-lg px-2 py-1 text-xs font-mono text-white/90 outline-none focus:border-cyan/50"
            inputMode="numeric"
          />
        </label>
        <button
          onClick={recenter}
          disabled={!headTracking || yawDeg === null}
          className={`rounded-lg px-2.5 py-1 text-[11px] border transition ${
            headTracking && yawDeg !== null
              ? "border-white/15 bg-white/5 text-white/80 hover:bg-white/10"
              : "border-white/8 text-white/25 cursor-not-allowed"
          }`}
          title="Capture the current head pose as straight-ahead"
        >
          ⌖ Recenter
        </button>
        <div className="flex-1" />
        <span className="text-[11px] font-mono tabular-nums text-white/70">
          {headTracking
            ? relDeg !== null
              ? `yaw ${relDeg >= 0 ? "+" : ""}${relDeg.toFixed(0)}°`
              : "waiting for packets…"
            : "off"}
        </span>
      </div>
    </GlassPanel>
  );
}

/**
 * Momentary A/B: hold to hear the untouched stereo path, release to return to
 * the binaural render. Uses the engine's smoothed rewire so it's click-free.
 */
function HoldToCompare() {
  const [holding, setHolding] = useState(false);

  const release = () => {
    setHolding(false);
    if (useDimensionStore.getState().active) getEngine().setDimensionActive(true);
  };

  // Never leave the engine bypassed if the button unmounts mid-hold.
  useEffect(() => () => {
    if (useDimensionStore.getState().active) getEngine().setDimensionActive(true);
  }, []);

  return (
    <button
      onPointerDown={() => {
        setHolding(true);
        getEngine().setDimensionActive(false);
      }}
      onPointerUp={release}
      onPointerLeave={() => holding && release()}
      className={`rounded-xl px-4 py-3 text-xs font-bold tracking-wide uppercase border transition select-none ${
        holding
          ? "border-amber-400/70 bg-amber-400/20 text-amber-200"
          : "border-white/15 bg-white/5 text-white/80 hover:bg-white/10"
      }`}
    >
      {holding ? "Hearing flat stereo" : "Hold to compare A/B"}
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
    <div className="inline-flex rounded-xl border border-white/10 bg-white/[0.03] p-1">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
            value === o.id ? "bg-white/12 text-white" : "text-white/55 hover:text-white/80"
          }`}
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
        className="w-full accent-cyan"
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

  // Acoustic truth for the selected speaker — same math the audio graph uses.
  const wx = speaker.nx * (room.width / 2);
  const wy = speaker.ny * (room.height / 2);
  const wz = speaker.nz * (room.depth / 2);
  const dist = Math.hypot(wx, wy, wz);
  // Azimuth relative to the listener's facing: 0° = ahead, + = to the right.
  let azimuth = Math.atan2(wx, -wz) - listenerYaw;
  while (azimuth > Math.PI) azimuth -= 2 * Math.PI;
  while (azimuth < -Math.PI) azimuth += 2 * Math.PI;
  const elevation = Math.atan2(wy, Math.hypot(wx, wz));
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
        {list.map((b) => {
          const sel = selectedId === b.id;
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
                    value={pl?.ny ?? 0}
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
