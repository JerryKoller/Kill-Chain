import { useEffect, useRef } from "react";
import { usePlayerStore } from "@/state/playerStore";

/**
 * One hidden audio element for the whole shell. Mini mode used to skip
 * TransportBar, so attachElement never ran and boot-into-mini could not play.
 * Living here (App root) also keeps the MediaElementSource alive across
 * mini ↔ full, the same reason TransportBar stays mounted on Fire.
 */
export function SharedPlayerAudio() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const attachElement = usePlayerStore((s) => s.attachElement);
  const tick = usePlayerStore((s) => s.tick);

  useEffect(() => {
    if (audioRef.current) attachElement(audioRef.current);
  }, [attachElement]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTimeUpdate = () => tick();
    const onSeeked = () => tick();
    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("seeked", onSeeked);
    return () => {
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("seeked", onSeeked);
    };
  }, [tick, attachElement]);

  return <audio ref={audioRef} className="hidden" />;
}
