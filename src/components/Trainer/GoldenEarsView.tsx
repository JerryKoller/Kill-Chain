import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GlassPanel } from "@/components/shared/GlassPanel";
import { NeonButton } from "@/components/shared/NeonButton";
import { useUIStore } from "@/state/uiStore";
import {
  getEarTrainer,
  DIFFICULTIES,
  bandsForDifficulty,
  TRAINER_BANDS,
  type Difficulty,
  type TrainerBand,
} from "@/audio/EarTrainer";
import { CLIPS, type ClipId } from "@/audio/ReferenceClips";
import { useEarTrainerStore, rankForXp } from "@/state/earTrainerStore";

type Phase = "idle" | "playing" | "revealed" | "gameover";
type SourceId = ClipId | "custom";

const ROUNDS_PER_GAME = 10;

// Every synthesized reference clip is selectable so there's real variety to
// train against — broadband noise, tones, drums, vocals, pads and more.
const SOURCES: { id: ClipId; label: string }[] = CLIPS.map((c) => ({
  id: c.id,
  label: c.name,
}));

const DIFF_MULT: Record<string, number> = { rookie: 1, trained: 1.5, pro: 2, golden: 3 };

interface RoundResult {
  secret: TrainerBand;
  guess: TrainerBand | null;
  correct: boolean;
  adjacent: boolean;
  points: number;
}

