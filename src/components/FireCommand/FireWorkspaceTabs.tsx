/**
 * Synth | Sequencer workspace switcher.
 */

import type { FireWorkspace } from "./useFireWorkspace";
import { FireSegTabs } from "./FireSegTabs";

const ITEMS = [
  { id: "synth" as const, label: "Synth", color: "#ffbfa0", title: "Synth — oscillators, filter, FX, keyboard" },
  { id: "sequencer" as const, label: "Sequencer", color: "#b8dcff", title: "Sequencer — patterns, song order, piano roll, drums" },
];

const HINT: Record<FireWorkspace, { hint: string; detail: string }> = {
  synth: { hint: "Build the sound", detail: "Patch · modules · on-screen keys" },
  sequencer: { hint: "Build the beat & melody", detail: "Patterns · song · piano · drums" },
};

export function FireWorkspaceTabs({
  workspace,
  onChange,
}: {
  workspace: FireWorkspace;
  onChange: (ws: FireWorkspace) => void;
}) {
  const h = HINT[workspace];
  return (
    <FireSegTabs
      items={ITEMS}
      value={workspace}
      onChange={onChange}
      hint={h.hint}
      hintDetail={h.detail}
      size="md"
    />
  );
}
