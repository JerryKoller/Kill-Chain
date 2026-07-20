import { useEffect, useRef } from "react";
import {
  useDimensionStore,
  SPEAKER_META,
  MOTION_BANDS,
  motionBandCentre,
  type Speaker,
} from "@/state/dimensionStore";
import { useEqStore, type EqBand } from "@/state/eqStore";
import { usePlayerStore } from "@/state/playerStore";
import { getEngine } from "@/audio/AudioEngine";
import { distanceGainDb } from "@/audio/dsp/Spatializer3D";

/** Minimal 3-vector helpers (no deps — keeps the renderer lightweight). */
interface V3 {
  x: number;
  y: number;
  z: number;
}
const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scl = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: V3, b: V3): V3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const norm = (a: V3): V3 => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};

interface Frame {
  eye: V3;
  right: V3;
  upv: V3;
  fwd: V3;
  focal: number;
  cx: number;
  cy: number;
  hx: number;
  hy: number;
  hz: number;
}

interface Projected {
  sx: number;
  sy: number;
  depth: number;
  scale: number;
}

function project(f: Frame, p: V3): Projected | null {
  const rel = sub(p, f.eye);
  const cz = dot(rel, f.fwd);
  if (cz <= 0.05) return null;
  const sx = f.cx + (dot(rel, f.right) / cz) * f.focal;
  const sy = f.cy - (dot(rel, f.upv) / cz) * f.focal;
  return { sx, sy, depth: cz, scale: f.focal / cz };
}

/** Cast the cursor ray onto a horizontal plane (y = planeY) → world point. */
function raycastToPlane(f: Frame, sx: number, sy: number, planeY: number): V3 | null {
  const dir = norm(
    add(
      add(scl(f.right, (sx - f.cx) / f.focal), scl(f.upv, -(sy - f.cy) / f.focal)),
      f.fwd,
    ),
  );
  if (Math.abs(dir.y) < 1e-4) return null;
  const t = (planeY - f.eye.y) / dir.y;
  if (t <= 0) return null;
  return add(f.eye, scl(dir, t));
}

