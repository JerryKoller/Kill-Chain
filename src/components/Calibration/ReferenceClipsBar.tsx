import { useEffect, useRef, useState } from "react";
import { getEngine } from "@/audio/AudioEngine";
import { CLIPS, getReferenceBuffer, type ClipId } from "@/audio/ReferenceClips";
import { useAudioStore } from "@/state/audioStore";
import { useUIStore } from "@/state/uiStore";

export function ReferenceClipsBar() {
  const [playing, setPlaying] = useState<ClipId | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const playGen = useRef(0);
  const toast = useUIStore((s) => s.toast);

  useEffect(
    () => () => {
      playGen.current += 1;
      stopRef.current?.();
    },
    [],
  );

  const play = (id: ClipId, loop: boolean) => {
    stopRef.current?.();
    const gen = ++playGen.current;
    void (async () => {
      try {
        await useAudioStore.getState().ensureReady();
        if (gen !== playGen.current) return;
        const eng = getEngine();
        const buf = getReferenceBuffer(eng.ctx, id);
        stopRef.current = eng.playBuffer(buf, { loop, gainDb: -6 });
        setPlaying(id);
        toast(`Playing ${CLIPS.find((c) => c.id === id)?.name ?? id}`);
        if (!loop) {
          window.setTimeout(() => {
            if (gen !== playGen.current) return;
            setPlaying(null);
            stopRef.current = null;
          }, Math.ceil(buf.duration * 1000) + 40);
        }
      } catch {
        if (gen !== playGen.current) return;
        toast("Couldn't start clip — engine not ready");
      }
    })();
  };

  const stop = () => {
    playGen.current += 1;
    stopRef.current?.();
    stopRef.current = null;
    setPlaying(null);
  };

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-[10px] uppercase tracking-[0.3em] text-dim">
          Reference clips
        </div>
        <div className="text-[10px] text-dim">
          Synthesised in-app · play / loop through the full DSP chain
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {CLIPS.map((c) => {
          const active = playing === c.id;
          return (
            <div
              key={c.id}
              className={`group rounded-lg border px-2.5 py-1.5 flex items-center gap-2 ${
                active
                  ? "border-cyan/60 bg-cyan/10"
                  : "border-white/10 hover:border-white/25"
              }`}
            >
              <button
                type="button"
                onClick={() => (active ? stop() : play(c.id, false))}
                title={c.blurb}
                className="text-xs text-white/85 hover:text-cyan transition"
              >
                {c.name}
              </button>
              <button
                type="button"
                onClick={() => (active ? stop() : play(c.id, true))}
                title="Loop"
                className="text-[10px] text-dim hover:text-cyan"
              >
                {"\u21BB"}
              </button>
            </div>
          );
        })}
        {playing && (
          <button
            type="button"
            onClick={stop}
            className="rounded-lg border border-plasma/40 bg-plasma/10 text-plasma px-3 py-1.5 text-xs"
          >
            Stop
          </button>
        )}
      </div>
    </div>
  );
}
