import React, { useEffect, useMemo, useRef, useState } from "react";
import { GlassPanel } from "@/components/shared/GlassPanel";
import { ActionBar } from "@/components/shared/ActionBar";
import { useSettingsStore, type ThemeId, type AccentId } from "@/state/settingsStore";
import { useAudioStore } from "@/state/audioStore";
import {
  HEADPHONES,
  headphoneBrands,
  searchHeadphones,
  deviceTypeOf,
  DEVICE_TYPE_ORDER,
  DEVICE_TYPE_LABELS,
  type DeviceType,
  type HeadphoneProfile,
} from "@/audio/headphoneProfiles";
import { useUIStore } from "@/state/uiStore";
import { useMidiStore, type MidiTarget } from "@/state/midiStore";
import { SOUND_PARAM_META, type SoundParams } from "@/audio/types";
import { getEngine } from "@/audio/AudioEngine";
import { usePlayerStore } from "@/state/playerStore";

const THEMES: { id: ThemeId; name: string; blurb: string; swatches: string[] }[] = [
  { id: "nightops", name: "Kill-Chain · Night Ops", blurb: "Default. The signature look — tactical green, tracer amber, gunmetal black.", swatches: ["#78c678", "#e07840", "#629670"] },
  { id: "obsidian", name: "Obsidian", blurb: "Black steel and blood — dark and menacing.", swatches: ["#54b4d6", "#ff4040", "#7a5cff"] },
  { id: "gunmetal", name: "Gunmetal", blurb: "Desaturated cool steel. Sharp and near-monochrome.", swatches: ["#8ea0b2", "#d66054", "#6e7c8e"] },
  { id: "carbon", name: "Carbon", blurb: "Industrial near-black with one molten amber edge.", swatches: ["#e68a3a", "#e85430", "#966e50"] },
  { id: "crimson", name: "Crimson", blurb: "Aggressive black and molten red.", swatches: ["#ff5a36", "#ff2d6f", "#b23bff"] },
  { id: "military", name: "Olive Drab", blurb: "Field olive, gold, and steel.", swatches: ["#c4b454", "#d9772b", "#7c9646"] },
  { id: "abyss", name: "Abyss", blurb: "Deep ocean blue-black, cold and quiet.", swatches: ["#33d6ff", "#3b7bff", "#6a5bff"] },
  { id: "toxic", name: "Toxic", blurb: "Hazmat black with acid green.", swatches: ["#5bff9d", "#caff33", "#2fe0a0"] },
  { id: "ember", name: "Ember", blurb: "Charcoal and burning orange.", swatches: ["#ff8a3b", "#ff4040", "#ff5b2e"] },
  { id: "mono", name: "Mono", blurb: "Brutalist grayscale, one red warning.", swatches: ["#e2e4eb", "#ff4d4d", "#969cb0"] },
  { id: "neon", name: "Neon", blurb: "Cyberpunk magenta and cyan.", swatches: ["#22e8ff", "#ff2bd6", "#7a3bff"] },
  { id: "studio", name: "Studio", blurb: "Cool engineering aesthetic, less glow.", swatches: ["#4ec9ff", "#ff7a8a", "#8e9bff"] },
  { id: "vinyl", name: "Vinyl", blurb: "Warm sepia, paper labels, low-glare.", swatches: ["#ffb260", "#ff6f3c", "#c87a3a"] },
];

const ACCENTS: { id: AccentId; name: string; color: string }[] = [
  { id: "theme", name: "Theme", color: "linear-gradient(135deg,#54b4d6,#ff4040)" },
  { id: "steel", name: "Steel", color: "#54b4d6" },
  { id: "blood", name: "Blood", color: "#ff4040" },
  { id: "amber", name: "Amber", color: "#ffb048" },
  { id: "ice", name: "Ice", color: "#78c8ff" },
  { id: "lime", name: "Lime", color: "#5fd38a" },
  { id: "violet", name: "Violet", color: "#7a5cff" },
  { id: "mono", name: "Mono", color: "#e2e4eb" },
];

const DENSITIES: { scale: number; name: string }[] = [
  { scale: 1.0, name: "Comfortable" },
  { scale: 0.92, name: "Compact" },
  { scale: 0.84, name: "Dense" },
];

