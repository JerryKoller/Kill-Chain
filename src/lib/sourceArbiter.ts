/**
 * sourceArbiter — enforces "one sound source at a time".
 *
 * Kill-Chain has several independent generators that all feed the same
 * output:
 *   · the file player (Library / transport bar),
 *   · Exterior Audio capture (system loopback / Airspace direct capture),
 *   · Fire Command (live keys, arpeggiator, pattern sequencer),
 *   · media playing inside the Airspace webview itself.
 *
 * Historically nothing stopped them sounding on top of each other, which made
 * switching between Library, Fire Command and Airspace feel broken (a track
 * kept playing under the synth, the synth was buried and read as "silent").
 * Every PLAY path claims its source here; the claim silences the other three.
 *
 * All lookups are dynamic imports so the fire stores (and their big preset
 * bank) stay out of the boot bundle, and so this module can be called from
 * any store without creating import cycles. Stop/pause paths never claim,
 * so there is no re-entrancy.
 */

export type SoundSource = "file" | "loopback" | "fire" | "airspace";

function stopFire(): void {
  void import("@/state/fireSequencerStore")
    .then(({ useFireSequencerStore }) => {
      const s = useFireSequencerStore.getState();
      if (s.playing) s.stop();
    })
    .catch(() => { /* store not loaded — nothing playing */ });
  void import("@/state/fireCommandStore")
    .then(({ useFireCommandStore }) => {
      const s = useFireCommandStore.getState();
      if (s.heldNotes.length > 0 || s.arpOrder.length > 0 || s.arpCurrent !== null) {
        s.panic();
      }
    })
    .catch(() => { /* store not loaded — nothing playing */ });
}

function pauseFilePlayer(): void {
  void import("@/state/playerStore")
    .then(({ usePlayerStore }) => {
      const s = usePlayerStore.getState();
      if (s.status === "playing" && !s.loopbackActive) s.pause();
    })
    .catch(() => { /* ignore */ });
}

function stopLoopbackCapture(): void {
  void import("@/state/playerStore")
    .then(({ usePlayerStore }) => {
      const s = usePlayerStore.getState();
      if (s.loopbackActive) s.stopLoopback();
    })
    .catch(() => { /* ignore */ });
}

function pauseAirspaceMedia(): void {
  void import("@/lib/airspaceMedia")
    .then((m) => m.pauseAirspaceMedia())
    .catch(() => { /* airspace never opened */ });
}

/**
 * Announce that `source` is about to make sound. Everything else stands down:
 *
 *   file      → synth/sequencer stop, Airspace media pauses. (Loopback is
 *               already torn down by the player's own load path.)
 *   fire      → the file player pauses, Airspace media pauses.
 *   loopback  → synth/sequencer stop. (The player pauses itself; Airspace
 *               media KEEPS playing — it is the thing being captured.)
 *   airspace  → the file player pauses, synth/sequencer stop.
 */
export function claimSource(source: SoundSource): void {
  switch (source) {
    case "file":
      stopFire();
      pauseAirspaceMedia();
      break;
    case "fire":
      pauseFilePlayer();
      pauseAirspaceMedia();
      break;
    case "loopback":
      stopFire();
      break;
    case "airspace":
      pauseFilePlayer();
      stopFire();
      break;
  }
}