function formatHz(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)}k` : `${Math.round(hz)}`;
}

/** Hue (violet→cyan→amber) by log frequency for band markers. */
function bandColor(hz: number): string {
  const t = Math.max(0, Math.min(1, Math.log2(hz / 20) / Math.log2(20000 / 20)));
  const hue = 280 - t * 250; // 280 (violet) → 30 (amber)
  return `hsl(${hue}, 90%, 62%)`;
}

interface DragState {
  kind: "orbit" | "move" | "height";
  id?: string;
  startX: number;
  startY: number;
  startAz: number;
  startEl: number;
  startNy: number;
  planeY: number;
}

export function Room3DCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Camera (kept in a ref so the rAF loop sees live values without re-renders).
  const camRef = useRef({ az: 0.62, el: 0.5, dist: 16 });
  const frameRef = useRef<Frame | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const dirtyRef = useRef(true);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });

  // Store slices — re-render (and mark dirty) whenever the scene changes.
  const speakers = useDimensionStore((s) => s.speakers);
  const room = useDimensionStore((s) => s.room);
  const mode = useDimensionStore((s) => s.mode);
  const listenerYaw = useDimensionStore((s) => s.listenerYaw);
  const selectedId = useDimensionStore((s) => s.selectedId);
  const bandPlacements = useDimensionStore((s) => s.bandPlacements);
  const active = useDimensionStore((s) => s.active);
  const bands = useEqStore((s) => s.bands);

  // Snapshot the latest scene for the animation loop.
  const sceneRef = useRef({ speakers, room, mode, listenerYaw, selectedId, bandPlacements, bands, active });
  sceneRef.current = { speakers, room, mode, listenerYaw, selectedId, bandPlacements, bands, active };
  dirtyRef.current = true;

  // Fit camera distance to the room the first time / when it grows a lot.
  useEffect(() => {
    const maxDim = Math.max(room.width, room.depth);
    camRef.current.dist = Math.max(8, Math.min(48, maxDim * 1.9 + 4));
    dirtyRef.current = true;
  }, [room.width, room.depth]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      sizeRef.current = { w, h, dpr };
      dirtyRef.current = true;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const buildFrame = (): Frame => {
      const { az, el, dist } = camRef.current;
      const { w, h } = sizeRef.current;
      const sc = sceneRef.current;
      const eye: V3 = {
        x: dist * Math.cos(el) * Math.sin(az),
        y: dist * Math.sin(el),
        z: dist * Math.cos(el) * Math.cos(az),
      };
      const fwd = norm(scl(eye, -1));
      const right = norm(cross(fwd, { x: 0, y: 1, z: 0 }));
      const upv = cross(right, fwd);
      const focal = h / 2 / Math.tan((55 * Math.PI) / 180 / 2);
      return {
        eye, right, upv, fwd, focal,
        cx: w / 2, cy: h / 2,
        hx: sc.room.width / 2, hy: sc.room.height / 2, hz: sc.room.depth / 2,
      };
    };

    const worldOf = (n: { nx: number; ny: number; nz: number }, f: Frame): V3 => ({
      x: n.nx * f.hx,
      y: n.ny * f.hy,
      z: n.nz * f.hz,
    });

    const drawFloorAndRoom = (f: Frame) => {
      const { hx, hy, hz } = f;
      // Floor grid.
      ctx.lineWidth = 1;
      const gx = 6, gz = 6;
      ctx.strokeStyle = "rgba(120,160,200,0.10)";
      ctx.beginPath();
      for (let i = 0; i <= gx; i++) {
        const x = -hx + (i / gx) * (2 * hx);
        const a = project(f, { x, y: -hy, z: -hz });
        const b = project(f, { x, y: -hy, z: hz });
        if (a && b) { ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); }
      }
      for (let i = 0; i <= gz; i++) {
        const z = -hz + (i / gz) * (2 * hz);
        const a = project(f, { x: -hx, y: -hy, z });
        const b = project(f, { x: hx, y: -hy, z });
        if (a && b) { ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); }
      }
      ctx.stroke();

      // Room wireframe box.
      const corners: V3[] = [
        { x: -hx, y: -hy, z: -hz }, { x: hx, y: -hy, z: -hz },
        { x: hx, y: -hy, z: hz }, { x: -hx, y: -hy, z: hz },
        { x: -hx, y: hy, z: -hz }, { x: hx, y: hy, z: -hz },
        { x: hx, y: hy, z: hz }, { x: -hx, y: hy, z: hz },
      ];
      const edges = [
        [0, 1], [1, 2], [2, 3], [3, 0],
        [4, 5], [5, 6], [6, 7], [7, 4],
        [0, 4], [1, 5], [2, 6], [3, 7],
      ];
      ctx.strokeStyle = "rgba(90,200,255,0.22)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (const [a, b] of edges) {
        const pa = project(f, corners[a]);
        const pb = project(f, corners[b]);
        if (pa && pb) { ctx.moveTo(pa.sx, pa.sy); ctx.lineTo(pb.sx, pb.sy); }
      }
      ctx.stroke();

      // Front-of-room marker so orientation is unambiguous.
      const fl = project(f, { x: -hx, y: -hy, z: -hz });
      const fr = project(f, { x: hx, y: -hy, z: -hz });
      if (fl && fr) {
        ctx.strokeStyle = "rgba(90,230,255,0.5)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(fl.sx, fl.sy);
        ctx.lineTo(fr.sx, fr.sy);
        ctx.stroke();
        const mid = project(f, { x: 0, y: -hy, z: -hz });
        if (mid) {
          ctx.fillStyle = "rgba(150,235,255,0.65)";
          ctx.font = "600 11px Inter, system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText("FRONT", mid.sx, mid.sy + 16);
        }
      }
    };

    const drawCharacter = (f: Frame) => {
      const yaw = sceneRef.current.listenerYaw;
      const fwdL: V3 = { x: Math.sin(yaw), y: 0, z: -Math.cos(yaw) };
      const rightL = norm(cross(fwdL, { x: 0, y: 1, z: 0 }));
      const floorY = -f.hy;
      // Chair base shadow.
      const base = project(f, { x: 0, y: floorY, z: 0 });
      const head = project(f, { x: 0, y: 0.15, z: 0 });
      if (base) {
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.beginPath();
        const rs = (base.scale || 40) * 0.45;
        ctx.ellipse(base.sx, base.sy, rs, rs * 0.4, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // Facing arrow on the floor.
      const tip = project(f, add(scl(fwdL, f.hz * 0.5), { x: 0, y: floorY + 0.02, z: 0 }));
      if (base && tip) {
        ctx.strokeStyle = "rgba(90,230,255,0.85)";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(base.sx, base.sy);
        ctx.lineTo(tip.sx, tip.sy);
        ctx.stroke();
        ctx.fillStyle = "rgba(90,230,255,0.95)";
        ctx.beginPath();
        ctx.arc(tip.sx, tip.sy, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      // Torso.
      const hip = project(f, { x: 0, y: -0.5, z: 0 });
      if (head && hip) {
        ctx.strokeStyle = "rgba(180,210,235,0.8)";
        ctx.lineWidth = Math.max(6, (head.scale || 40) * 0.22);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(head.sx, head.sy);
        ctx.lineTo(hip.sx, hip.sy);
        ctx.stroke();
        ctx.lineCap = "butt";
      }
      // Head.
      if (head) {
        const r = Math.max(8, (head.scale || 40) * 0.16);
        const grd = ctx.createRadialGradient(head.sx, head.sy - r * 0.3, r * 0.2, head.sx, head.sy, r);
        grd.addColorStop(0, "rgba(225,240,255,0.95)");
        grd.addColorStop(1, "rgba(150,180,210,0.85)");
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(head.sx, head.sy, r, 0, Math.PI * 2);
        ctx.fill();
        // Ears (the listener's actual pickup points).
        for (const sgn of [-1, 1]) {
          const ear = project(f, add(scl(rightL, sgn * 0.12), { x: 0, y: 0.13, z: 0 }));
          if (ear) {
            ctx.fillStyle = "rgba(90,230,255,0.95)";
            ctx.beginPath();
            ctx.arc(ear.sx, ear.sy, Math.max(2.5, r * 0.22), 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    };

    const drawSpeakerIcon = (
      p: Projected,
      color: string,
      level: number,
      selected: boolean,
      label: string,
      big: boolean,
      floor: Projected | null,
      subLabel?: string,
      muted = false,
    ) => {
      // Muted speakers stay visible as ghosts (issue #7): before, they were
      // simply not drawn — which read as "muting DELETES the speaker".
      if (muted) ctx.globalAlpha = 0.32;
      // Stem from the floor so height reads clearly.
      if (floor) {
        ctx.strokeStyle = "rgba(150,180,210,0.25)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(floor.sx, floor.sy);
        ctx.lineTo(p.sx, p.sy);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.beginPath();
        const rs = p.scale * (big ? 0.16 : 0.1);
        ctx.ellipse(floor.sx, floor.sy, rs, rs * 0.4, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      const size = p.scale * (big ? 0.16 : 0.11);
      const w = Math.max(10, size);
      const h = Math.max(12, size * (big ? 1 : 1.4));
      if (!muted) {
        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur = 8 + level * 26;
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.32 + level * 0.5;
        roundRect(ctx, p.sx - w / 2, p.sy - h / 2, w, h, Math.min(6, w * 0.3));
        ctx.fill();
        ctx.restore();
      }

      ctx.lineWidth = selected ? 2.5 : 1.2;
      ctx.strokeStyle = selected ? "#ffffff" : color;
      if (muted) ctx.setLineDash([4, 3]);
      roundRect(ctx, p.sx - w / 2, p.sy - h / 2, w, h, Math.min(6, w * 0.3));
      ctx.stroke();
      ctx.setLineDash([]);

      // Driver dot (crossed out when muted).
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, Math.max(2, w * 0.18), 0, Math.PI * 2);
      ctx.fill();
      if (muted) {
        ctx.strokeStyle = "rgba(255,160,160,0.9)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(p.sx - w * 0.32, p.sy + h * 0.32);
        ctx.lineTo(p.sx + w * 0.32, p.sy - h * 0.32);
        ctx.stroke();
      }

      if (selected) {
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, h * 0.8, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.fillStyle = "rgba(230,240,255,0.9)";
      ctx.font = "600 10px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(label, p.sx, p.sy - h / 2 - 5);

      // Acoustic truth for the selection: distance + inverse-law loss.
      if (subLabel) {
        ctx.fillStyle = muted ? "rgba(255,170,170,0.9)" : "rgba(150,235,255,0.85)";
        ctx.font = "600 9px Inter, system-ui, sans-serif";
        ctx.fillText(subLabel, p.sx, p.sy + h / 2 + 11);
      }
      ctx.globalAlpha = 1;
    };

    /** Per-ear RMS bars — what the binaural output actually delivers. */
    const drawEarMeters = () => {
      if (!sceneRef.current.active) return;
      let ears = { left: 0, right: 0 };
      try { ears = getEngine().dimension.getEarLevels(); } catch { return; }
      const { w } = sizeRef.current;
      const bw = 10, bh = 54, gap = 8;
      const x0 = w - 14 - bw * 2 - gap;
      const y0 = 14;
      ctx.font = "600 9px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      (["left", "right"] as const).forEach((side, i) => {
        const x = x0 + i * (bw + gap);
        const lvl = ears[side];
        ctx.fillStyle = "rgba(255,255,255,0.06)";
        ctx.fillRect(x, y0, bw, bh);
        const hh = bh * lvl;
        ctx.fillStyle = side === "left" ? "rgba(90,230,255,0.9)" : "rgba(255,138,72,0.9)";
        ctx.fillRect(x, y0 + bh - hh, bw, hh);
        ctx.strokeStyle = "rgba(255,255,255,0.15)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y0, bw, bh);
        ctx.fillStyle = "rgba(230,240,255,0.75)";
        ctx.fillText(side === "left" ? "L" : "R", x + bw / 2, y0 + bh + 11);
      });
      ctx.fillStyle = "rgba(230,240,255,0.5)";
      ctx.fillText("EARS", x0 + (bw * 2 + gap) / 2, y0 - 5);
    };

    const render = () => {
      const f = buildFrame();
      frameRef.current = f;
      const sc = sceneRef.current;
      const { w, h, dpr } = sizeRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      drawFloorAndRoom(f);

      // Live levels for the glow.
      let levels: Record<string, number> = {};
      try { levels = getEngine().dimension.getVoiceLevels(); } catch { /* ignore */ }

      // Collect drawables (speakers/bands + character) and depth-sort.
      interface Item { depth: number; draw: () => void; }
      const items: Item[] = [];

      const charP = project(f, { x: 0, y: 0, z: 0 });
      if (charP) items.push({ depth: charP.depth, draw: () => drawCharacter(f) });

      if (sc.mode === "speaker") {
        for (const s of sc.speakers as Speaker[]) {
          const world = worldOf(s, f);
          const p = project(f, world);
          if (!p) continue;
          const floor = project(f, { x: world.x, y: -f.hy, z: world.z });
          const meta = SPEAKER_META[s.type];
          const lvl = s.enabled ? levels[s.id] ?? 0 : 0;
          const sel = sc.selectedId === s.id;
          const big = s.type === "subwoofer" || s.type === "tower";
          const dist = Math.hypot(world.x, world.y, world.z);
          const sub = !s.enabled
            ? "MUTED"
            : sel
              ? `${dist.toFixed(1)} m · ${distanceGainDb(dist).toFixed(1)} dB`
              : undefined;
          items.push({
            depth: p.depth,
            draw: () => drawSpeakerIcon(p, meta.color, lvl, sel, meta.short, big, floor, sub, !s.enabled),
          });
        }
      } else if (sc.mode === "motion") {
        // Motion Mode: the engine owns the positions (bands flying around the
        // head). Before engagement, show the static starting arc so the mode
        // still reads visually.
        let live: { id: string; x: number; y: number; z: number; level: number }[] = [];
        try { live = getEngine().dimension.getMotionPositions(); } catch { /* engine not built yet */ }
        const liveById = new Map(live.map((v) => [v.id, v]));
        MOTION_BANDS.forEach((b, i) => {
          const lv = liveById.get(b.id);
          const world: V3 = lv
            ? { x: lv.x, y: lv.y, z: lv.z }
            : worldOf(defaultBandN(i, MOTION_BANDS.length), f);
          const p = project(f, world);
          if (!p) return;
          const floor = project(f, { x: world.x, y: -f.hy, z: world.z });
          const lvl = lv ? lv.level : levels[b.id] ?? 0;
          const hue = bandColor(motionBandCentre(b));
          items.push({
            depth: p.depth,
            draw: () => {
              drawSpeakerIcon(p, hue, lvl, false, b.label, false, floor);
              // Motion trail dot so direction of travel reads at a glance.
              ctx.fillStyle = hue;
              ctx.globalAlpha = 0.25 + lvl * 0.5;
              ctx.beginPath();
              ctx.arc(p.sx, p.sy, Math.max(2, p.scale * 0.028 * (0.6 + lvl)), 0, Math.PI * 2);
              ctx.fill();
              ctx.globalAlpha = 1;
            },
          });
        });
      } else {
        const active = (sc.bands as EqBand[]).filter((b) => b.enabled);
        active.forEach((b, i) => {
          const pl = sc.bandPlacements[b.id] ?? defaultBandN(i, active.length);
          const world = worldOf(pl, f);
          const p = project(f, world);
          if (!p) return;
          const floor = project(f, { x: world.x, y: -f.hy, z: world.z });
          const lvl = levels[b.id] ?? 0;
          const sel = sc.selectedId === b.id;
          items.push({
            depth: p.depth,
            draw: () => drawSpeakerIcon(p, bandColor(b.freq), lvl, sel, `${formatHz(b.freq)}Hz`, false, floor),
          });
        });
      }

      items.sort((a, b) => b.depth - a.depth);
      for (const it of items) it.draw();

      drawEarMeters();
    };

    let raf = 0;
    const loop = () => {
      const playing = usePlayerStore.getState().status === "playing";
      const sc = sceneRef.current;
      // Motion Mode animates positions continuously while engaged — render
      // every frame so the flight paths are smooth.
      const motionLive = sc.mode === "motion" && sc.active;
      if (dirtyRef.current || playing || motionLive) {
        render();
        dirtyRef.current = false;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    // ───── Interaction ─────
    const pointerPos = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const hitSpeaker = (x: number, y: number): { id: string; ny: number; worldY: number } | null => {
      const f = frameRef.current;
      if (!f) return null;
      const sc = sceneRef.current;
      const hits: { id: string; ny: number; worldY: number; d: number }[] = [];
      const test = (id: string, n: { nx: number; ny: number; nz: number }) => {
        const world = worldOf(n, f);
        const p = project(f, world);
        if (!p) return;
        const d = Math.hypot(p.sx - x, p.sy - y);
        const reach = Math.max(14, p.scale * 0.2);
        if (d < reach) hits.push({ id, ny: n.ny, worldY: world.y, d });
      };
      if (sc.mode === "motion") {
        // Motion Mode: the engine drives the positions — nothing to drag.
        return null;
      }
      if (sc.mode === "speaker") {
        // Muted speakers stay clickable so they can be selected + un-muted.
        for (const s of sc.speakers as Speaker[]) test(s.id, s);
      } else {
        const active = (sc.bands as EqBand[]).filter((b) => b.enabled);
        active.forEach((b, i) => test(b.id, sc.bandPlacements[b.id] ?? defaultBandN(i, active.length)));
      }
      if (hits.length === 0) return null;
      hits.sort((a, b) => a.d - b.d);
      const top = hits[0];
      return { id: top.id, ny: top.ny, worldY: top.worldY };
    };

    const onDown = (e: PointerEvent) => {
      const { x, y } = pointerPos(e);
      const hit = hitSpeaker(x, y);
      const st = useDimensionStore.getState();
      if (hit) {
        st.select(hit.id);
        dragRef.current = {
          kind: e.shiftKey ? "height" : "move",
          id: hit.id,
          startX: x, startY: y,
          startAz: camRef.current.az, startEl: camRef.current.el,
          startNy: hit.ny,
          planeY: hit.worldY,
        };
      } else {
        st.select(null);
        dragRef.current = {
          kind: "orbit",
          startX: x, startY: y,
          startAz: camRef.current.az, startEl: camRef.current.el,
          startNy: 0, planeY: 0,
        };
      }
      canvas.setPointerCapture(e.pointerId);
      dirtyRef.current = true;
    };

    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const { x, y } = pointerPos(e);
      const f = frameRef.current;
      if (drag.kind === "orbit") {
        camRef.current.az = drag.startAz - (x - drag.startX) * 0.01;
        camRef.current.el = Math.max(0.08, Math.min(1.45, drag.startEl + (y - drag.startY) * 0.01));
      } else if (drag.kind === "height" && drag.id && f) {
        const ny = Math.max(-1, Math.min(1, drag.startNy - (y - drag.startY) / 180));
        applyDragPos(drag.id, { ny });
      } else if (drag.kind === "move" && drag.id && f) {
        const world = raycastToPlane(f, x, y, drag.planeY);
        if (world) {
          applyDragPos(drag.id, {
            nx: Math.max(-1, Math.min(1, world.x / f.hx)),
            nz: Math.max(-1, Math.min(1, world.z / f.hz)),
          });
        }
      }
      dirtyRef.current = true;
    };

    const applyDragPos = (id: string, pos: { nx?: number; ny?: number; nz?: number }) => {
      const st = useDimensionStore.getState();
      if (st.mode === "speaker") st.moveSpeaker(id, pos);
      else st.placeBand(id, pos);
    };

    const onUp = (e: PointerEvent) => {
      dragRef.current = null;
      try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      camRef.current.dist = Math.max(4, Math.min(60, camRef.current.dist * (1 + e.deltaY * 0.0012)));
      dirtyRef.current = true;
    };

    const onDouble = (e: PointerEvent) => {
      const { x, y } = pointerPos(e);
      if (hitSpeaker(x, y)) return; // double-click on a speaker does nothing
      const st = useDimensionStore.getState();
      if (st.mode !== "speaker") return;
      const f = frameRef.current;
      if (!f) return;
      const world = raycastToPlane(f, x, y, 0);
      if (!world) return;
      st.addSpeaker(st.paletteType, {
        nx: Math.max(-1, Math.min(1, world.x / f.hx)),
        nz: Math.max(-1, Math.min(1, world.z / f.hz)),
      });
      dirtyRef.current = true;
    };

    // Delete / Backspace removes the selected speaker (issue #7).
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const tgt = e.target as HTMLElement | null;
      if (
        tgt &&
        (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.tagName === "SELECT" || tgt.isContentEditable)
      ) {
        return;
      }
      const st = useDimensionStore.getState();
      if (st.mode !== "speaker" || !st.selectedId) return;
      if (!st.speakers.some((s) => s.id === st.selectedId)) return;
      e.preventDefault();
      st.removeSpeaker(st.selectedId);
      dirtyRef.current = true;
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("dblclick", onDouble as EventListener);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("dblclick", onDouble as EventListener);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <div ref={wrapRef} className="relative w-full h-full min-h-[320px]">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 touch-none cursor-grab active:cursor-grabbing rounded-xl"
      />
      <div className="pointer-events-none absolute bottom-2 left-3 text-[10px] text-white/40 leading-relaxed">
        Drag empty space to orbit · scroll to zoom · drag a speaker to move ·
        hold Shift to raise/lower · double-click the floor to add ·
        Delete removes the selected speaker
      </div>
    </div>
  );
}

function defaultBandN(rank: number, total: number) {
  const t = total <= 1 ? 0.5 : rank / (total - 1);
  const angle = (-100 + t * 200) * (Math.PI / 180);
  const r = 0.78;
  return { nx: Math.sin(angle) * r, ny: -0.2 + t * 0.7, nz: -Math.cos(angle) * r };
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
