import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GlassPanel } from "@/components/shared/GlassPanel";
import { Knob } from "@/components/shared/Knob";
import { useAudioStore } from "@/state/audioStore";

/**
 * Lo-Fi tape degradation — folded into the Playground as a collapsible
 * panel (formerly a standalone tool). Three unipolar knobs drive the
 * engine's LoFiDeck. At zero, the deck is a bit-transparent dry wire.
 */
export function LoFiPanel() {
  const [open, setOpen] = useState(false);
  const params = useAudioStore((s) => s.params);
  const setParam = useAudioStore((s) => s.setParam);

  const active = params.lofiAge > 0 || params.lofiWear > 0 || params.lofiWowFlutter > 0;

  return (
    <GlassPanel intense className="p-0 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-5 py-3 flex items-center justify-between hover:bg-white/[0.03] transition"
      >
        <div className="text-left">
          <div className="text-xs uppercase tracking-[0.3em] text-dim flex items-center gap-2">
            Lo-Fi Tape Deck
            {active && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#ffb648]/20 text-[#ffb648] tracking-normal">
                ON
              </span>
            )}
          </div>
          <div className="text-base font-semibold">
            Age · Wow &amp; Flutter · Wear — magnetic tape character
          </div>
        </div>
        <div className="text-sm text-[#ffb648]/80 font-mono">{open ? "\u25BC" : "\u25B6"}</div>
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
            <div className="p-6 flex flex-wrap justify-around items-start gap-6">
              <LoFiKnob
                value={params.lofiAge}
                onChange={(v) => setParam("lofiAge", v)}
                color="#ffb648"
                label="Age"
                hint="Bandwidth reduction & filter wear"
                blurb="Rolls off highs and thins the lows, mimicking old tape formulas."
              />
              <LoFiKnob
                value={params.lofiWowFlutter}
                onChange={(v) => setParam("lofiWowFlutter", v)}
                color="#ff6f3c"
                label="Wow & Flutter"
                hint="Pitch instability"
                blurb="Slow pitch drift (wow) plus fast mechanical wobble (flutter)."
              />
              <LoFiKnob
                value={params.lofiWear}
                onChange={(v) => setParam("lofiWear", v)}
                color="#c87a3a"
                label="Wear & Noise"
                hint="Crackle and hiss"
                blurb="Background hiss and random crackles from dust and wear."
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </GlassPanel>
  );
}

function LoFiKnob({
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