export function SettingsView() {
  const settings = useSettingsStore();
  const setHeadphoneProfile = useAudioStore((s) => s.setHeadphoneProfile);
  const toast = useUIStore((s) => s.toast);

  const [btDevices, setBtDevices] = useState<BluetoothDeviceInfo[]>([]);
  const [defaultOut, setDefaultOut] = useState<string | null>(null);
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);

  useEffect(() => {
    void refreshBluetooth();
    void refreshOutput();
    void refreshRemote();
  }, []);

  async function refreshBluetooth() {
    const api = window.playground?.bluetooth;
    if (!api) return;
    try {
      const list = await api.listDevices();
      setBtDevices(list ?? []);
    } catch (err) {
      console.warn("[settings] bluetooth read failed:", err);
    }
  }

  async function refreshOutput() {
    const api = window.playground?.audioDevices;
    if (!api) return;
    try {
      setDefaultOut(await api.getDefaultOutputName());
    } catch (err) {
      console.warn("[settings] device read failed:", err);
    }
  }

  async function refreshRemote() {
    const api = window.playground?.remote;
    if (!api) return;
    try {
      const s = await api.getStatus();
      setRemoteUrl(s?.running ? s.url : null);
    } catch (err) {
      console.warn("[settings] remote status read failed:", err);
    }
  }

  return (
    <div className="flex flex-col gap-3 pb-4">
      <ActionBar title="Settings" code="KC-14" subtitle="Theme, gear, comms, and preferences" />

      {/* THEMES */}
      <GlassPanel intense className="p-5">
        <Section title="Theme" sub="Visual personality across all panels" />
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => settings.set("theme", t.id)}
              className={`rounded-2xl p-4 border text-left transition ${
                settings.theme === t.id
                  ? "border-cyan/60 bg-cyan/10"
                  : "border-white/10 hover:border-white/25 hover:bg-white/[0.03]"
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="text-base font-semibold">{t.name}</div>
                <div className="flex gap-1">
                  {t.swatches.map((c) => (
                    <span
                      key={c}
                      className="w-4 h-4 rounded-full border border-white/15"
                      style={{ background: c }}
                    />
                  ))}
                </div>
              </div>
              <div className="text-[11px] text-dim leading-snug">{t.blurb}</div>
            </button>
          ))}
        </div>
      </GlassPanel>

      {/* LOOK & FEEL — accent, glow, density */}
      <GlassPanel intense className="p-5">
        <Section title="Look & feel" sub="Sharpen the accent, dial the glow, and tighten the layout" />

        <div className="mt-3 text-[11px] uppercase tracking-[0.25em] text-dim mb-2">Accent</div>
        <div className="flex flex-wrap gap-2">
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              onClick={() => settings.set("accent", a.id)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition ${
                settings.accent === a.id
                  ? "border-cyan/60 bg-cyan/10 text-white"
                  : "border-white/10 hover:border-white/25 text-dim"
              }`}
            >
              <span className="w-3.5 h-3.5 rounded-full border border-white/20" style={{ background: a.color }} />
              {a.name}
            </button>
          ))}
        </div>

        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[11px] uppercase tracking-[0.25em] text-dim">Glow / bloom</div>
              <div className="text-xs font-mono text-white/70">{Math.round(settings.uiGlow * 100)}%</div>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.uiGlow}
              onChange={(e) => settings.set("uiGlow", Number(e.target.value))}
              className="w-full accent-cyan"
            />
            <div className="text-[10px] text-dim mt-1">Lower = sharper, flatter, less neon.</div>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-[0.25em] text-dim mb-1.5">Density</div>
            <div className="flex gap-2">
              {DENSITIES.map((d) => (
                <button
                  key={d.scale}
                  onClick={() => settings.set("uiScale", d.scale)}
                  className={`flex-1 rounded-lg border px-2 py-2 text-xs transition ${
                    Math.abs(settings.uiScale - d.scale) < 0.001
                      ? "border-cyan/60 bg-cyan/10 text-white"
                      : "border-white/10 hover:border-white/25 text-dim"
                  }`}
                >
                  {d.name}
                </button>
              ))}
            </div>
            <div className="text-[10px] text-dim mt-1">Compact / Dense fit more on screen with less scrolling.</div>
          </div>
        </div>

        {/* Motion + backdrop + boot */}
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <ToggleCard
            on={settings.bgFx}
            onToggle={() => settings.toggle("bgFx")}
            title="Ambient backdrop"
            sub="Grid field + breathing orbs behind the UI"
          />
          <ToggleCard
            on={settings.forceReducedMotion}
            onToggle={() => settings.toggle("forceReducedMotion")}
            title="Reduce motion"
            sub="Calms every animation, independent of the OS setting"
          />
          <ToggleCard
            on={settings.bootSound}
            onToggle={() => settings.toggle("bootSound")}
            title="Boot sting"
            sub="The SYSTEM ARM sequence sound on launch"
          />
        </div>
      </GlassPanel>

      {/* HEADPHONES */}
      <HeadphonesSection
        active={settings.headphone}
        onPick={(id) => {
          settings.set("headphone", id);
          setHeadphoneProfile(id);
          toast(`Loaded ${HEADPHONES[id]?.name ?? id}`);
        }}
        companionMode={settings.companionMode}
        onToggleCompanion={() => settings.toggle("companionMode")}
        defaultOut={defaultOut}
      />

      {/* LIVE ROUTING DIAGNOSTICS - tells you exactly what's happening */}
      <RoutingDiagnostics defaultOut={defaultOut} onRefreshDefaultOut={() => void refreshOutput()} />

      {/* SYSTEM-WIDE AUDIO ROUTING - VB-Cable integration */}
      <AudioRoutingSection />

      {/* AUDIO OUTPUT DEVICE - sets where app's own playback goes */}
      <OutputDeviceSection />

      {/* BLUETOOTH STATUS */}
      <GlassPanel intense className="p-5">
        <Section
          title="Bluetooth"
          sub="Connected wireless audio devices, with codec + battery if available"
        />
        {btDevices.length === 0 ? (
          <div className="mt-3 text-[12px] text-dim">
            {window.playground?.bluetooth
              ? "No connected Bluetooth audio devices detected."
              : "Bluetooth helper not available - works only inside the packaged Electron app."}
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {btDevices.map((d) => (
              <div
                key={d.name}
                className="flex items-center justify-between p-3 rounded-xl border border-white/10"
              >
                <div>
                  <div className="text-sm font-semibold">{d.name}</div>
                  <div className="text-[11px] text-dim">
                    {d.connected ? "Connected" : "Paired"}
                    {d.codec ? ` - ${d.codec}` : ""}
                  </div>
                </div>
                {d.battery !== null && (
                  <div className="text-sm font-mono">{d.battery}%</div>
                )}
              </div>
            ))}
          </div>
        )}
        <button
          onClick={() => void refreshBluetooth()}
          className="mt-3 rounded-lg border border-white/10 hover:bg-white/5 px-3 py-1.5 text-xs"
        >
          Refresh
        </button>
      </GlassPanel>

      {/* REMOTE */}
      <GlassPanel intense className="p-5">
        <Section
          title="Mobile Remote"
          sub="Self-hosted PWA controller. Scan the QR or visit the URL from your phone (same Wi-Fi)."
        />
        <div className="mt-3 flex items-center gap-3 flex-wrap">
          <input
            type="number"
            min={0}
            max={65535}
            value={settings.remotePort}
            onChange={(e) => settings.set("remotePort", Math.max(0, Math.min(65535, Number(e.target.value))))}
            placeholder="0 = off"
            className="w-28 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-cyan/60"
          />
          <button
            onClick={() => {
              if (settings.remotePort === 0) settings.set("remotePort", 7270);
              else settings.set("remotePort", 0);
            }}
            className="rounded-lg border border-cyan/40 bg-cyan/10 hover:bg-cyan/20 px-3 py-2 text-sm text-cyan font-semibold"
          >
            {settings.remotePort === 0 ? "Start (default 7270)" : "Stop"}
          </button>
          {remoteUrl && (
            <span className="text-[12px] font-mono text-cyan/85">{remoteUrl}</span>
          )}
        </div>
        <div className="mt-2 text-[11px] text-dim">
          Server runs locally and only accepts connections from your LAN. Open
          the URL on your phone to get a touch-friendly transport + macro pad.
        </div>
      </GlassPanel>

      {/* PREFERENCES */}
      <GlassPanel intense className="p-5">
        <Section title="Preferences" sub="App behaviour" />
        <div className="mt-3 space-y-1">
          <ToggleRow
            label="Tooltips"
            sub="Show hover explanations on knobs, sliders, and buttons"
            value={settings.tooltipsEnabled}
            onChange={() => settings.toggle("tooltipsEnabled")}
          />
          <ToggleRow
            label="UI sounds"
            sub="Subtle clicks and ticks when you press buttons and move sliders"
            value={settings.uiSounds}
            onChange={() => settings.toggle("uiSounds")}
          />
          {settings.uiSounds && (
            <div className="flex items-center justify-between gap-4 p-3 rounded-xl">
              <div>
                <div className="text-sm">UI sound volume</div>
                <div className="text-[11px] text-dim leading-snug">
                  How loud the click / tick feedback is.
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={settings.uiSoundVolume}
                  onChange={(e) => settings.set("uiSoundVolume", Number(e.target.value))}
                  className="w-32 accent-cyan"
                />
                <span className="text-xs font-mono text-white/70 w-8 text-right">
                  {Math.round(settings.uiSoundVolume * 100)}
                </span>
              </div>
            </div>
          )}
          <ToggleRow
            label="Auto-flatten new tracks"
            sub="Analyse the first 10 seconds of every loaded track and gently tilt the EQ to flatten its average spectrum"
            value={settings.autoFlatten}
            onChange={() => settings.toggle("autoFlatten")}
          />
          <ToggleRow
            label="Mini-player mode"
            sub="Collapse window into a compact always-on-top strip (also: press W)"
            value={settings.miniMode}
            onChange={() => settings.toggle("miniMode")}
          />
          <div className="flex items-center justify-between gap-4 p-3 rounded-xl">
            <div>
              <div className="text-sm">LUFS auto-normalize target</div>
              <div className="text-[11px] text-dim leading-snug">
                Trim master gain to hit this perceived loudness. Spotify is -14.
              </div>
            </div>
            <input
              type="number"
              min={-30}
              max={-6}
              step={0.5}
              value={settings.lufsTargetDb ?? -14}
              onChange={(e) => settings.set("lufsTargetDb", Number(e.target.value))}
              className="w-20 bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-sm font-mono"
              disabled={settings.lufsTargetDb === null}
            />
            <button
              onClick={() =>
                settings.set(
                  "lufsTargetDb",
                  settings.lufsTargetDb === null ? -14 : null,
                )
              }
              className={`rounded-lg border px-3 py-1.5 text-xs ${
                settings.lufsTargetDb !== null
                  ? "border-cyan/60 bg-cyan/10 text-cyan"
                  : "border-white/15 text-white/70"
              }`}
            >
              {settings.lufsTargetDb !== null ? "On" : "Off"}
            </button>
          </div>
          <button
            onClick={() => {
              settings.set("onboardingDone", false);
              toast("Onboarding will run next launch (or now)");
            }}
            className="w-full text-xs text-dim hover:text-cyan mt-3"
          >
            Re-run onboarding tour
          </button>
        </div>
      </GlassPanel>

      {/* MIDI mapping */}
      <MidiSection />
    </div>
  );
}

