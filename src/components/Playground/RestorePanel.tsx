import { useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GlassPanel } from "@/components/shared/GlassPanel";
import { Knob } from "@/components/shared/Knob";
import { useAudioStore } from "@/state/audioStore";
import { useUIStore } from "@/state/uiStore";
import { restoreActive } from "@/audio/dsp/Reconstructor";
import { analyzeForRestore } from "@/lib/restoreAnalyze";

/**
 * Restoration Bay — repairs damaged / low-bitrate audio (240p-era YouTube
 * rips, crushed encodes) live in the chain:
 *
 *   HF Rebuild   regenerates the brickwalled top octave (the "HD guess"),
 *   Body         restores low-end density to thin rips,
 *   De-crunch    dynamically ducks codec harshness in 2.5-6 kHz,
 *   Hiss Tamer   closes a dynamic shelf on steady noise floors.
 *
 * "Auto-read" listens to what's playing for ~3 s, finds the brickwall
 * cutoff / thinness / crunch, and sets the knobs for you.
 */
export function RestorePanel() {
  const [open, setOpen] = useState(false);
  const restore = useAudioStore((s) => s.restore);
  const setRestore = useAudioStore((s) => s.setRestore);
  const toast = useUIStore((s) => s.toast);
  const [reading, setReading] = useState(false);
  const [readout, setReadout] = useState<string[] | null>(null);
  const readAbort = useRef<AbortController | null>(null);

  const active = restoreActive(restore);

  const autoRead = async () => {
    if (reading) {
      readAbort.current?.abort();
      return;
    }
    setReading(true);
    setReadout(null);
    const ac = new AbortController();
    readAbort.current = ac;
    try {
      const res = await analyzeForRestore(3, ac.signal);
      if (!res) {
        toast("Heard nothing — play the damaged source, then Auto-read again");
        setReadout(["No audible signal while listening."]);
      } else {
        if (Object.keys(res.params).length > 0) setRestore(res.params);
        setReadout(res.notes);
        toast("Restoration Bay calibrated to the source");
      }
    } catch {
      /* cancelled */
    } finally {
      setReading(false);
    }
  };

  return (
    <GlassPanel intense className="p-0 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-5 py-3 flex items-center justify-between hover:bg-white/[0.03] transition"
      >
        <div className="text-left">
          <div className="text-xs uppercase tracking-[0.3em] text-dim flex items-center gap-2">
            Restoration Bay
            {active && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-400/20 text-emerald-300 tracking-normal">
                ON
              </span>
            )}
          </div>
          <div className="text-base font-semibold">
            Rebuild bad audio — HD-guess upscaling for low-bitrate uploads
          </div>
        </div>
        <div className="text-sm text-emerald-300/80 font-mono">{open ? "\u25BC" : "\u25B6"}</div>
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
            <div className="p-6">
              <div className="flex items-center gap-3 flex-wrap mb-5">
                <button
                  onClick={() => void autoRead()}
                  className={`rounded-xl border px-4 py-2.5 text-sm font-semibold transition ${
                    reading
                      ? "border-amber-400/60 bg-amber-400/10 text-amber-300"
                      : "border-emerald-400/50 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300"
                  }`}
                  title="Listen to what's playing for ~3 seconds, measure the damage (brickwall cutoff, thinness, codec crunch) and set the knobs automatically"
                >
                  {reading ? "◉ Listening… (click to cancel)" : "◉ Auto-read the damage"}
                </button>
                <button
                  onClick={() => {
                    setRestore({ hf: 0, body: 0, decrunch: 0, hiss: 0 });
                    setReadout(null);
                  }}
                  className="rounded-xl border border-white/15 bg-white/[0.03] hover:bg-white/[0.06] px-4 py-2.5 text-sm font-semibold transition"
                >
                  Reset
                </button>
                <div className="text-[11px] text-dim leading-relaxed flex-1 min-w-[200px]">
                  Play the damaged source (a routed YouTube video works), hit Auto-read, then
                  fine-tune by ear. Everything here is real-time — nothing is re-encoded.
                </div>
              </div>

              {readout && (
                <div className="mb-5 rounded-xl border border-emerald-400/20 bg-emerald-500/[0.06] px-3 py-2">
                  <ul className="text-[11px] text-white/75 leading-relaxed list-disc list-inside">
                    {readout.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex flex-wrap justify-around items-start gap-6">
                <RestoreKnob
                  value={restore.hf}
                  onChange={(v) => setRestore({ hf: v })}
                  color="#48ffd1"
                  label="HF Rebuild"
                  hint="Regenerate the missing top octaves"
                  blurb="The HD guess: a two-stage harmonic ladder climbs from whatever survived — even a 4 kHz-muffled rip rebuilds to 16 kHz."
                />
                <RestoreKnob
                  value={restore.body}
                  onChange={(v) => setRestore({ body: v })}
                  color="#5b6bff"
                  label="Body"
                  hint="Restore low-end density"
                  blurb="Saturates the 60-200 Hz band back under the mix — weight without a boomy shelf."
                />
                <RestoreKnob
                  value={restore.decrunch}
                  onChange={(v) => setRestore({ decrunch: v })}
                  color="#ff8a48"
                  label="De-crunch"
                  hint="Duck codec harshness"
                  blurb="Dynamically tames the 2.5-6 kHz crunch of hard-clipped or over-compressed encodes."
                />
                <RestoreKnob
                  value={restore.hiss}
                  onChange={(v) => setRestore({ hiss: v })}
                  color="#a06bff"
                  label="Hiss Tamer"
                  hint="Close down steady noise floors"
                  blurb="A dynamic shelf that ducks constant hiss but opens instantly for real cymbals and air."
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </GlassPanel>
  );
}

function RestoreKnob({
  value,
  onChange,
  color,
  label,
  hint,
  blurb,
}: {
  value: number;
  onChange: (v: number) => void;
  color: string;
  label: string;
  hint: string;
  blurb: string;
}) {
  return (
    <div className="flex flex-col items-center">
      <Knob
        value={value}
        onChange={onChange}
        size={120}
        color={color}
        label={label}
        hint={hint}
        bipolar={false}
      />
      <div className="mt-4 max-w-[150px] text-center text-xs text-dim leading-relaxed">
        {blurb}
      </div>
    </div>
  );
}
