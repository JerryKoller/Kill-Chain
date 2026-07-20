import { useEffect } from "react";
import { useMidiStore } from "@/state/midiStore";

export function useMidi(): void {
  useEffect(() => {
    void useMidiStore.getState().startListening();
  }, []);
}
