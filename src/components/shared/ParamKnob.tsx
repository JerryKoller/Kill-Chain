import { useCallback } from "react";
import { Knob } from "./Knob";
import { useAudioStore } from "@/state/audioStore";
import type { SoundParams } from "@/audio/types";

interface Props {
  paramKey: keyof SoundParams;
  size?: number;
  color?: string;
  label?: string;
  hint?: string;
  bipolar?: boolean;
}

/**
 * A Knob bound to a single sound parameter. It subscribes ONLY to its own
 * param slice and uses a stable onChange, so dragging one knob no longer
 * re-renders every other knob on the screen — the main source of "laggy"
 * sculpting. Pairs with the memoized Knob.
 */
export function ParamKnob({ paramKey, size, color, label, hint, bipolar }: Props) {
  const value = useAudioStore((s) => s.params[paramKey]);
  const setParam = useAudioStore((s) => s.setParam);
  const onChange = useCallback((v: number) => setParam(paramKey, v), [setParam, paramKey]);
  return (
    <Knob
      value={value}
      onChange={onChange}
      size={size}
      color={color}
      label={label}
      hint={hint}
      bipolar={bipolar}
    />
  );
}
