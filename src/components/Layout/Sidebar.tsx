import { motion } from "framer-motion";
import { useUIStore, type View } from "@/state/uiStore";
import { useSettingsStore } from "@/state/settingsStore";
import { HEADPHONES } from "@/audio/headphoneProfiles";
import { SpectrumStrip } from "@/components/Layout/SpectrumStrip";
import { useTabActivity, type TabActivity } from "@/hooks/useTabActivity";

interface NavDef {
  id: View;
  label: string;
  sub: string;
  icon: string;
}

/**
 * Tools grouped by battlefield role (issue #4):
 *   Generators  — things that PRODUCE sound
 *   Modulators  — things that SHAPE the sound passing through
 *   Utilities   — recon, training and stored loadouts
 */
const GROUPS: { title: string; items: NavDef[] }[] = [
  {
    title: "Generators",
    items: [
      { id: "library", label: "Library", sub: "Track arsenal", icon: "♫" },
      { id: "fire", label: "Fire Command", sub: "Tactical synthesizer", icon: "⏣" },
      { id: "airspace", label: "Airspace", sub: "Browse the web thru EQ", icon: "⌖" },
    ],
  },
  {
    title: "Modulators",
    items: [
      { id: "playground", label: "Sculptor", sub: "Shape the signal", icon: "◐" },
      { id: "tractor", label: "Tractor Beam", sub: "Lock EQ onto a track", icon: "◉" },
      { id: "calibration", label: "Calibration", sub: "Zero in to your ears", icon: "◎" },
      { id: "morphlab", label: "Morph Lab", sub: "Blend in 2D", icon: "◍" },
      { id: "reactor", label: "Reactor", sub: "Perform live", icon: "◈" },
      { id: "dimension", label: "3rd Dimension", sub: "Deploy sound in a room", icon: "⬡" },
    ],
  },
  {
    title: "Utilities",
    items: [
      { id: "chain", label: "Kill Chain", sub: "Live signal flow map", icon: "⛓" },
      { id: "scope", label: "Scope", sub: "Recon the signal", icon: "⊡" },
      { id: "trainer", label: "Golden Ears", sub: "Sharpen your hearing", icon: "♪" },
      { id: "presets", label: "Armory", sub: "Sound loadouts", icon: "❖" },
    ],
  },
];

const SECONDARY: NavDef[] = [
  { id: "glossary", label: "Glossary", sub: "Field manual", icon: "?" },
  { id: "settings", label: "Settings", sub: "Comms · gear · theme", icon: "⚙" },
];

export function Sidebar() {
  const view = useUIStore((s) => s.view);
  const setView = useUIStore((s) => s.setView);
  const headphoneId = useSettingsStore((s) => s.headphone);
  const headphone = HEADPHONES[headphoneId] ?? HEADPHONES.xm6;
  const activity = useTabActivity();

  return (
    <aside className="w-56 shrink-0 p-3 flex flex-col gap-2 min-h-0">
      <div className="px-3 pt-2 pb-3 shrink-0">
        <div className="text-[10px] tracking-[0.4em] uppercase text-white/40">
          Tactical Audio Engine
        </div>
        <div className="mt-1 text-lg font-display neon-text font-bold tracking-[0.12em] uppercase">
          Kill-Chain
        </div>
      </div>

      {/* Scrollable nav region so every tool stays reachable on short windows */}
      <div className="flex-1 min-h-0 overflow-y-auto sidebar-scroll flex flex-col gap-1 -mr-1 pr-1">
        {GROUPS.map((group, gi) => (
          <nav key={group.title} className="flex flex-col gap-1">
            <div className={`px-3 ${gi === 0 ? "pt-0" : "pt-2"} pb-0.5 text-[9px] uppercase tracking-[0.3em] text-white/30 select-none`}>
              {group.title}
            </div>
            {group.items.map((item) => (
              <NavItem
                key={item.id}
                item={item}
                active={view === item.id}
                activity={activity[item.id] ?? null}
                onClick={() => setView(item.id)}
              />
            ))}
          </nav>
        ))}

        <div className="my-3 mx-3 hairline" />

        <nav className="flex flex-col gap-1">
          {SECONDARY.map((item) => (
            <NavItem
              key={item.id}
              item={item}
              active={view === item.id}
              activity={null}
              onClick={() => setView(item.id)}
            />
          ))}
        </nav>

        <SpectrumStrip />
      </div>

      <div className="shrink-0 px-3 pt-3">
        <div className="text-[10px] uppercase tracking-[0.25em] text-white/40 mb-2">
          Correction profile
        </div>
        <div className="glass p-3 rounded-xl">
          <div className="text-sm font-semibold">{headphone.name}</div>
          <div className="text-[11px] text-dim mt-1 leading-relaxed">
            {headphone.brand} - correction profile loaded.
          </div>
        </div>
        <button
          onClick={() => setView("settings")}
          className="mt-2 w-full text-[10px] text-dim hover:text-cyan transition uppercase tracking-widest"
        >
          Change device
        </button>
      </div>
    </aside>
  );
}

/**
 * Activity dot (issue #5): cyan pulses with the audio when a tab is
 * GENERATING sound (opacity rides the shared --beat-glow var, so it breathes
 * with the actual signal at zero extra render cost); violet glows steady when
 * the tab is MODULATING the output.
 */
function ActivityDot({ kind }: { kind: TabActivity }) {
  if (!kind) return null;
  const gen = kind === "gen";
  return (
    <span
      className="absolute top-1.5 left-1.5 w-1.5 h-1.5 rounded-full pointer-events-none"
      title={gen ? "Producing sound" : "Modulating the output"}
      style={
        gen
          ? {
              background: "rgb(var(--c-cyan))",
              boxShadow: "0 0 6px rgb(var(--c-cyan))",
              opacity: "calc(0.4 + var(--beat-glow, 0.5) * 0.6)",
            }
          : {
              background: "rgb(var(--c-violet))",
              boxShadow: "0 0 6px rgb(var(--c-violet))",
              opacity: 0.9,
            }
      }
    />
  );
}

function NavItem({
  item,
  active,
  activity,
  onClick,
}: {
  item: NavDef;
  active: boolean;
  activity: TabActivity;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      data-ui-sound="none" // voiced centrally: view switch plays the tab tick
      aria-current={active ? "page" : undefined}
      className={`relative group text-left px-3 py-2.5 rounded-xl transition border ${
        active
          ? "bg-white/5 border-white/15"
          : "border-transparent hover:bg-white/[0.03] hover:border-white/10"
      }`}
    >
      {active && (
        <motion.div
          layoutId="sidebar-active"
          className="absolute inset-0 rounded-xl pointer-events-none"
          style={{
            boxShadow:
              "inset 0 0 0 1px rgb(var(--c-violet) / 0.45), " +
              "0 0 calc(24px + var(--beat-glow, 0) * 20px) rgb(var(--c-cyan) / calc(0.25 + var(--beat-glow, 0) * 0.35))",
          }}
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
        />
      )}
      <ActivityDot kind={activity} />
      <div className="flex items-center gap-3 relative">
        <div className={`text-lg ${active ? "text-cyan" : "text-white/55 group-hover:text-white/80"}`}>
          {item.icon}
        </div>
        <div>
          <div className={`text-sm font-medium ${active ? "text-white" : "text-white/80"}`}>
            {item.label}
          </div>
          <div className="text-[10px] text-dim tracking-wide">{item.sub}</div>
        </div>
      </div>
    </button>
  );
}
