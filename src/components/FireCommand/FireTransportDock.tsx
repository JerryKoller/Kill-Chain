/**
 * FireTransportDock — Open Fire transport pinned where Kill-Chain's Track Loaded
 * bar normally sits. Visible whenever the Fire Command tab is active so Synth
 * and Sequencer share one play/pause control.
 */

import { useMemo, useEffect } from "react";
import { useFireSequencerStore } from "@/state/fireSequencerStore";
import { useFireCommandStore } from "@/state/fireCommandStore";
import { useUIStore } from "@/state/uiStore";
import { BpmInput } from "./BpmInput";
import { writeFold } from "./fireNavigate";
import {
  SEQ,
  SEQ_CTRL,
  SEQ_GROUP_LABEL,
  SEQ_HINT,
  SeqGroup,
  SeqSegment,
  SeqSegmented,
} from "./seqChrome";

const BRASS = SEQ.brass;
const BRASS_SOFT = SEQ.brassSoft;
const BRASS_GLOW = "rgba(232,184,109,0.35)";

function SwingControls() {
  const swing = useFireSequencerStore((s) => s.swing);
  const swingDrums = useFireSequencerStore((s) => s.swingDrums);
  const swingSamples = useFireSequencerStore((s) => s.swingSamples);
  const swingLinked = useFireSequencerStore((s) => s.swingLinked);
  const setSwing = useFireSequencerStore((s) => s.setSwing);
  const setSwingDrums = useFireSequencerStore((s) => s.setSwingDrums);
  const setSwingSamples = useFireSequencerStore((s) => s.setSwingSamples);
  const setSwingLinked = useFireSequencerStore((s) => s.setSwingLinked);

  const slider = (
    label: string,
    value: number,
    onChange: (v: number) => void,
    title: string,
  ) => (
    <div className="flex items-center gap-1.5" title={title}>
      <span className="text-[10px] uppercase tracking-[0.08em] text-white/55 w-8 text-right">{label}</span>
      <input
        type="range"
        min={0}
        max={0.6}
        step={0.02}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-[58px] accent-[#e8b86d]"
        aria-label={`${label} swing ${Math.round(value * 100)} percent`}
      />
      <span className="text-[11px] font-mono tabular-nums text-[rgba(245,217,168,0.85)] w-8">
        {Math.round(value * 100)}%
      </span>
    </div>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={SEQ_GROUP_LABEL} title="Delays every off-beat 16th for groove">
        Swing
      </span>
      <button
        type="button"
        onClick={() => setSwingLinked(!swingLinked)}
        className={`${SEQ_CTRL} !h-7 !px-2 text-[10px]`}
        style={
          swingLinked
            ? { color: "rgba(255,255,255,0.65)", background: "rgba(255,255,255,0.06)" }
            : { color: BRASS_SOFT, background: "rgba(232,184,109,0.16)", borderColor: "rgba(232,184,109,0.45)" }
        }
        title={
          swingLinked
            ? "Linked: one groove for everything. Split copies this value to drums and samples so they don't jump."
            : "Unlinked: melody, drums and samples each swing on their own. Link copies melody swing onto all groups."
        }
        aria-pressed={!swingLinked}
        aria-label={swingLinked ? "Unlink swing groups" : "Link swing groups"}
      >
        {swingLinked ? "Link" : "Split"}
      </button>
      {swingLinked ? (
        <div className="flex items-center gap-2" title="Delays every off-beat 16th for groove (all groups)">
          <input
            type="range"
            min={0}
            max={0.6}
            step={0.02}
            value={swing}
            onChange={(e) => setSwing(Number(e.target.value))}
            className="w-[88px] accent-[#e8b86d]"
            aria-label={`Swing ${Math.round(swing * 100)} percent`}
          />
          <span className="text-[11px] font-mono tabular-nums text-[rgba(245,217,168,0.9)] min-w-[2.25rem]">
            {Math.round(swing * 100)}%
          </span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {slider("Mel", swing, setSwing, "Swing on the piano-roll notes (Synth A + B)")}
          {slider("Drm", swingDrums, setSwingDrums, "Swing on the drum kit lanes")}
          {slider("Smp", swingSamples, setSwingSamples, "Swing on the sample deck lanes")}
        </div>
      )}
    </div>
  );
}

export function FireTransportDock() {
  const playing = useFireSequencerStore((s) => s.playing);
  const bpm = useFireSequencerStore((s) => s.bpm);
  const synthEnabled = useFireSequencerStore((s) => s.synthEnabled);
  const drumsEnabled = useFireSequencerStore((s) => s.drumsEnabled);
  const synthBEnabled = useFireSequencerStore((s) => s.synthBEnabled);
  const drumLevel = useFireSequencerStore((s) => s.drumLevel);
  const togglePlay = useFireSequencerStore((s) => s.togglePlay);
  const stop = useFireSequencerStore((s) => s.stop);
  const setBpm = useFireSequencerStore((s) => s.setBpm);
  const setSynthEnabled = useFireSequencerStore((s) => s.setSynthEnabled);
  const setDrumsEnabled = useFireSequencerStore((s) => s.setDrumsEnabled);
  const setSynthBEnabled = useFireSequencerStore((s) => s.setSynthBEnabled);
  const setDrumLevel = useFireSequencerStore((s) => s.setDrumLevel);
  const playScope = useFireSequencerStore((s) => s.playScope);
  const setPlayScope = useFireSequencerStore((s) => s.setPlayScope);
  const recording = useFireSequencerStore((s) => s.recording);
  const recordQuantize = useFireSequencerStore((s) => s.recordQuantize);
  const recordMode = useFireSequencerStore((s) => s.recordMode);
  const recordCountIn = useFireSequencerStore((s) => s.recordCountIn);
  const metronome = useFireSequencerStore((s) => s.metronome);
  const setRecording = useFireSequencerStore((s) => s.setRecording);
  const setRecordQuantize = useFireSequencerStore((s) => s.setRecordQuantize);
  const setRecordMode = useFireSequencerStore((s) => s.setRecordMode);
  const setRecordCountIn = useFireSequencerStore((s) => s.setRecordCountIn);
  const setMetronome = useFireSequencerStore((s) => s.setMetronome);
  const notes = useFireSequencerStore((s) => s.notes);
  const selectionStart = useFireSequencerStore((s) => s.selectionStart);
  const selectionEnd = useFireSequencerStore((s) => s.selectionEnd);
  const toast = useUIStore((s) => s.toast);
  const panic = useFireCommandStore((s) => s.panic);

  const hasLoopSelection = useMemo(() => {
    if (selectionEnd <= selectionStart) return false;
    return notes.some((n) => n.step + n.len > selectionStart && n.step < selectionEnd);
  }, [notes, selectionStart, selectionEnd]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (
        el instanceof HTMLInputElement
        || el instanceof HTMLTextAreaElement
        || el instanceof HTMLSelectElement
        || (el instanceof HTMLElement && el.isContentEditable)
      ) return;
      if (e.code === "Space" || e.key === " ") {
        if (e.repeat) return;
        const focus = document.activeElement;
        if (
          focus instanceof HTMLElement
          && focus.closest("[data-pattern-id], [role=option], [data-fire-pattern-chip]")
        ) {
          return;
        }
        // Don't steal Space from focused chrome buttons (Cap / File / Append…).
        if (
          focus instanceof HTMLElement
          && focus.closest("button, [role=button], [role=menuitem]")
          && !focus.closest("[data-fire-transport-play]")
        ) {
          return;
        }
        e.preventDefault();
        togglePlay();
      } else if (e.key === "Escape") {
        // Only hard-cut when transport is live — otherwise editors use Escape
        // to clear selection / close menus without silencing the session.
        if (!playing) return;
        // …and even then, let the editors consume Escape FIRST. Panic used to
        // win unconditionally during playback, so dismissing a note selection,
        // a clip placement or an open menu killed the audio instead. Those
        // handlers run on the same keydown and mark it handled; if none of
        // them wanted it, we stop.
        if (e.defaultPrevented) return;
        const t = e.target instanceof Element ? e.target : null;
        const inEditor = !!t?.closest("[data-fire-piano-roll], [data-fire-arrangement]");
        const editorHot = !!document.querySelector(
          "[data-fire-piano-roll]:hover, [data-fire-arrangement]:hover",
        );
        const editorFocused = !!document.activeElement?.closest?.(
          "[data-fire-piano-roll], [data-fire-arrangement]",
        );
        if (inEditor || editorHot || editorFocused) return;
        e.preventDefault();
        stop();
        panic();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, stop, panic, playing]);

  const toggleLoopScope = () => {
    if (!hasLoopSelection) {
      toast("Selection empty — select notes to loop a range");
      return;
    }
    setPlayScope(playScope === "selection" ? "pattern" : "selection");
  };

  return (
    <div className="px-4 pb-4 shrink-0">
      <div
        className="relative overflow-hidden rounded-2xl"
        style={{
          border: "1px solid rgba(232,184,109,0.22)",
          background: "linear-gradient(180deg, #16120e 0%, #0e0c0a 100%)",
          boxShadow: playing
            ? `0 0 0 1px rgba(0,0,0,0.35) inset, 0 8px 28px rgba(0,0,0,0.3), 0 0 40px ${BRASS_GLOW}`
            : "0 0 0 1px rgba(0,0,0,0.35) inset, 0 8px 28px rgba(0,0,0,0.28)",
        }}
        role="region"
        aria-label="Fire Command transport"
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: playing
              ? "radial-gradient(ellipse 55% 140% at 10% 50%, rgba(232,184,109,0.2), transparent 55%), radial-gradient(ellipse 40% 100% at 90% 50%, rgba(232,184,109,0.08), transparent 50%)"
              : "radial-gradient(ellipse 50% 120% at 50% 0%, rgba(232,184,109,0.1), transparent 55%)",
          }}
        />
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{ background: "linear-gradient(90deg, transparent, rgba(245,217,168,0.4), transparent)" }}
        />

        <div className="relative z-10 seq-header !px-3 !py-2">
          <div className="seq-header__primary">
            <div className="seq-header__transport">
              <div className="seq-header__cluster">
                <button
                  type="button"
                  data-fire-transport-play
                  onClick={togglePlay}
                  className="relative h-9 px-4 rounded-lg font-black text-[12px] uppercase tracking-[0.1em] transition overflow-hidden shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[rgba(232,184,109,0.65)] cursor-pointer"
                  style={
                    playing
                      ? {
                          color: "#1a1208",
                          background: `linear-gradient(145deg, ${BRASS_SOFT}, ${BRASS})`,
                          boxShadow: `0 0 20px ${BRASS_GLOW}, inset 0 1px 0 rgba(255,255,255,0.35)`,
                        }
                      : {
                          color: BRASS_SOFT,
                          background: "rgba(232,184,109,0.12)",
                          boxShadow: "inset 0 0 0 1px rgba(232,184,109,0.45)",
                        }
                  }
                  title={`Open Fire — play/stop ${playScope}`}
                  aria-pressed={playing}
                >
                  {playing && (
                    <span
                      className="pointer-events-none absolute inset-0 opacity-60 animate-[evolve-breathe_1.8s_ease-in-out_infinite]"
                      style={{ background: "radial-gradient(circle at 30% 40%, rgba(255,255,255,0.45), transparent 55%)" }}
                    />
                  )}
                  <span className="relative inline-flex items-center gap-2">
                    <span aria-hidden>{playing ? "■" : "▶"}</span>
                    {playing ? "Hold Fire" : "Open Fire"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (playing) stop();
                    panic();
                    toast("Cease Fire — all notes + FX cut");
                  }}
                  className="h-9 px-2.5 rounded-lg text-[10px] font-black uppercase tracking-[0.08em] transition shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-rose-400/60 cursor-pointer"
                  style={{
                    color: "rgba(254,202,202,0.9)",
                    background: "rgba(244,63,94,0.12)",
                    boxShadow: "inset 0 0 0 1px rgba(244,63,94,0.4)",
                  }}
                  title="Panic — immediately silence synths, drums, and FX tails"
                  aria-label="Panic silence"
                >
                  Panic
                </button>
              </div>

              <SeqGroup label="Target">
                <SeqSegmented aria-label="Play target">
                  {([
                    { id: "pattern" as const, label: "Pattern" },
                    { id: "arrangement" as const, label: "Arrangement" },
                    { id: "selection" as const, label: "Selection" },
                  ]).map((opt) => (
                    <SeqSegment
                      key={opt.id}
                      brass
                      active={playScope === opt.id}
                      onClick={() => {
                        setPlayScope(opt.id);
                        if (opt.id === "pattern") {
                          writeFold("seq.patterns", false);
                          writeFold("seq.arrangement", true);
                          writeFold("seq.editor", false);
                        } else if (opt.id === "arrangement") {
                          writeFold("seq.patterns", true);
                          writeFold("seq.arrangement", false);
                          writeFold("seq.editor", true);
                        } else {
                          writeFold("seq.patterns", true);
                          writeFold("seq.arrangement", true);
                          writeFold("seq.editor", false);
                        }
                      }}
                      title={`Play target: ${opt.label} — expands that section`}
                    >
                      {opt.label}
                    </SeqSegment>
                  ))}
                </SeqSegmented>
              </SeqGroup>

              <div className="seq-header__cluster" role="group" aria-label="Transport">
                <button
                  type="button"
                  onClick={toggleLoopScope}
                  className={SEQ_CTRL}
                  style={
                    playScope === "selection"
                      ? {
                          color: "#1a1208",
                          background: `linear-gradient(145deg, ${BRASS_SOFT}, ${BRASS})`,
                          borderColor: "rgba(232,184,109,0.55)",
                          fontWeight: 700,
                        }
                      : undefined
                  }
                  title={
                    hasLoopSelection
                      ? "Loop the selected note range (toggle selection scope)"
                      : "Pattern / arrangement always loop — select notes to loop a range"
                  }
                  aria-pressed={playScope === "selection"}
                >
                  {playScope === "selection" ? "● Loop" : "Loop"}
                </button>

                <button
                  type="button"
                  onClick={() => setRecording(!recording)}
                  className="h-8 px-3 rounded-lg font-bold text-[11px] uppercase tracking-[0.08em] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-rose-400/60 cursor-pointer inline-flex items-center gap-1.5"
                  style={
                    recording
                      ? {
                          color: "#fecdd3",
                          background: "rgba(244,63,94,0.28)",
                          boxShadow: "0 0 14px rgba(244,63,94,0.35), inset 0 0 0 1px rgba(244,63,94,0.75)",
                          fontWeight: 800,
                        }
                      : {
                          color: "rgba(255,255,255,0.55)",
                          background: "rgba(0,0,0,0.28)",
                          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12)",
                        }
                  }
                  title="Arm record: while playing, everything you play lands in the piano roll"
                  aria-pressed={recording}
                  aria-label={recording ? "Disarm record" : "Arm record"}
                >
                  <span
                    aria-hidden
                    className="w-1.5 h-1.5 rounded-full"
                    style={{
                      background: recording ? "#fb7185" : "rgba(255,255,255,0.35)",
                      boxShadow: recording ? "0 0 8px #fb7185" : undefined,
                    }}
                  />
                  Rec
                </button>

                <div
                  className="flex items-center gap-1.5 rounded-lg px-2.5 h-8"
                  style={{ background: "rgba(0,0,0,0.35)", boxShadow: "inset 0 0 0 1px rgba(232,184,109,0.2)" }}
                >
                  <span className={SEQ_GROUP_LABEL}>BPM</span>
                  <BpmInput
                    value={bpm}
                    onCommit={setBpm}
                    className="w-[52px] h-6 rounded-md bg-black/40 px-1 text-[13px] font-mono text-center outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-[rgba(232,184,109,0.65)]"
                    style={{ color: BRASS_SOFT, boxShadow: "inset 0 0 0 1px rgba(232,184,109,0.22)" }}
                  />
                </div>
              </div>

              {recording && (
                <div className="seq-header__cluster">
                  <button
                    type="button"
                    onClick={() => setRecordMode(recordMode === "overdub" ? "replace" : "overdub")}
                    className={SEQ_CTRL}
                    title="Toggle overdub vs replace"
                  >
                    {recordMode === "replace" ? "Replace" : "Overdub"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRecordCountIn((recordCountIn + 1) % 5)}
                    className={SEQ_CTRL}
                    title="Count-in bars"
                  >
                    {recordCountIn === 0 ? "No count-in" : `${recordCountIn} bar count-in`}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMetronome(!metronome)}
                    className={SEQ_CTRL}
                    style={metronome ? { borderColor: "rgba(251,191,36,0.45)", color: "#fde68a" } : undefined}
                    aria-pressed={metronome}
                  >
                    Metro
                  </button>
                  <button
                    type="button"
                    onClick={() => setRecordQuantize(!recordQuantize)}
                    className={SEQ_CTRL}
                    style={
                      recordQuantize
                        ? { color: BRASS_SOFT, background: "rgba(232,184,109,0.16)", borderColor: "rgba(232,184,109,0.45)" }
                        : undefined
                    }
                    title="Quantize captured notes to the 1/16 grid"
                    aria-pressed={recordQuantize}
                  >
                    ⧗ 1/16
                  </button>
                  <span className={`${SEQ_HINT} font-mono text-rose-200/80`}>
                    REC · {recordMode.toUpperCase()}
                    {recordCountIn > 0 ? ` · ${recordCountIn}b IN` : " · NO IN"}
                    {" · "}
                    {recordQuantize ? "1/16" : "FREE"}
                  </span>
                </div>
              )}

              <SwingControls />
            </div>

            <div className="seq-header__layers">
              <SeqGroup label="Layers" hint="arm · mute">
                <div
                  className="inline-flex items-center gap-1 rounded-lg p-1"
                  style={{ background: "rgba(0,0,0,0.35)", boxShadow: "inset 0 0 0 1px rgba(232,184,109,0.18)" }}
                  role="group"
                  aria-label="Layer arm / mute"
                >
                  {([
                    { on: synthEnabled, toggle: () => setSynthEnabled(!synthEnabled), label: "A", accent: "#ff8f6b", soft: "#ffd0c0", title: "Synth A — click to arm or mute", name: "Synth A" },
                    { on: synthBEnabled, toggle: () => setSynthBEnabled(!synthBEnabled), label: "B", accent: "#7dd3fc", soft: "#e0f2fe", title: "Synth B — click to arm or mute", name: "Synth B" },
                    { on: drumsEnabled, toggle: () => setDrumsEnabled(!drumsEnabled), label: "DRM", accent: "#bef264", soft: "#ecfccb", title: "Drums — click to arm or mute", name: "Drums" },
                  ] as const).map((ch) => (
                    <button
                      key={ch.label}
                      type="button"
                      onClick={ch.toggle}
                      className="h-8 min-w-[2.75rem] px-2.5 rounded-md text-[11px] font-black tracking-wide transition inline-flex items-center justify-center gap-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[rgba(232,184,109,0.65)] cursor-pointer"
                      style={
                        ch.on
                          ? { color: ch.soft, background: `${ch.accent}22`, boxShadow: `inset 0 0 0 1px ${ch.accent}70, 0 0 10px ${ch.accent}28` }
                          : { color: "rgba(255,255,255,0.38)", background: "transparent", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)" }
                      }
                      title={ch.title}
                      aria-pressed={ch.on}
                      aria-label={`${ch.name} ${ch.on ? "armed" : "muted"}`}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ background: ch.on ? ch.accent : "rgba(255,255,255,0.22)", boxShadow: ch.on ? `0 0 6px ${ch.accent}` : undefined }}
                        aria-hidden
                      />
                      {ch.label}
                    </button>
                  ))}
                </div>
              </SeqGroup>
              <input
                type="range"
                min={0}
                max={1.2}
                step={0.02}
                value={drumLevel}
                onChange={(e) => setDrumLevel(Number(e.target.value))}
                className="w-[64px] accent-[#bef264]"
                title="Drum layer level"
                aria-label="Drum layer level"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