function HeadphonesSection({
  active,
  onPick,
  companionMode,
  onToggleCompanion,
  defaultOut,
}: {
  active: string;
  onPick: (id: string) => void;
  companionMode: boolean;
  onToggleCompanion: () => void;
  defaultOut: string | null;
}) {
  const [query, setQuery] = useState("");
  const [brand, setBrand] = useState<string>("All");
  const brands = useMemo(() => ["All", ...headphoneBrands()], []);
  // Which device-type groups are collapsed. Everything except the active
  // profile's group starts collapsed so the (large) catalog stays scannable.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    const activeType = HEADPHONES[active] ? deviceTypeOf(HEADPHONES[active]) : "headphones";
    const init: Record<string, boolean> = {};
    for (const t of DEVICE_TYPE_ORDER) init[t] = t !== activeType;
    return init;
  });

  const groups = useMemo(() => {
    const found = searchHeadphones(query);
    const list = brand === "All" ? found : found.filter((h) => h.brand === brand);
    const byType = new Map<DeviceType, HeadphoneProfile[]>();
    for (const h of list) {
      const t = deviceTypeOf(h);
      const arr = byType.get(t);
      if (arr) arr.push(h);
      else byType.set(t, [h]);
    }
    // Sort within each group by brand, then model name.
    for (const arr of byType.values()) {
      arr.sort((a, b) => a.brand.localeCompare(b.brand) || a.name.localeCompare(b.name));
    }
    return DEVICE_TYPE_ORDER.filter((t) => byType.has(t)).map((t) => ({
      type: t,
      items: byType.get(t)!,
    }));
  }, [query, brand]);

  const searching = query.trim().length > 0;
  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <GlassPanel intense className="p-5">
      <Section
        title="Correction Profiles"
        sub="Active correction profile — headphones, speakers, laptops and more, grouped by device type. Companion Mode auto-picks when you switch devices."
      />
      <div className="mt-3 flex flex-col sm:flex-row gap-3 items-stretch">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search models or brands..."
          className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan/60"
        />
        <select
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan/60"
        >
          {brands.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
      </div>
      <div className="mt-3 flex flex-col gap-2 max-h-[420px] overflow-y-auto pr-1">
        {total === 0 && (
          <div className="text-[12px] text-dim p-4 text-center">
            No devices match "{query}". Try "Sony", "JBL", "laptop", "soundbar"...
          </div>
        )}
        {groups.map(({ type, items }) => {
          // While searching, keep all matching groups expanded.
          const isCollapsed = !searching && (collapsed[type] ?? true);
          return (
            <div key={type}>
              <button
                onClick={() =>
                  setCollapsed((c) => ({ ...c, [type]: !(c[type] ?? true) }))
                }
                className="w-full flex items-center justify-between rounded-lg px-3 py-2 bg-white/[0.04] border border-white/10 hover:border-white/25 transition text-left"
              >
                <span className="text-[11px] uppercase tracking-[0.25em] text-white/80">
                  {DEVICE_TYPE_LABELS[type]}
                </span>
                <span className="text-[10px] uppercase tracking-widest text-dim">
                  {items.length} {isCollapsed ? "▸" : "▾"}
                </span>
              </button>
              {!isCollapsed && (
                <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
                  {items.map((h) => (
                    <button
                      key={h.id}
                      onClick={() => onPick(h.id)}
                      className={`rounded-2xl p-3.5 border text-left transition ${
                        active === h.id
                          ? "border-cyan/60 bg-cyan/10"
                          : "border-white/10 hover:border-white/25 hover:bg-white/[0.03]"
                      }`}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <div>
                          <div className="text-[10px] uppercase tracking-[0.25em] text-dim">
                            {h.brand}
                            {deviceTypeOf(h) === "headphones"
                              ? ` - ${h.formFactor.replace("-", " ")}`
                              : ""}
                          </div>
                          <div className="text-base font-semibold">{h.name}</div>
                        </div>
                        {active === h.id && (
                          <span className="text-[10px] uppercase tracking-widest text-cyan">Active</span>
                        )}
                      </div>
                      <div className="text-[11px] text-dim mt-1 leading-relaxed">{h.blurb}</div>
                      <div className="mt-2 text-[10px] uppercase tracking-widest text-cyan/80">
                        {h.bands.length} band{h.bands.length === 1 ? "" : "s"}
                        {" - "}trim {h.outputGainDb} dB
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-3">
        <ToggleRow
          label="Companion Mode"
          sub="Auto-enable correction when the active Windows output matches a known headphone"
          value={companionMode}
          onChange={onToggleCompanion}
        />
      </div>
      {defaultOut !== null && (
        <div className="mt-2 text-[11px] text-dim">
          Active OS output: <span className="text-white/80">{defaultOut || "(unknown)"}</span>
        </div>
      )}
    </GlassPanel>
  );
}

function MidiSection() {
  const midi = useMidiStore();
  const toast = useUIStore((s) => s.toast);

  if (!midi.available) {
    return (
      <GlassPanel intense className="p-5">
        <Section title="MIDI" sub="Map an external controller to knobs and macros" />
        <div className="mt-3 text-[12px] text-dim">
          Web MIDI isn't available in this build (Chromium without secure
          context, or the OS denied it). Try restarting the app or check OS
          MIDI permissions.
        </div>
      </GlassPanel>
    );
  }

  const targets: { label: string; target: MidiTarget }[] = [
    ...SOUND_PARAM_META.slice(0, 12).map((m) => ({
      label: m.label,
      target: { kind: "param" as const, key: m.key as keyof SoundParams },
    })),
    { label: "Macro - Warmer", target: { kind: "macro", name: "warmer" } },
    { label: "Macro - Cleaner", target: { kind: "macro", name: "cleaner" } },
    { label: "Macro - Punchier", target: { kind: "macro", name: "punchier" } },
    { label: "Macro - Wider", target: { kind: "macro", name: "wider" } },
    { label: "Transport - Play / Pause", target: { kind: "transport", action: "play-pause" } },
    { label: "Transport - Next", target: { kind: "transport", action: "next" } },
    { label: "Transport - Prev", target: { kind: "transport", action: "prev" } },
    { label: "Transport - Snapshot A", target: { kind: "transport", action: "snapshot-a" } },
    { label: "Transport - Swap A/B", target: { kind: "transport", action: "swap-ab" } },
  ];

  return (
    <GlassPanel intense className="p-5">
      <Section
        title="MIDI"
        sub="External controllers - rotate / press / play to learn mappings"
      />
      <div className="mt-3">
        <div className="text-[10px] uppercase tracking-[0.3em] text-dim">Inputs</div>
        {midi.inputs.length === 0 ? (
          <div className="text-[12px] text-dim mt-1">
            No MIDI devices detected. Plug in a controller, then click Refresh.
          </div>
        ) : (
          <div className="mt-1 flex flex-wrap gap-2">
            {midi.inputs.map((i) => (
              <span
                key={i.id}
                className="rounded-md border border-white/12 px-2 py-1 text-[11px]"
              >
                {i.name}
              </span>
            ))}
          </div>
        )}
        <button
          onClick={() => void midi.startListening()}
          className="mt-2 rounded-lg border border-white/10 hover:bg-white/5 px-3 py-1 text-[11px]"
        >
          Refresh devices
        </button>
      </div>

      <div className="mt-4">
        <div className="text-[10px] uppercase tracking-[0.3em] text-dim mb-2">
          Active mappings
        </div>
        {midi.mappings.length === 0 ? (
          <div className="text-[12px] text-dim">No mappings yet.</div>
        ) : (
          <div className="space-y-1">
            {midi.mappings.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between rounded-lg border border-white/8 px-3 py-2 text-[12px]"
              >
                <span className="font-mono text-white/80">{m.label}</span>
                <button
                  onClick={() => midi.removeMapping(m.id)}
                  className="text-dim hover:text-plasma transition"
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              onClick={() => { midi.clearAll(); toast("Cleared MIDI mappings"); }}
              className="text-[11px] text-dim hover:text-plasma transition mt-1"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      <div className="mt-4">
        <div className="text-[10px] uppercase tracking-[0.3em] text-dim mb-2">
          Learn a new mapping
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {targets.map(({ label, target }) => {
            const learning =
              midi.learning &&
              JSON.stringify(midi.learning) === JSON.stringify(target);
            return (
              <button
                key={label}
                onClick={() => {
                  midi.setLearning(learning ? null : target);
                  toast(learning ? "Cancelled" : `Move a control to map "${label}"`);
                }}
                className={`text-left rounded-lg border px-3 py-2 transition ${
                  learning
                    ? "border-plasma/60 bg-plasma/15 text-plasma animate-pulse"
                    : "border-white/10 hover:border-cyan/40 hover:bg-cyan/5"
                }`}
              >
                <div className="text-[12px] font-medium">{label}</div>
                <div className="text-[10px] text-dim">
                  {learning ? "waiting for input..." : "click to learn"}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {midi.lastMessage && (
        <div className="mt-3 text-[11px] text-dim font-mono">
          Last: {midi.lastMessage.label} = {(midi.lastMessage.value * 127).toFixed(0)} / 127
        </div>
      )}
    </GlassPanel>
  );
}

/**
 * LIVE ROUTING DIAGNOSTICS.
 *
 * Shows in one glance:
 *   • AudioContext state + sample rate
 *   • Where Kill-Chain is currently sending its output (sinkId)
 *   • What Windows considers the default output device
 *   • Which device we're capturing from (if loopback is active)
 *   • Live input + output level meters (so you can SEE if signal is flowing)
 *   • A red/yellow/green status badge with the most likely fix when wrong
 *
 * This is the single most useful panel for debugging system-wide routing —
 * it removes all the guesswork about whether audio is even reaching the app.
 */
function RoutingDiagnostics({
  defaultOut,
  onRefreshDefaultOut,
}: {
  defaultOut: string | null;
  onRefreshDefaultOut: () => void;
}) {
  const settings = useSettingsStore();
  const loopbackActive = usePlayerStore((s) => s.loopbackActive);
  const loopbackMode = usePlayerStore((s) => s.loopbackMode);
  const status = usePlayerStore((s) => s.status);
  const toast = useUIStore((s) => s.toast);
  const bypass = useAudioStore((s) => s.bypass);
  const correctionEnabled = useAudioStore((s) => s.correctionEnabled);
  const toggleBypass = useAudioStore((s) => s.toggleBypass);
  const toggleCorrection = useAudioStore((s) => s.toggleCorrection);

  const [inLevel, setInLevel] = useState(0);
  const [outLevel, setOutLevel] = useState(0);
  const [ctxState, setCtxState] = useState<string>("?");
  const [sinkId, setSinkId] = useState<string>("");
  const [sampleRate, setSampleRate] = useState<number>(0);
  /** Wall-clock ms of the last time we saw input above the silence floor. */
  const [lastSignalMs, setLastSignalMs] = useState<number>(0);
  const noSignalToastedRef = useRef(false);

  const SILENCE_FLOOR = 0.002; // ~ -54 dBFS RMS - below this counts as silent

  useEffect(() => {
    let raf = 0;
    let lastTick = 0;
    const MIN_INTERVAL = 66; // ~15 fps is ample for diagnostic meters
    const engine = getEngine();
    setCtxState(engine.ctx.state);
    setSinkId(engine.getOutputDevice() || "");
    setSampleRate(engine.ctx.sampleRate || 0);

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden || now - lastTick < MIN_INTERVAL) return;
      lastTick = now;
      const inRms = engine.getInputRms();
      const outRms = engine.getOutputRms();
      setInLevel(inRms);
      setOutLevel(outRms);
      if (inRms > SILENCE_FLOOR) {
        setLastSignalMs(Date.now());
        noSignalToastedRef.current = false;
      }
      setCtxState(engine.ctx.state);
      setSinkId(engine.getOutputDevice() || "");
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Auto-toast when loopback active but input has been silent ≥ 2.5 s.
  // Only fire once per silence stretch so we don't spam.
  useEffect(() => {
    if (!loopbackActive) {
      noSignalToastedRef.current = false;
      return;
    }
    const id = setInterval(() => {
      const sinceMs = Date.now() - lastSignalMs;
      if (sinceMs > 2500 && !noSignalToastedRef.current) {
        noSignalToastedRef.current = true;
        if (settings.audioInputSource) {
          toast(
            "Exterior audio is on but no signal is reaching the app. " +
            "Most likely cause: Windows default playback isn't set to CABLE Input.",
          );
        } else {
          toast(
            "Exterior audio is on but nothing is playing in Windows " +
            "(or the captured device is muted).",
          );
        }
      }
    }, 1000);
    return () => clearInterval(id);
  }, [loopbackActive, lastSignalMs, settings.audioInputSource, toast]);

  // Resolve readable names for the various device IDs.
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    const refresh = async () => {
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        setOutputDevices(all.filter((d) => d.kind === "audiooutput"));
        setInputDevices(all.filter((d) => d.kind === "audioinput"));
      } catch { /* ignore */ }
    };
    void refresh();
    const h = () => { void refresh(); };
    navigator.mediaDevices.addEventListener?.("devicechange", h);
    return () => navigator.mediaDevices.removeEventListener?.("devicechange", h);
  }, []);

  const sinkName = sinkId
    ? outputDevices.find((d) => d.deviceId === sinkId)?.label || `Device ${sinkId.slice(0, 6)}...`
    : "System default";
  const inputName = settings.audioInputSource
    ? inputDevices.find((d) => d.deviceId === settings.audioInputSource)?.label
        || `Input ${settings.audioInputSource.slice(0, 6)}...`
    : "System loopback (getDisplayMedia)";

  // ---- Diagnostic verdict
  const issues: { level: "error" | "warn"; text: string; fix?: () => void; fixLabel?: string }[] = [];

  if (ctxState !== "running") {
    issues.push({
      level: "error",
      text: `AudioContext is "${ctxState}" — audio is suspended. Click anywhere or play something.`,
    });
  }

  // Recognize ANY virtual-cable variant: "CABLE Input", "CABLE In 16ch",
  // "CABLE-A Input", "VoiceMeeter Input", "Line 1", etc.
  const cableRx = /\bcable\b|vb-audio|vb-cable|voicemeeter|virtual audio cable|synchronous audio router|hifi cable/i;

  // The big one: using virtual cable input but Windows default still
  // points elsewhere (so apps aren't reaching the cable).
  const usingVirtualCable = !!settings.audioInputSource && cableRx.test(inputName);
  if (usingVirtualCable && defaultOut && !cableRx.test(defaultOut)) {
    issues.push({
      level: "error",
      text: `You picked a virtual cable input but Windows default playback is "${defaultOut}". Apps are still going to your speakers, not to the cable. Open Sound Settings and set the CABLE input device as default.`,
      fix: () => {
        if (window.playground?.shellOpen) {
          void window.playground.shellOpen("ms-settings:sound");
        }
      },
      fixLabel: "Open Sound Settings",
    });
  }

  // Sink ID is the same kind of virtual device as our input → silent loop.
  if (usingVirtualCable && cableRx.test(sinkName)) {
    issues.push({
      level: "error",
      text: `App's output is also a virtual cable ("${sinkName}"). This creates a silent loop. Pick your real headphones / speakers in "Audio Output Device" below.`,
    });
  }

  // QUALITY TIP: 16-channel variants degrade fidelity. Detect "16ch" in
  // either capture device or default output and recommend the 2-channel
  // CABLE Input if it's available in the user's device list.
  const using16ch = /16\s*ch\b|hi-?fi/i.test(inputName) || (defaultOut ? /16\s*ch\b|hi-?fi/i.test(defaultOut) : false);
  const has2chCableInput = outputDevices.some((d) =>
    d.label && /^cable\s+input/i.test(d.label),
  );
  if (using16ch && has2chCableInput) {
    issues.push({
      level: "warn",
      text: "You're routing through the 16-channel CABLE variant. Stereo audio gets upmixed to 16 channels by Windows then downmixed back to 2 — that double conversion noticeably degrades quality. Switch your Windows default and the app's capture source to the plain 2-channel \"CABLE Input\" / \"CABLE Output\" for best fidelity.",
      fix: () => {
        if (window.playground?.shellOpen) {
          void window.playground.shellOpen("ms-settings:sound");
        }
      },
      fixLabel: "Open Sound Settings",
    });
  }

  // No signal while loopback is active.
  if (loopbackActive && Date.now() - lastSignalMs > 2500 && inLevel < SILENCE_FLOOR) {
    issues.push({
      level: "warn",
      text: usingVirtualCable
        ? "Capture active but no signal. Make sure Windows default is CABLE Input AND that something is playing."
        : "Capture active but no signal. Try playing audio in any app.",
    });
  }

  // System loopback (no virtual cable) → processed output is volume-trimmed
  // and mixed alongside Windows' own playback, so the effect is subtle.
  // Tell the user clearly that this is expected and how to get full quality.
  // Not shown in "loopbackWithMute" mode: there the direct Windows output is
  // muted and the processed feed plays at full gain on a separate device.
  if (loopbackActive && loopbackMode === "loopback" && !usingVirtualCable && inLevel > SILENCE_FLOOR) {
    issues.push({
      level: "warn",
      text: "System loopback is auto-trimmed to prevent feedback, so the processed audio is layered UNDER your direct Windows playback at lower volume. To hear the FULL effect (and replace Windows audio), install VB-Cable below.",
    });
  }

  const verdict: "ok" | "warn" | "error" = issues.some((i) => i.level === "error")
    ? "error"
    : issues.length > 0
      ? "warn"
      : loopbackActive
        ? "ok"
        : "ok";

  return (
    <GlassPanel intense className="p-5">
      <Section
        title="Live Routing Diagnostics"
        sub="What's happening right now. Use this to debug system-wide audio setup."
      />

      {/* Verdict badge */}
      <div
        className={`mt-3 rounded-xl px-4 py-3 border ${
          verdict === "error"
            ? "border-plasma/50 bg-plasma/10"
            : verdict === "warn"
              ? "border-yellow-400/40 bg-yellow-400/5"
              : "border-cyan/40 bg-cyan/10"
        }`}
      >
        <div
          className={`text-sm font-semibold mb-2 ${
            verdict === "error" ? "text-plasma" : verdict === "warn" ? "text-yellow-300" : "text-cyan"
          }`}
        >
          {verdict === "error"
            ? "Routing problem detected"
            : verdict === "warn"
              ? "Check needed"
              : loopbackActive
                ? "Exterior audio active"
                : "Idle - press 'Enable Exterior Audio' in the transport bar"}
        </div>
        {issues.length === 0 && loopbackActive && (
          <div className="text-[12px] text-white/85 leading-relaxed">
            Audio is flowing through the lab. Input meter on the right should
            be active when something is playing.
          </div>
        )}
        {issues.map((iss, i) => (
          <div key={i} className="flex items-start gap-3 mt-1">
            <div className="text-[12px] leading-relaxed text-white/85 flex-1">{iss.text}</div>
            {iss.fix && iss.fixLabel && (
              <button
                onClick={iss.fix}
                className="shrink-0 rounded-lg border border-cyan/40 bg-cyan/10 hover:bg-cyan/20 px-3 py-1.5 text-xs text-cyan font-semibold"
              >
                {iss.fixLabel}
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Quick A/B controls - critical when the user says "sounds worse"
          because both toggles let them instantly compare to truly raw
          audio. Bypass = skip ALL user DSP. Correction = skip headphone
          EQ (XM6 by default). */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => {
            toggleBypass();
            toast(bypass ? "DSP re-enabled" : "DSP bypassed - raw audio only");
          }}
          className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
            bypass
              ? "border-yellow-400/60 bg-yellow-400/10 text-yellow-300"
              : "border-white/15 hover:border-white/30 hover:bg-white/5 text-white/80"
          }`}
          title="When ON, all user EQ/effects are bypassed. Useful to compare 'before' vs 'after'."
        >
          {bypass ? "● DSP BYPASSED (raw)" : "DSP ON"}
        </button>
        <button
          onClick={() => {
            toggleCorrection();
            toast(correctionEnabled ? "Headphone correction OFF" : "Headphone correction ON");
          }}
          className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
            correctionEnabled
              ? "border-cyan/40 bg-cyan/10 text-cyan"
              : "border-yellow-400/40 bg-yellow-400/10 text-yellow-300"
          }`}
          title="Headphone correction curve (e.g. Sony XM6). When OFF, the chain is fully neutral except for user DSP. Toggle this if exterior audio sounds 'colored' - the correction is designed for music files played in-app, not always ideal for processed system audio."
        >
          {correctionEnabled ? `Correction: ${HEADPHONES[settings.headphone]?.name ?? settings.headphone}` : "Correction OFF (flat)"}
        </button>
      </div>

      {/* Live meters + facts grid */}
      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <DiagBlock title="Capturing FROM" value={inputName}>
          <Meter level={inLevel} active={loopbackActive} label="IN" />
        </DiagBlock>
        <DiagBlock title="App output TO" value={sinkName}>
          <Meter level={outLevel} active={status === "playing"} label="OUT" />
        </DiagBlock>
        <DiagBlock title="Windows default playback" value={defaultOut || "(unknown)"}>
          <button
            onClick={onRefreshDefaultOut}
            className="rounded-lg border border-white/10 hover:bg-white/5 px-2 py-1 text-[10px]"
          >
            Refresh
          </button>
        </DiagBlock>
        <DiagBlock title="Engine" value={`${ctxState} • ${sampleRate} Hz`}>
          <span className="text-[10px] uppercase tracking-widest text-dim">
            {loopbackActive ? "Loopback active" : "Idle"}
          </span>
        </DiagBlock>
      </div>

      <div className="mt-3 flex gap-2 flex-wrap">
        <button
          onClick={async () => {
            const engine = getEngine();
            if (settings.audioOutputDeviceId) {
              const ok = await engine.setOutputDevice(settings.audioOutputDeviceId);
              toast(ok ? "Output re-routed" : "setSinkId() failed - check console");
            } else {
              const ok = await engine.setOutputDevice("");
              toast(ok ? "Output reset to system default" : "setSinkId() failed");
            }
          }}
          className="rounded-lg border border-cyan/40 bg-cyan/10 hover:bg-cyan/20 px-3 py-1.5 text-xs text-cyan font-semibold"
        >
          Re-apply output routing
        </button>
        <button
          onClick={async () => {
            // Quick beep test: play a 1 kHz sine through the engine.
            const engine = getEngine();
            await engine.resume();
            const ctx = engine.ctx;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.frequency.value = 1000;
            gain.gain.value = 0.0;
            osc.connect(gain).connect(engine.inputBus);
            const t = ctx.currentTime;
            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(0.15, t + 0.02);
            gain.gain.setValueAtTime(0.15, t + 0.6);
            gain.gain.linearRampToValueAtTime(0, t + 0.7);
            osc.start();
            osc.stop(t + 0.72);
            osc.onended = () => {
              try { osc.disconnect(); } catch { /* ignore */ }
              try { gain.disconnect(); } catch { /* ignore */ }
            };
            toast("Played a 1 kHz beep through the engine output");
          }}
          className="rounded-lg border border-white/15 hover:bg-white/5 px-3 py-1.5 text-xs"
        >
          Test app output (1 kHz beep)
        </button>
      </div>
    </GlassPanel>
  );
}

function DiagBlock({
  title,
  value,
  children,
}: {
  title: string;
  value: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/10 p-3 bg-black/30">
      <div className="text-[10px] uppercase tracking-[0.25em] text-dim">{title}</div>
      <div className="text-sm text-white/90 truncate mt-0.5" title={value}>{value}</div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

/** Simple horizontal level meter for VU-style monitoring. */
function Meter({ level, active, label }: { level: number; active: boolean; label: string }) {
  // Convert RMS to a 0..1 visual scale with mild gamma so quiet signals are
  // visible. RMS of 0.3 ≈ healthy listening level.
  const visual = Math.min(1, Math.pow(Math.max(0, level) / 0.4, 0.6));
  const dbApprox = level > 0.00001 ? 20 * Math.log10(level) : -Infinity;
  return (
    <div className="flex items-center gap-2">
      <div className="text-[10px] font-mono w-7 text-dim">{label}</div>
      <div className="relative flex-1 h-3 rounded-full bg-white/[0.04] overflow-hidden border border-white/8">
        <div
          className="absolute inset-y-0 left-0 transition-[width]"
          style={{
            width: `${visual * 100}%`,
            background: `linear-gradient(90deg, ${active ? "#22e8ff" : "#666"}, ${active && visual > 0.7 ? "#ff2bd6" : active ? "#7a3bff" : "#444"})`,
            boxShadow: active && visual > 0.05 ? "0 0 8px rgba(34,232,255,0.5)" : "none",
          }}
        />
      </div>
      <div className="text-[10px] font-mono w-12 text-right text-dim">
        {dbApprox === -Infinity ? "—∞" : `${dbApprox.toFixed(0)} dB`}
      </div>
    </div>
  );
}

/**
 * VIRTUAL-CABLE / SYSTEM-WIDE AUDIO ROUTING.
 *
 * This is THE panel that turns Kill-Chain into a real system-wide
 * DSP suite (Equalizer-APO / FxSound / Boom 3D style). The idea:
 *
 *   1. User installs VB-Audio CABLE (free, one-click, ~5 MB driver).
 *   2. User sets Windows default playback to "CABLE Input".
 *   3. Kill-Chain captures from "CABLE Output" (the input side of
 *      the virtual pair) and outputs to the user's REAL device via
 *      setSinkId. No feedback because the captured device is virtual.
 *
 * We detect the cable by enumerating audio inputs and looking for any
 * device whose label matches "cable output" (case-insensitive) — also
 * matches Voicemeeter, VAC, Synchronous Audio Router, and other clones.
 */
function AudioRoutingSection() {
  const settings = useSettingsStore();
  const toast = useUIStore((s) => s.toast);
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [needsPermission, setNeedsPermission] = useState(false);
  /** PowerShell-detected friendly names of virtual cables present on the OS,
   *  independent of the renderer's microphone permission status. */
  const [osVirtualCables, setOsVirtualCables] = useState<string[]>([]);

  const refresh = async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const ins = all.filter(
        (d) => d.kind === "audioinput" && d.deviceId && d.deviceId !== "default" && d.deviceId !== "communications",
      );
      setInputs(ins);
      setNeedsPermission(ins.some((d) => !d.label));
    } catch (err) {
      console.warn("[settings] enumerateDevices failed:", err);
    }
    // Independent OS-level scan so we can show the right banner even when
    // the renderer hasn't been granted mic permission yet.
    try {
      const names = (await window.playground?.audioDevices?.listVirtualCables?.()) ?? [];
      setOsVirtualCables(names);
    } catch (err) {
      console.warn("[settings] virtual-cable scan failed:", err);
    }
  };

  useEffect(() => {
    void refresh();
    const handler = () => { void refresh(); };
    navigator.mediaDevices.addEventListener?.("devicechange", handler);
    return () => navigator.mediaDevices.removeEventListener?.("devicechange", handler);
  }, []);

  async function unlockLabels() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      await refresh();
    } catch (err) {
      console.warn("[settings] mic permission denied:", err);
      toast("Microphone permission needed to read device names.");
    }
  }

  // Matches all common virtual-cable friendly names. VB-Audio in particular
  // ships several variants whose labels Windows reports differently:
  //   "CABLE Input"        (basic, 2-ch)        - stereo
  //   "CABLE Output"       (basic, 2-ch capture)
  //   "CABLE In 16ch"      (Hi-Fi A+B,  16-ch)
  //   "CABLE Out 16ch"     (Hi-Fi A+B,  16-ch capture)
  //   "CABLE-A Input"      (A+B variant)
  //   "VoiceMeeter Input"  (Voicemeeter)
  //   "Line 1"             (Virtual Audio Cable by Eugene Muzychenko)
  // Hence the broad `\bcable\b` plus explicit driver-name matches.
  const cableLabelRegex = /\bcable\b|vb-audio|vb-cable|voicemeeter|virtual audio cable|synchronous audio router|hifi cable/i;
  const virtualCables = inputs.filter((d) => d.label && cableLabelRegex.test(d.label));
  // Trust the OS-level scan first (works even before mic permission). Fall
  // back to label-match on the renderer's device list. Final fallback:
  // assume some hidden input could be the cable if the user hasn't granted
  // permission yet (we'll prompt them to reveal labels).
  const cableInstalled =
    osVirtualCables.length > 0 ||
    virtualCables.length > 0 ||
    (needsPermission && inputs.length > 1);

  const pick = async (deviceId: string) => {
    settings.set("audioInputSource", deviceId);
    if (deviceId === "") {
      toast("Switched to system loopback (single-device, has feedback risk)");
      return;
    }
    const name = inputs.find((d) => d.deviceId === deviceId)?.label || "selected input";

    // CRITICAL: if the user picked a virtual cable input and the app's
    // sink is still empty (= system default), the app would loop the
    // signal back into the cable (apps → CABLE Input → CABLE Output →
    // app → CABLE Input via system default → ...). Detect this and
    // auto-route the app's output to a real (non-virtual) device.
    if (!settings.audioOutputDeviceId) {
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        const realOut = all.find(
          (d) =>
            d.kind === "audiooutput" &&
            d.deviceId &&
            d.deviceId !== "default" &&
            d.deviceId !== "communications" &&
            d.label &&
            !cableLabelRegex.test(d.label),
        );
        if (realOut) {
          settings.set("audioOutputDeviceId", realOut.deviceId);
          const engine = getEngine();
          await engine.setOutputDevice(realOut.deviceId);
          toast(
            `Capturing from ${name}. App output auto-routed to ${realOut.label} ` +
            "(prevents loop through the virtual cable).",
          );
          return;
        } else {
          toast(
            `Capturing from ${name}. WARNING: also pick a real output device ` +
            "below or audio will loop through the virtual cable.",
          );
          return;
        }
      } catch { /* ignore */ }
    }
    toast(`Capturing from ${name}`);
  };

  return (
    <GlassPanel intense className="p-5">
      <Section
        title="System-Wide Audio Routing"
        sub="Route ALL Windows audio (Spotify, YouTube, games, Discord...) through Kill-Chain - the same trick Equalizer APO and FxSound use."
      />

      {/* STATUS BANNER */}
      <div
        className={`mt-3 rounded-2xl p-4 border ${
          settings.audioInputSource && virtualCables.some((d) => d.deviceId === settings.audioInputSource)
            ? "border-cyan/50 bg-cyan/10"
            : cableInstalled
              ? "border-yellow-400/40 bg-yellow-400/5"
              : "border-white/15 bg-white/[0.02]"
        }`}
      >
        {settings.audioInputSource && virtualCables.some((d) => d.deviceId === settings.audioInputSource) ? (
          <>
            <div className="text-cyan text-sm font-semibold mb-1">
              ✓ Virtual cable routing active
            </div>
            <div className="text-[12px] leading-relaxed text-white/85">
              Kill-Chain captures from <span className="font-mono">{
                virtualCables.find((d) => d.deviceId === settings.audioInputSource)?.label
              }</span>. Make sure Windows default playback is set to <span className="font-mono">CABLE Input</span> and the app's output (below) is your real headphones / speakers. Everything you play in Windows now flows through the DSP.
            </div>
          </>
        ) : cableInstalled ? (
          <>
            <div className="text-yellow-300 text-sm font-semibold mb-1">
              Virtual cable detected — finish setup below
            </div>
            <div className="text-[12px] leading-relaxed text-white/80">
              A virtual audio cable is installed. Pick its <em>output</em> side
              from the list below and Kill-Chain will start capturing
              everything Windows sends to it. No feedback, full DSP.
            </div>
          </>
        ) : (
          <>
            <div className="text-sm font-semibold mb-1">
              No virtual cable detected
            </div>
            <div className="text-[12px] leading-relaxed text-dim">
              Without a virtual cable, Exterior Audio can only capture the
              system loopback — which feeds back on a single device. Install
              VB-Audio CABLE (free, ~5 MB, one-click) to unlock proper
              system-wide DSP.
            </div>
          </>
        )}
      </div>

      {/* INSTALL WALKTHROUGH */}
      {!cableInstalled && (
        <div className="mt-3 rounded-2xl border border-white/10 p-4 bg-black/30">
          <div className="text-[11px] uppercase tracking-[0.25em] text-cyan/80 mb-3">
            One-time setup (≈ 2 minutes)
          </div>
          <ol className="space-y-3 text-[12px] leading-relaxed">
            <li className="flex gap-3">
              <span className="text-cyan font-mono">1.</span>
              <span>
                Download <strong>VB-Audio CABLE</strong> from the official site.
                Free for personal use.
                <div className="mt-1.5">
                  <button
                    onClick={() => {
                      if (window.playground?.shellOpen) {
                        window.playground.shellOpen("https://vb-audio.com/Cable/");
                      } else {
                        window.open("https://vb-audio.com/Cable/", "_blank");
                      }
                    }}
                    className="inline-block rounded-lg border border-cyan/40 bg-cyan/10 hover:bg-cyan/20 px-3 py-1.5 text-xs text-cyan font-semibold"
                  >
                    Open vb-audio.com/Cable
                  </button>
                </div>
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-cyan font-mono">2.</span>
              <span>
                Run <span className="font-mono">VBCABLE_Setup_x64.exe</span> as
                administrator, click "Install Driver", reboot when prompted.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-cyan font-mono">3.</span>
              <span>
                Open Windows Sound settings (
                <button
                  onClick={() => {
                    if (window.playground?.shellOpen) {
                      window.playground.shellOpen("ms-settings:sound");
                    }
                  }}
                  className="underline text-cyan/85 hover:text-cyan"
                >
                  ms-settings:sound
                </button>
                ) and set <strong>"CABLE Input"</strong> as your default playback device.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-cyan font-mono">4.</span>
              <span>
                Below, set Kill-Chain's output (the next section,{" "}
                <em>Audio Output Device</em>) to your real headphones /
                speakers — NOT CABLE Input. Then pick CABLE Output as the
                input in the device list below.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-cyan font-mono">5.</span>
              <span>
                Click <strong>Enable Exterior Audio</strong> in the transport
                bar. Everything Windows plays is now flowing through the lab.
              </span>
            </li>
          </ol>
          <button
            onClick={() => void refresh()}
            className="mt-3 rounded-lg border border-white/10 hover:bg-white/5 px-3 py-1.5 text-xs"
          >
            I installed it — recheck
          </button>
        </div>
      )}

      {/* PERMISSION HINT */}
      {needsPermission && (
        <div className="mt-3 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px]">
          <span className="text-dim flex-1">
            Device names are hidden until you allow one-time microphone access.
            We don't record anything — only the device list is read.
          </span>
          <button
            onClick={() => void unlockLabels()}
            className="rounded-lg border border-cyan/40 bg-cyan/10 hover:bg-cyan/20 px-3 py-1.5 text-xs text-cyan"
          >
            Reveal names
          </button>
        </div>
      )}

      {/* CAPTURE SOURCE PICKER */}
      <div className="mt-4">
        <div className="text-[10px] uppercase tracking-[0.3em] text-dim mb-2">
          Capture source
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <DeviceTile
            label="System loopback (default)"
            sub="Captures whatever Windows is playing. Single-device → feedback risk."
            active={settings.audioInputSource === ""}
            onClick={() => { void pick(""); }}
          />
          {virtualCables.map((d) => (
            <DeviceTile
              key={d.deviceId}
              label={`★ ${d.label || `Virtual cable ${d.deviceId.slice(0, 6)}...`}`}
              sub="Recommended - virtual cable, no feedback, full DSP."
              active={settings.audioInputSource === d.deviceId}
              onClick={() => { void pick(d.deviceId); }}
            />
          ))}
          {inputs
            .filter((d) => !virtualCables.includes(d))
            .map((d) => (
              <DeviceTile
                key={d.deviceId}
                label={d.label || `Input ${d.deviceId.slice(0, 6)}...`}
                sub="Hardware input (mic, line-in)"
                active={settings.audioInputSource === d.deviceId}
                onClick={() => { void pick(d.deviceId); }}
              />
            ))}
        </div>
        <button
          onClick={() => void refresh()}
          className="mt-3 rounded-lg border border-white/10 hover:bg-white/5 px-3 py-1.5 text-xs"
        >
          Refresh device list
        </button>
      </div>

      <div className="mt-3 text-[11px] text-dim leading-relaxed">
        Other supported virtual cables: <strong>Voicemeeter</strong>,{" "}
        <strong>VAC (Virtual Audio Cable)</strong>,{" "}
        <strong>Synchronous Audio Router</strong>. Anything that exposes a
        playback/capture pair will work — pick the capture half here, set
        the playback half as your Windows default.
      </div>
    </GlassPanel>
  );
}

function OutputDeviceSection() {
  const settings = useSettingsStore();
  const toast = useUIStore((s) => s.toast);
  const loopbackActive = usePlayerStore((s) => s.loopbackActive);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [needsPermission, setNeedsPermission] = useState(false);

  const refresh = async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const outs = all.filter((d) => d.kind === "audiooutput");
      setDevices(outs);
      // Labels are empty strings until the page has been granted a media
      // permission at least once. Detect that and prompt the user.
      setNeedsPermission(outs.some((d) => !d.label));
    } catch (err) {
      console.warn("[settings] enumerateDevices failed:", err);
    }
  };

  useEffect(() => {
    void refresh();
    const handler = () => { void refresh(); };
    navigator.mediaDevices.addEventListener?.("devicechange", handler);
    return () => {
      navigator.mediaDevices.removeEventListener?.("devicechange", handler);
    };
  }, []);

  async function unlockLabels() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      await refresh();
    } catch (err) {
      console.warn("[settings] mic permission denied:", err);
      toast("Couldn't read device names - microphone permission needed once.");
    }
  }

  async function pick(deviceId: string) {
    settings.set("audioOutputDeviceId", deviceId);
    const engine = getEngine();
    const ok = await engine.setOutputDevice(deviceId);
    if (ok) {
      const name = devices.find((d) => d.deviceId === deviceId)?.label
        || (deviceId === "" ? "System default" : deviceId);
      toast(`Output → ${name}`);
    } else {
      toast("Couldn't switch output. Falling back to system default.");
    }
  }

  return (
    <GlassPanel intense className="p-5">
      <Section
        title="Audio Output Device"
        sub="Where the app sends its processed audio. Pick a separate device from your default to avoid feedback when Exterior Audio is on."
      />

      {loopbackActive && (
        <div className="mt-3 rounded-xl border border-plasma/40 bg-plasma/10 px-4 py-3 text-[12px] leading-relaxed">
          <div className="font-semibold text-plasma mb-1">
            Exterior Audio is on
          </div>
          The app is capturing everything coming out of your default device.
          If the app's output goes to the same device, the signal feeds back
          into the capture and creates that nasty howl. Best fix: pick a
          <span className="text-plasma font-semibold"> different output device </span>
          below (Bluetooth, a USB DAC, second audio interface...). On a
          single-device setup, output gain is auto-trimmed to keep the loop
          stable but some echo is unavoidable.
        </div>
      )}

      {needsPermission && (
        <div className="mt-3 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px]">
          <span className="text-dim flex-1">
            Device names are hidden until you allow one-time microphone access.
            Nothing is recorded - we only read the device list.
          </span>
          <button
            onClick={() => void unlockLabels()}
            className="rounded-lg border border-cyan/40 bg-cyan/10 hover:bg-cyan/20 px-3 py-1.5 text-xs text-cyan"
          >
            Reveal names
          </button>
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
        <DeviceTile
          label="System default"
          sub="Whatever Windows picks (changes when you swap headphones)"
          active={settings.audioOutputDeviceId === ""}
          onClick={() => void pick("")}
        />
        {devices
          .filter((d) => d.deviceId && d.deviceId !== "default" && d.deviceId !== "communications")
          .map((d) => (
            <DeviceTile
              key={d.deviceId}
              label={d.label || `Device ${d.deviceId.slice(0, 6)}...`}
              sub={d.label ? "Direct route" : "(label hidden - tap Reveal names above)"}
              active={settings.audioOutputDeviceId === d.deviceId}
              onClick={() => void pick(d.deviceId)}
            />
          ))}
      </div>

      <button
        onClick={() => void refresh()}
        className="mt-3 rounded-lg border border-white/10 hover:bg-white/5 px-3 py-1.5 text-xs"
      >
        Refresh device list
      </button>

      <div className="mt-3 text-[11px] text-dim leading-relaxed">
        Uses <code className="font-mono text-white/70">AudioContext.setSinkId()</code> (Chromium 110+).
        Routes <em>only</em> Kill-Chain's output - the captured source
        keeps playing through Windows as normal.
      </div>
    </GlassPanel>
  );
}

function DeviceTile({
  label,
  sub,
  active,
  onClick,
}: {
  label: string;
  sub: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-2xl p-3.5 border text-left transition ${
        active
          ? "border-cyan/60 bg-cyan/10"
          : "border-white/10 hover:border-white/25 hover:bg-white/[0.03]"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold truncate">{label}</div>
        {active && (
          <span className="text-[10px] uppercase tracking-widest text-cyan">Active</span>
        )}
      </div>
      <div className="text-[11px] text-dim mt-1 leading-snug">{sub}</div>
    </button>
  );
}

function Section({ title, sub }: { title: string; sub: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-[0.3em] text-dim">{title}</div>
      <div className="text-sm text-white/80 mt-0.5">{sub}</div>
    </div>
  );
}

/** Compact bordered toggle tile (Look & feel switches). */
function ToggleCard({
  on, onToggle, title, sub,
}: {
  on: boolean;
  onToggle: () => void;
  title: string;
  sub: string;
}) {
  return (
    <button
      onClick={onToggle}
      data-ui-sound="toggle"
      data-ui-on={on ? "true" : "false"}
      className={`rounded-xl border px-3 py-2.5 text-left transition ${
        on
          ? "border-cyan/50 bg-cyan/[0.07]"
          : "border-white/10 bg-white/[0.02] hover:border-white/25"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`text-sm font-semibold ${on ? "text-white" : "text-white/60"}`}>{title}</span>
        <span className={`w-8 h-4.5 h-[18px] rounded-full relative shrink-0 transition ${on ? "bg-cyan/60" : "bg-white/15"}`}>
          <span
            className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-all ${on ? "left-[16px]" : "left-0.5"}`}
          />
        </span>
      </div>
      <div className="text-[10px] text-dim mt-1 leading-snug">{sub}</div>
    </button>
  );
}

function ToggleRow({
  label,
  sub,
  value,
  onChange,
}: {
  label: string;
  sub: string;
  value: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 p-3 rounded-xl">
      <div>
        <div className="text-sm">{label}</div>
        <div className="text-[11px] text-dim leading-snug">{sub}</div>
      </div>
      <button
        onClick={onChange}
        role="switch"
        aria-checked={value}
        aria-label={label}
        data-ui-sound="toggle"
        data-ui-on={value ? "true" : "false"}
        className={`w-12 h-6 rounded-full border transition relative ${
          value
            ? "border-cyan/60 bg-cyan/20"
            : "border-white/15 bg-white/[0.04]"
        }`}
      >
        <span
          className="absolute top-0.5 w-5 h-5 rounded-full transition-all"
          style={{
            background: value ? "#22e8ff" : "rgba(255,255,255,0.6)",
            left: value ? "calc(100% - 22px)" : "2px",
            boxShadow: value ? "0 0 14px rgba(34,232,255,0.6)" : "none",
          }}
        />
      </button>
    </div>
  );
}