export function GoldenEarsView() {
  const toast = useUIStore((s) => s.toast);
  const stats = useEarTrainerStore();

  const [phase, setPhase] = useState<Phase>("idle");
  const [difficulty, setDifficulty] = useState<Difficulty>(
    DIFFICULTIES.find((d) => d.id === stats.lastDifficulty) ?? DIFFICULTIES[1],
  );
  const [source, setSource] = useState<SourceId>("pink-noise");
  const [boosted, setBoosted] = useState(true);
  const [customName, setCustomName] = useState<string | null>(
    getEarTrainer().customTrackName(),
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [round, setRound] = useState(0);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [results, setResults] = useState<RoundResult[]>([]);
  const [secretIdx, setSecretIdx] = useState(0);
  const [guessIdx, setGuessIdx] = useState<number | null>(null);
  const [lastPoints, setLastPoints] = useState(0);

  const roundStartRef = useRef(0);
  const bands = useMemo(() => bandsForDifficulty(difficulty), [difficulty]);

  // Stop audio when leaving the view.
  useEffect(() => {
    return () => {
      getEarTrainer().stop();
    };
  }, []);

  const startRound = useCallback(
    (bandList: TrainerBand[], diff: Difficulty) => {
      const idx = Math.floor(Math.random() * bandList.length);
      const band = bandList[idx];
      const trainer = getEarTrainer();
      trainer.setRound(band.freq, diff.q, diff.boostDb);
      trainer.setBoosted(true);
      setSecretIdx(idx);
      setGuessIdx(null);
      setBoosted(true);
      setPhase("playing");
      roundStartRef.current = performance.now();
    },
    [],
  );

  const onPickTrack = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const onFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = ""; // allow re-picking the same file
      if (!file) return;
      try {
        const name = await getEarTrainer().loadCustomFile(file);
        setCustomName(name);
        setSource("custom");
        toast(`Loaded "${name}" for training`);
      } catch (err) {
        console.warn("Failed to decode training track:", err);
        toast("Could not load that audio file");
      }
    },
    [toast],
  );

  const startGame = useCallback(
    async (diff: Difficulty, src: SourceId) => {
      const trainer = getEarTrainer();
      await trainer.start(src);
      stats.recordGameStart(diff.id);
      setScore(0);
      setStreak(0);
      setResults([]);
      setRound(1);
      const list = bandsForDifficulty(diff);
      startRound(list, diff);
    },
    [stats, startRound],
  );

  const toggleBoost = useCallback(() => {
    setBoosted((b) => {
      const next = !b;
      getEarTrainer().setBoosted(next);
      return next;
    });
  }, []);

  const makeGuess = useCallback(
    (idx: number) => {
      if (phase !== "playing") return;
      const correct = idx === secretIdx;
      const adjacent = Math.abs(idx - secretIdx) === 1;
      const elapsed = (performance.now() - roundStartRef.current) / 1000;
      const speed = Math.max(0, 1 - elapsed / 12);
      const newStreak = correct ? streak + 1 : 0;
      const streakMult = 1 + Math.min(newStreak, 5) * 0.2;
      const base = correct ? 100 : adjacent ? 40 : 0;
      const points = Math.round(
        base * (DIFF_MULT[difficulty.id] ?? 1) * (1 + speed * 0.5) * (correct ? streakMult : 1),
      );

      // Make sure they can hear the boost on reveal.
      getEarTrainer().setBoosted(true);
      setBoosted(true);

      setGuessIdx(idx);
      setStreak(newStreak);
      setScore((s) => s + points);
      setLastPoints(points);
      setResults((r) => [
        ...r,
        { secret: bands[secretIdx], guess: bands[idx], correct, adjacent, points },
      ]);
      stats.recordRound({ bandId: bands[secretIdx].id, correct, points, streak: newStreak });
      setPhase("revealed");

      if (correct && newStreak >= 3) {
        toast(`Streak ×${newStreak} — +${points}`);
      }
    },
    [phase, secretIdx, streak, difficulty.id, bands, stats, toast],
  );

  const nextRound = useCallback(() => {
    if (round >= ROUNDS_PER_GAME) {
      getEarTrainer().stop();
      setPhase("gameover");
      return;
    }
    setRound((r) => r + 1);
    startRound(bands, difficulty);
  }, [round, bands, difficulty, startRound]);

  const quitToMenu = useCallback(() => {
    getEarTrainer().stop();
    setPhase("idle");
  }, []);

  // Keyboard shortcuts while playing/revealed.
  useEffect(() => {
    if (phase !== "playing" && phase !== "revealed") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " ") {
        e.preventDefault();
        if (phase === "playing") toggleBoost();
      } else if (e.key === "Enter") {
        if (phase === "revealed") nextRound();
      } else if (/^[0-9]$/.test(e.key) && phase === "playing") {
        const n = e.key === "0" ? 9 : parseInt(e.key, 10) - 1;
        if (n < bands.length) makeGuess(n);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, bands.length, toggleBoost, nextRound, makeGuess]);

  const rank = rankForXp(stats.xp);
  const rankInto = Math.max(0, Math.min(1,
    (stats.xp - rank.levelStart) / Math.max(1, rank.nextAt - rank.levelStart),
  ));
  const accuracy = stats.rounds > 0 ? Math.round((stats.correct / stats.rounds) * 100) : 0;

  return (
    <div className="flex flex-col gap-3 pb-4">
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={onFileChange}
      />
      {/* Header */}
      <div className="sticky top-0 z-20 -mx-4 px-4 pt-3 pb-2 bg-ink/85 backdrop-blur-md border-b border-white/[0.05]">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.3em] text-dim">
              Golden Ears
            </div>
            <div className="text-sm text-white/70 truncate">
              Sharpen your ears to lock onto frequencies — the skill behind every great mix
            </div>
          </div>
          <RankBadge level={rank.level} title={rank.title} xp={stats.xp} into={rankInto} />
        </div>
      </div>

      <AnimatePresence mode="wait">
        {phase === "idle" && (
          <motion.div
            key="idle"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="flex flex-col gap-3"
          >
            <MenuScreen
              difficulty={difficulty}
              setDifficulty={setDifficulty}
              source={source}
              setSource={setSource}
              customName={customName}
              onPickTrack={onPickTrack}
              onStart={() => void startGame(difficulty, source)}
              accuracy={accuracy}
            />
          </motion.div>
        )}

        {(phase === "playing" || phase === "revealed") && (
          <motion.div
            key="game"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="flex flex-col gap-3"
          >
            <GameHud
              round={round}
              score={score}
              streak={streak}
              difficulty={difficulty}
              onQuit={quitToMenu}
            />

            <GlassPanel intense glow className="p-6">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.3em] text-dim">
                    {phase === "playing" ? "Listen & identify" : "Result"}
                  </div>
                  <div className="text-xl font-semibold">
                    {phase === "playing"
                      ? "Which band is boosted?"
                      : results[results.length - 1]?.correct
                        ? "Nailed it!"
                        : results[results.length - 1]?.adjacent
                          ? "So close — one band off"
                          : "Missed it"}
                  </div>
                </div>

                <ABControls boosted={boosted} onToggle={toggleBoost} disabled={phase === "revealed"} />
              </div>

              {/* Band buttons */}
              <div
                className="mt-5 grid gap-2"
                style={{ gridTemplateColumns: `repeat(${Math.min(bands.length, 10)}, minmax(0, 1fr))` }}
              >
                {bands.map((b, i) => (
                  <BandButton
                    key={b.id}
                    band={b}
                    index={i}
                    phase={phase}
                    isSecret={i === secretIdx}
                    isGuess={i === guessIdx}
                    onClick={() => makeGuess(i)}
                  />
                ))}
              </div>

              {/* Reveal detail */}
              <AnimatePresence>
                {phase === "revealed" && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-5 flex items-center justify-between flex-wrap gap-3">
                      <div className="text-sm text-white/75">
                        <span className="text-cyan font-semibold">
                          {bands[secretIdx].freq >= 1000
                            ? `${bands[secretIdx].freq / 1000} kHz`
                            : `${bands[secretIdx].freq} Hz`}
                        </span>{" "}
                        — {bands[secretIdx].character}.{" "}
                        {lastPoints > 0 ? (
                          <span className="text-lime">+{lastPoints} pts</span>
                        ) : (
                          <span className="text-white/40">no points</span>
                        )}
                      </div>
                      <NeonButton onClick={nextRound}>
                        {round >= ROUNDS_PER_GAME ? "See results →" : "Next round →"}
                      </NeonButton>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="mt-4 text-[11px] text-dim">
                Tip: tap <kbd className="px-1 rounded bg-white/10">Space</kbd> to A/B flat vs boosted ·
                number keys to guess · <kbd className="px-1 rounded bg-white/10">Enter</kbd> for next
              </div>
            </GlassPanel>
          </motion.div>
        )}

        {phase === "gameover" && (
          <motion.div
            key="over"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
          >
            <GameOver
              score={score}
              results={results}
              onPlayAgain={() => void startGame(difficulty, source)}
              onMenu={quitToMenu}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RankBadge({ level, title, xp, into }: { level: number; title: string; xp: number; into: number }) {
  return (
    <div className="flex items-center gap-3">
      <div className="text-right">
        <div className="text-[10px] uppercase tracking-widest text-dim">Lv {level}</div>
        <div className="text-sm font-semibold neon-text">{title}</div>
      </div>
      <div className="w-28">
        <div className="h-2 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{
              width: `${into * 100}%`,
              background: "linear-gradient(90deg,#22e8ff,#7a3bff,#ff2bd6)",
            }}
          />
        </div>
        <div className="text-[9px] text-dim mt-1 text-right">{xp} XP</div>
      </div>
    </div>
  );
}

