import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GlassPanel } from "@/components/shared/GlassPanel";
import { Knob } from "@/components/shared/Knob";
import { useAudioStore } from "@/state/audioStore";
import { getEngine } from "@/audio/AudioEngine";
import type { RoomId } from "@/audio/dsp/HRTFRooms";
import { SOUND_PARAM_META, type SoundParams } from "@/audio/types";

const PRO_DSP_KEYS: (keyof SoundParams)[] = [
  "deEss",
  "subWidth",
  "presenceWidth",
  "airWidth",
  "mbCompLow",
  "mbCompMid",
  "mbCompHigh",
];

const ROOM_OPTIONS: { id: RoomId; name: string; blurb: string }[] = [
  { id: "off", name: "Off", blurb: "Pure headphone stereo" },
  { id: "studio", name: "Studio", blurb: "Tight near-field room" },
  { id: "cinema", name: "Cinema", blurb: "Medium hall, delayed reflections" },
  { id: "club", name: "Club", blurb: "Big diffuse space, long tail" },
];

export function ProToolsPanel() {
  const [open, setOpen] = useState(false);
  const params = useAudioStore((s) => s.params);
  const setParam = useAudioStore((s) => s.setParam);
  const room = useAudioStore((s) => s.room);
  const roomMix = useAudioStore((s) => s.roomMix);
  const setRoom = useAudioStore((s) => s.setRoom);
  const setRoomMix = useAudioStore((s) => s.setRoomMix);
  const balanceLDb = useAudioStore((s) => s.balanceLDb);
  const balanceRDb = useAudioStore((s) => s.balanceRDb);
  const balanceDelayMs = useAudioStore((s) => s.balanceDelayMs);
  const setBalance = useAudioStore((s) => s.setBalance);

  const [lufs, setLufs] = useState({ momentary: -120, short: -120, integrated: -120 });

  useEffect(() => {
    if (!open) return;
    const eng = getEngine();
    eng.ensureLufsMeter();
    const id = setInterval(() => {
      setLufs({
        momentary: eng.lufs.momentaryLufs,
        short: eng.lufs.shortTermLufs,
        integrated: eng.lufs.integratedLufs,
      });
    }, 200);
    return () => {
      clearInterval(id);
      eng.releaseLufsMeter();
    };
  }, [open]);

  return (
    <GlassPanel intense className="p-0 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-5 py-3 flex items-center justify-between hover:bg-white/[0.03] transition"
      >
        <div className="text-left">
          <div className="text-xs uppercase tracking-[0.3em] text-dim">Pro Tools</div>
          <div className="text-base font-semibold">
            De-esser - Multiband - Per-band Width - HRTF Rooms - L/R - LUFS
          </div>
        </div>
        <div className="text-sm text-cyan/80 font-mono">{open ? "\u25BC" : "\u25B6"}</div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden border-t border-white/10"
          >
            <div className="p-5 space-y-5">
              {/* Per-band tools */}
              <div>
                <Header
                  title="De-essing & Multiband"
                  sub="Dynamic taming of sibilance, plus three-band compression"
                />
                <div className="mt-3 grid grid-cols-3 md:grid-cols-7 gap-3">
                  {PRO_DSP_KEYS.map((k) => {
                    const m = SOUND_PARAM_META.find((x) => x.key === k)!;
                    return (
                      <Knob
                        key={k}
                        value={params[k]}
                        onChange={(v) => setParam(k, v)}
                        size={70}
                        color={m.color}
                        label={m.label}
                        hint={m.hint}
                        bipolar={m.bipolar !== false}
                      />
                    );
                  })}
                </div>
              </div>

              {/* HRTF Rooms */}
              <div>
                <Header
                  title="Out-of-head Rooms"
                  sub="Simulated speakers in a real space. Tiny mix amounts go a long way."
                />
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <div className="flex gap-2 flex-wrap">
                    {ROOM_OPTIONS.map((r) => (
                      <button
                        key={r.id}
                        onClick={() => setRoom(r.id)}
                        className={`rounded-xl border px-3 py-2 text-left transition ${
                          room === r.id
                            ? "border-cyan/60 bg-cyan/10"
                            : "border-white/10 hover:border-white/25"
                        }`}
                      >
                        <div className="text-sm font-semibold">{r.name}</div>
                        <div className="text-[10px] text-dim">{r.blurb}</div>
                      </button>
                    ))}
                  </div>
                  <div className="flex-1 min-w-[200px]">
                    <div className="text-[10px] uppercase tracking-[0.3em] text-dim mb-1">
                      Wet / Dry
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.001}
                      value={roomMix}
                      onChange={(e) => setRoomMix(Number(e.target.value))}
                      disabled={room === "off"}
                      className="w-full accent-plasma h-6"
                    />
                    <div className="text-[11px] text-dim text-right">
                      {Math.round(roomMix * 100)}%
                    </div>
                  </div>
                </div>
              </div>

              {/* L/R Balance */}
              <div>
                <Header
                  title="L / R Balance & Delay"
                  sub="Per-ear gain (dB) and inter-aural delay (ms). Useful for asymmetric hearing."
                />
                <div className="mt-3 grid grid-cols-3 gap-4">
                  <SliderRow
                    label="Left dB"
                    min={-12}
                    max={6}
                    step={0.1}
                    value={balanceLDb}
                    onChange={(v) => setBalance(v, balanceRDb, balanceDelayMs)}
                    suffix="dB"
                  />
                  <SliderRow
                    label="Right dB"
                    min={-12}
                    max={6}
                    step={0.1}
                    value={balanceRDb}
                    onChange={(v) => setBalance(balanceLDb, v, balanceDelayMs)}
                    suffix="dB"
                  />
                  <SliderRow
                    label="ITD"
                    min={-2}
                    max={2}
                    step={0.05}
                    value={balanceDelayMs}
                    onChange={(v) => setBalance(balanceLDb, balanceRDb, v)}
                    suffix="ms"
                  />
                </div>
                <button
                  onClick={() => setBalance(0, 0, 0)}
                  className="mt-2 text-[11px] text-dim hover:text-cyan transition"
                >
                  Reset balance & delay
                </button>
              </div>

              {/* LUFS Meter */}
              <div>
                <Header
                  title="Loudness Meter (LUFS)"
                  sub="ITU-R BS.1770. Spotify's reference is -14. Below -20 = quiet, above -10 = loud."
                />
                <div className="mt-3 grid grid-cols-3 gap-3">
                  <LufsCard label="Momentary" value={lufs.momentary} />
                  <LufsCard label="Short-term" value={lufs.short} />
                  <LufsCard label="Integrated" value={lufs.integrated} />
                </div>
                <button
                  onClick={() => getEngine().lufs.reset()}
                  className="mt-2 text-[11px] text-dim hover:text-cyan transition"
                >
                  Reset integrated
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </GlassPanel>
  );
}

function Header({ title, sub }: { title: string; sub: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.3em] text-cyan/80">{title}</div>
      <div className="text-sm text-white/85 mt-0.5">{sub}</div>
    </div>
  );
}

function SliderRow({
  label,
  min,
  max,
  step,
  value,
  onChange,
  suffix,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] uppercase tracking-[0.3em] text-dim">{label}</div>
        <div className="text-xs font-mono text-cyan">{value.toFixed(2)} {suffix}</div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-cyan h-6"
      />
    </div>
  );
}

function LufsCard({ label, value }: { label: string; value: number }) {
  const color = value > -10 ? "#ff5b8a" : value > -16 ? "#ffb648" : value > -24 ? "#22e8ff" : "#7a3bff";
  const disp = value < -119 ? "—" : value.toFixed(1);
  return (
    <div className="rounded-xl border border-white/10 p-3 bg-black/30">
      <div className="text-[10px] uppercase tracking-[0.3em] text-dim">{label}</div>
      <div className="text-2xl font-mono font-bold" style={{ color }}>{disp}</div>
      <div className="text-[10px] text-dim">LUFS</div>
    </div>
  );
}
