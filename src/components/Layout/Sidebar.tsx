import { useUIStore, type View } from "@/state/uiStore";
import { useSettingsStore } from "@/state/settingsStore";
import { HEADPHONES, profileForId } from "@/audio/headphoneProfiles";
import { SpectrumStrip } from "@/components/Layout/SpectrumStrip";
import { useTabActivity, type TabActivity } from "@/hooks/useTabActivity";
import { useEffect, useState, type ComponentType, type SVGProps } from "react";
import {
  IconAirspace,
  IconArmory,
  IconCalibration,
  IconChain,
  IconDimension,
  IconEars,
  IconFire,
  IconGlossary,
  IconLibrary,
  IconMorph,
  IconReactor,
  IconScope,
  IconSculptor,
  IconSettings,
  IconTractor,
} from "@/components/kcds";

interface NavDef {
  id: View;
  label: string;
  sub: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}

/**
 * Tools grouped by role:
 *   Generators  — things that PRODUCE sound
 *   Modulators  — things that SHAPE the sound passing through
 *   Utilities   — inspect, train, and saved presets
 */
const GROUPS: { title: string; items: NavDef[] }[] = [
  {
    title: "Generators",
    items: [
      { id: "library", label: "Library", sub: "Browse & play tracks", Icon: IconLibrary },
      { id: "fire", label: "Fire Command", sub: "Tactical synthesizer", Icon: IconFire },
      { id: "airspace", label: "Airspace", sub: "Browse the web thru EQ", Icon: IconAirspace },
    ],
  },
  {
    title: "Modulators",
    items: [
      { id: "playground", label: "Sculptor", sub: "Shape the signal", Icon: IconSculptor },
      { id: "tractor", label: "Tractor Beam", sub: "Lock EQ onto a track", Icon: IconTractor },
      { id: "calibration", label: "Calibration", sub: "Zero in to your ears", Icon: IconCalibration },
      { id: "morphlab", label: "Morph Lab", sub: "Blend in 2D", Icon: IconMorph },
      { id: "reactor", label: "Reactor", sub: "Perform live", Icon: IconReactor },
      { id: "dimension", label: "3rd Dimension", sub: "Place sound in a room", Icon: IconDimension },
    ],
  },
  {
    title: "Utilities",
    items: [
      { id: "chain", label: "Kill Chain", sub: "Live signal flow map", Icon: IconChain },
      { id: "scope", label: "Scope", sub: "Watch the waveform", Icon: IconScope },
      { id: "trainer", label: "Golden Ears", sub: "Sharpen your hearing", Icon: IconEars },
      { id: "presets", label: "Armory", sub: "Saved Sculptor presets", Icon: IconArmory },
    ],
  },
];

const SECONDARY: NavDef[] = [
  { id: "glossary", label: "Glossary", sub: "Help & deep dives", Icon: IconGlossary },
  { id: "settings", label: "Settings", sub: "Audio · gear · theme", Icon: IconSettings },
];

/** Live output-device label for the profile card (falls back to "System default"). */
function useOutputDeviceName(): string {
  const deviceId = useSettingsStore((s) => s.audioOutputDeviceId);
  const [name, setName] = useState("System default");
  useEffect(() => {
    let alive = true;
    if (!deviceId) {
      setName("System default");
      return;
    }
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((list) => {
        if (!alive) return;
        const dev = list.find((d) => d.kind === "audiooutput" && d.deviceId === deviceId);
        setName(dev?.label || "Selected output");
      })
      .catch(() => setName("Selected output"));
    return () => {
      alive = false;
    };
  }, [deviceId]);
  return name;
}

export function Sidebar() {
  const view = useUIStore((s) => s.view);
  const setView = useUIStore((s) => s.setView);
  const headphoneId = useSettingsStore((s) => s.headphone);
  const headphone = profileForId(headphoneId);
  const activity = useTabActivity();
  const outputName = useOutputDeviceName();

  return (
    <aside className="w-56 shrink-0 p-3 flex flex-col gap-2 min-h-0">
      <div className="px-3 pt-2 pb-3 shrink-0">
        <div className="kc-label text-white/40">Play &amp; reshape audio</div>
        <div className="mt-1 text-lg font-display neon-text font-bold tracking-[0.12em] uppercase">
          Kill-Chain
        </div>
      </div>

      {/* Scrollable nav region so every tool stays reachable on short windows */}
      <div className="flex-1 min-h-0 overflow-y-auto sidebar-scroll flex flex-col gap-1 -mr-1 pr-1">
        {GROUPS.map((group, gi) => (
          <nav key={group.title} className="flex flex-col gap-1">
            <div
              className={`px-3 ${gi === 0 ? "pt-0" : "pt-2"} pb-0.5 text-[9px] uppercase tracking-[0.3em] text-white/30 select-none`}
            >
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
        <div className="kc-label text-white/40 mb-2">Playback Correction</div>
        <div className="glass p-3 rounded-xl">
          <div className="text-sm font-semibold truncate" title={headphone.name}>
            {headphone.name}
          </div>
          <div className="text-[11px] text-dim mt-1 leading-relaxed truncate" title={outputName}>
            Output · {outputName}
          </div>
        </div>
        <button
          onClick={() => setView("settings")}
          className="mt-2 w-full text-[10px] text-dim hover:text-cyan transition uppercase tracking-widest"
        >
          Change profile
        </button>
      </div>
    </aside>
  );
}

/**
 * Activity dot: cyan pulses with the audio when a tab is GENERATING sound
 * (opacity rides the shared --beat-glow var, so it breathes with the actual
 * signal at zero extra render cost); violet glows steady when the tab is
 * MODULATING the output.
 */
function ActivityDot({ kind }: { kind: TabActivity }) {
  if (!kind) return null;
  const gen = kind === "gen";
  return (
    <span
      className="absolute top-1.5 left-2 w-1.5 h-1.5 rounded-full pointer-events-none"
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
  const { Icon } = item;
  return (
    <button
      onClick={onClick}
      data-ui-sound="none" // voiced centrally: view switch plays the tab tick
      data-module={item.id}
      aria-current={active ? "page" : undefined}
      className={`kc-nav-item group ${active ? "kc-on" : ""}`}
    >
      <ActivityDot kind={activity} />
      <div className="flex items-center gap-3 relative">
        <Icon className="kc-nav-icon" aria-hidden />
        <div className="min-w-0">
          <div className={`text-sm font-medium truncate ${active ? "text-white" : "text-white/80"}`}>
            {item.label}
          </div>
          <div className="text-[10px] text-dim tracking-wide truncate">{item.sub}</div>
        </div>
      </div>
    </button>
  );
}