function MenuScreen({
  difficulty,
  setDifficulty,
  source,
  setSource,
  customName,
  onPickTrack,
  onStart,
  accuracy,
}: {
  difficulty: Difficulty;
  setDifficulty: (d: Difficulty) => void;
  source: SourceId;
  setSource: (c: SourceId) => void;
  customName: string | null;
  onPickTrack: () => void;
  onStart: () => void;
  accuracy: number;
}) {
  const stats = useEarTrainerStore();
  const weakSpots = useMemo(() => {
    return Object.entries(stats.bandStats)
      .filter(([, s]) => s.seen >= 3)
      .map(([id, s]) => ({
        id,
        label: TRAINER_BANDS.find((b) => b.id === id)?.label ?? id,
        acc: s.correct / s.seen,
      }))
      .sort((a, b) => a.acc - b.acc)
      .slice(0, 3);
  }, [stats.bandStats]);

  return (
    <div className="grid gap-3 lg:grid-cols-[1.3fr_0.7fr]">
      <GlassPanel intense className="p-6">
        <div className="text-[10px] uppercase tracking-[0.3em] text-dim mb-3">Difficulty</div>
        <div className="grid grid-cols-2 gap-2">
          {DIFFICULTIES.map((d) => (
            <button
              key={d.id}
              onClick={() => setDifficulty(d)}
              className={`kc-lift rounded-2xl p-4 border text-left ${
                difficulty.id === d.id
                  ? "border-cyan/60 bg-cyan/10"
                  : "border-white/10 hover:border-white/25 hover:bg-white/[0.03]"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-base font-semibold" style={{ color: d.accent }}>
                  {d.name}
                </span>
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ background: d.accent, boxShadow: `0 0 12px ${d.accent}` }}
                />
              </div>
              <div className="text-[11px] text-dim mt-1">{d.blurb}</div>
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between mt-5 mb-2">
          <div className="text-[10px] uppercase tracking-[0.3em] text-dim">Test sound</div>
          <button
            onClick={onPickTrack}
            className="kc-btn kc-btn--sm kc-btn--accent"
          >
            ＋ Load your track
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {customName && (
            <button
              onClick={() => setSource("custom")}
              title={customName}
              className={`kc-chip max-w-[180px] truncate ${source === "custom" ? "kc-on" : ""}`}
            >
              ♪ {customName}
            </button>
          )}
          {SOURCES.map((s) => (
            <button
              key={s.id}
              onClick={() => setSource(s.id)}
              className={`kc-chip ${source === s.id ? "kc-on" : ""}`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="mt-6">
          <NeonButton onClick={onStart} className="w-full">
            ▶ Start Training · {ROUNDS_PER_GAME} rounds
          </NeonButton>
        </div>
        <p className="text-[11px] text-dim mt-3 leading-relaxed">
          A hidden EQ band gets boosted on the test sound. Use A/B to compare against flat,
          then pick the frequency you hear lifting. Train on any built-in sound — or load
          your own track to drill on real music. Faster + harder = more XP. Audio is fully
          isolated — your sculpt and player are never touched.
        </p>
      </GlassPanel>

      <div className="flex flex-col gap-3">
        <GlassPanel className="p-5">
          <div className="text-[10px] uppercase tracking-[0.3em] text-dim mb-3">Your stats</div>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Best streak" value={`${stats.bestStreak}`} />
            <Stat label="Accuracy" value={`${accuracy}%`} />
            <Stat label="Rounds" value={`${stats.rounds}`} />
            <Stat label="Games" value={`${stats.gamesPlayed}`} />
          </div>
        </GlassPanel>

        <GlassPanel className="p-5 flex-1">
          <div className="text-[10px] uppercase tracking-[0.3em] text-dim mb-3">Weak spots</div>
          {weakSpots.length === 0 ? (
            <div className="text-[12px] text-dim leading-relaxed">
              Play a few rounds and the bands you struggle with will show up here so you
              know what to drill.
            </div>
          ) : (
            <div className="space-y-2">
              {weakSpots.map((w) => (
                <div key={w.id} className="flex items-center gap-2">
                  <span className="text-xs font-mono text-white/70 w-12">{w.label}</span>
                  <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.round(w.acc * 100)}%`,
                        background: w.acc < 0.5 ? "#ff5b8a" : "#ffb648",
                      }}
                    />
                  </div>
                  <span className="text-[10px] text-dim w-9 text-right">
                    {Math.round(w.acc * 100)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </GlassPanel>
      </div>
    </div>
  );
}

function GameHud({
  round,
  score,
  streak,
  difficulty,
  onQuit,
}: {
  round: number;
  score: number;
  streak: number;
  difficulty: Difficulty;
  onQuit: () => void;
}) {
  return (
    <GlassPanel className="p-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-5">
          <HudStat label="Round" value={`${round}/${ROUNDS_PER_GAME}`} />
          <HudStat label="Score" value={`${score}`} accent="#22e8ff" />
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-widest text-dim">Streak</span>
            <span className="text-lg font-semibold tabular-nums">
              {streak > 0 ? (
                <span className="text-amber">{"▮".repeat(Math.min(streak, 5))} {streak}</span>
              ) : (
                <span className="text-white/40">—</span>
              )}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span
            className="text-[10px] uppercase tracking-widest px-2 py-1 rounded-full border"
            style={{ borderColor: `${difficulty.accent}66`, color: difficulty.accent }}
          >
            {difficulty.name}
          </span>
          <button
            onClick={onQuit}
            className="text-[11px] text-dim hover:text-white/80 transition"
          >
            Quit
          </button>
        </div>
      </div>
    </GlassPanel>
  );
}

function ABControls({
  boosted,
  onToggle,
  disabled,
}: {
  boosted: boolean;
  onToggle: () => void;
  disabled: boolean;
}) {
  return (
    <div className="kc-seg">
      <button
        onClick={() => boosted && onToggle()}
        disabled={disabled}
        className={`kc-seg-btn ${!boosted ? "kc-on" : ""} ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
      >
        Flat
      </button>
      <button
        onClick={() => !boosted && onToggle()}
        disabled={disabled}
        className={`kc-seg-btn ${boosted ? "kc-on" : ""} ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
      >
        Boosted
      </button>
    </div>
  );
}

function BandButton({
  band,
  index,
  phase,
  isSecret,
  isGuess,
  onClick,
}: {
  band: TrainerBand;
  index: number;
  phase: Phase;
  isSecret: boolean;
  isGuess: boolean;
  onClick: () => void;
}) {
  const revealed = phase === "revealed";
  let cls = "border-white/12 bg-white/[0.03] hover:border-white/30 hover:bg-white/[0.06]";
  if (revealed) {
    if (isSecret) {
      cls = "border-lime/70 bg-lime/15 text-lime shadow-[0_0_22px_rgba(157,255,91,0.35)]";
    } else if (isGuess) {
      cls = "border-rose-400/70 bg-rose-500/15 text-rose-200";
    } else {
      cls = "border-white/8 bg-white/[0.02] text-white/40";
    }
  }
  return (
    <motion.button
      onClick={onClick}
      disabled={revealed}
      whileHover={revealed ? undefined : { y: -2 }}
      whileTap={revealed ? undefined : { scale: 0.96 }}
      className={`relative rounded-xl border px-2 py-4 transition flex flex-col items-center gap-1 ${cls}`}
    >
      <span className="text-base font-semibold tabular-nums">{band.label}</span>
      <span className="text-[9px] uppercase tracking-wider text-dim">
        {band.freq >= 1000 ? "kHz" : "Hz"}
      </span>
      <span className="absolute top-1 left-1.5 text-[9px] text-white/30 font-mono">
        {index === 9 ? 0 : index + 1}
      </span>
    </motion.button>
  );
}

function GameOver({
  score,
  results,
  onPlayAgain,
  onMenu,
}: {
  score: number;
  results: RoundResult[];
  onPlayAgain: () => void;
  onMenu: () => void;
}) {
  const correct = results.filter((r) => r.correct).length;
  const acc = results.length > 0 ? Math.round((correct / results.length) * 100) : 0;
  const bestStreakThisGame = useMemo(() => {
    let best = 0;
    let cur = 0;
    for (const r of results) {
      if (r.correct) { cur += 1; best = Math.max(best, cur); }
      else cur = 0;
    }
    return best;
  }, [results]);

  const grade =
    acc >= 90 ? { t: "Golden Ears", c: "#ffb648" }
    : acc >= 70 ? { t: "Sharp", c: "#22e8ff" }
    : acc >= 50 ? { t: "Getting there", c: "#9dff5b" }
    : { t: "Keep drilling", c: "#ff5b8a" };

  return (
    <GlassPanel intense glow className="p-6">
      <div className="text-center">
        <div className="text-[10px] uppercase tracking-[0.3em] text-dim">Session complete</div>
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 18 }}
          className="text-5xl font-bold mt-2 neon-text"
        >
          {score}
        </motion.div>
        <div className="text-sm mt-1 font-semibold" style={{ color: grade.c }}>
          {grade.t}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mt-6 max-w-md mx-auto">
        <Stat label="Accuracy" value={`${acc}%`} />
        <Stat label="Correct" value={`${correct}/${results.length}`} />
        <Stat label="Best streak" value={`${bestStreakThisGame}`} />
      </div>

      {/* Round recap */}
      <div className="mt-6 flex flex-wrap justify-center gap-1.5">
        {results.map((r, i) => (
          <div
            key={i}
            title={`${r.secret.label} — ${r.correct ? "correct" : r.adjacent ? "adjacent" : "missed"}`}
            className="w-7 h-7 rounded-md flex items-center justify-center text-[10px] font-mono border"
            style={{
              borderColor: r.correct ? "#9dff5b88" : r.adjacent ? "#ffb64888" : "#ff5b8a88",
              background: r.correct ? "#9dff5b22" : r.adjacent ? "#ffb64822" : "#ff5b8a22",
              color: r.correct ? "#9dff5b" : r.adjacent ? "#ffb648" : "#ff8aa5",
            }}
          >
            {r.secret.label}
          </div>
        ))}
      </div>

      <div className="mt-6 flex items-center justify-center gap-2">
        <NeonButton onClick={onPlayAgain}>Play again</NeonButton>
        <button
          onClick={onMenu}
          className="kc-btn kc-btn--ghost"
        >
          Change difficulty
        </button>
      </div>
    </GlassPanel>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3 text-center">
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-widest text-dim mt-0.5">{label}</div>
    </div>
  );
}

function HudStat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-widest text-dim">{label}</span>
      <span className="text-lg font-semibold tabular-nums" style={accent ? { color: accent } : undefined}>
        {value}
      </span>
    </div>
  );
}
