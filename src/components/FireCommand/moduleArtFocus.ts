/**
 * Scroll-linked focus for module backdrop art.
 * Modules nearest the rack viewport center get --fc-art-focus → 1 (brighter art).
 *
 * Perf notes: scroll root is cached per node; root rect measured once per RAF;
 * style writes are skipped when focus barely changes.
 */

const nodes = new Set<HTMLElement>();
/** Cached scroll root per backdrop (avoids getComputedStyle walks every frame). */
const rootByNode = new WeakMap<HTMLElement, HTMLElement | Window>();
/** Last written focus (0..1) so we can skip no-op CSS writes. */
const lastFocus = new WeakMap<HTMLElement, number>();
/** Refcount of scroll/resize listeners per root. */
const rootRefs = new Map<EventTarget, { count: number; onScroll: () => void }>();

let raf = 0;
let windowBound = false;

function schedule(): void {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    updateAll();
  });
}

function isScrollContainer(el: HTMLElement): boolean {
  const s = getComputedStyle(el);
  const oy = s.overflowY;
  if (oy !== "auto" && oy !== "scroll" && oy !== "overlay") return false;
  return el.scrollHeight > el.clientHeight + 1;
}

/** Nearest ancestor that actually scrolls (rack column), else the viewport. */
function findScrollRoot(el: HTMLElement): HTMLElement | Window {
  let n: HTMLElement | null = el.parentElement;
  while (n && n !== document.documentElement) {
    if (isScrollContainer(n)) return n;
    n = n.parentElement;
  }
  return window;
}

function scrollRootOf(el: HTMLElement): HTMLElement | Window {
  let root = rootByNode.get(el);
  if (!root) {
    root = findScrollRoot(el);
    rootByNode.set(el, root);
  }
  return root;
}

type RootGeom = { centerY: number; band: number };

function measureRoot(root: HTMLElement | Window): RootGeom {
  if (root === window) {
    const h = window.innerHeight;
    return { centerY: h * 0.5, band: h * 0.4 };
  }
  const rr = (root as HTMLElement).getBoundingClientRect();
  return {
    centerY: (rr.top + rr.bottom) * 0.5,
    band: Math.max(120, rr.height * 0.4),
  };
}

function focusFromRect(r: DOMRect, geom: RootGeom): number {
  const { centerY, band } = geom;
  if (r.bottom < centerY - band * 1.35 || r.top > centerY + band * 1.35) {
    return 0;
  }
  const mid = (r.top + r.bottom) * 0.5;
  const linear = Math.max(0, Math.min(1, 1 - Math.abs(mid - centerY) / band));
  return linear * linear * (3 - 2 * linear);
}

function applyFocus(el: HTMLElement, focus: number): void {
  const prev = lastFocus.get(el);
  // Skip tiny jitter — filter recomposite is the expensive part.
  if (prev !== undefined && Math.abs(prev - focus) < 0.025 && (focus > 0.02) === (prev > 0.02)) {
    const wantCentered = focus > 0.7;
    if (el.classList.contains("fc-mod-backdrop--centered") === wantCentered) return;
  }
  lastFocus.set(el, focus);
  el.style.setProperty("--fc-art-focus", focus.toFixed(3));
  el.classList.toggle("fc-mod-backdrop--centered", focus > 0.7);
  el.classList.toggle("fc-mod-backdrop--dim", focus < 0.04);
}

function updateAll(): void {
  // One rect per unique scroll root this frame.
  const geomCache = new Map<HTMLElement | Window, RootGeom>();

  for (const el of nodes) {
    if (el.classList.contains("fc-mod-backdrop--asleep")) {
      if (lastFocus.get(el) !== 0) {
        lastFocus.set(el, 0);
        el.style.setProperty("--fc-art-focus", "0");
        el.classList.remove("fc-mod-backdrop--centered");
        el.classList.add("fc-mod-backdrop--dim");
      }
      continue;
    }

    const root = scrollRootOf(el);
    let geom = geomCache.get(root);
    if (!geom) {
      geom = measureRoot(root);
      geomCache.set(root, geom);
    }

    const focus = focusFromRect(el.getBoundingClientRect(), geom);
    applyFocus(el, focus);
  }
}

function bindWindow(): void {
  if (windowBound) return;
  windowBound = true;
  window.addEventListener("resize", schedule, { passive: true });
  // Capture catches nested scrollers; still RAF-coalesced.
  window.addEventListener("scroll", schedule, { passive: true, capture: true });
}

function unbindWindow(): void {
  if (!windowBound || nodes.size > 0) return;
  windowBound = false;
  window.removeEventListener("resize", schedule);
  window.removeEventListener("scroll", schedule, true);
}

function retainRoot(root: EventTarget): void {
  let entry = rootRefs.get(root);
  if (!entry) {
    const onScroll = () => schedule();
    entry = { count: 0, onScroll };
    rootRefs.set(root, entry);
    if (root !== window) {
      root.addEventListener("scroll", onScroll, { passive: true });
    }
  }
  entry.count++;
}

function releaseRoot(root: EventTarget): void {
  const entry = rootRefs.get(root);
  if (!entry) return;
  entry.count--;
  if (entry.count > 0) return;
  rootRefs.delete(root);
  if (root !== window) {
    root.removeEventListener("scroll", entry.onScroll);
  }
}

/**
 * Drive `--fc-art-focus` (0..1) on a backdrop root from rack scroll position.
 * Returns a disposer.
 */
export function attachModuleArtFocus(el: HTMLElement): () => void {
  const root = findScrollRoot(el);
  rootByNode.set(el, root);
  nodes.add(el);
  retainRoot(root);
  bindWindow();
  schedule();
  return () => {
    nodes.delete(el);
    rootByNode.delete(el);
    lastFocus.delete(el);
    releaseRoot(root);
    el.style.removeProperty("--fc-art-focus");
    el.classList.remove("fc-mod-backdrop--centered", "fc-mod-backdrop--dim");
    unbindWindow();
  };
}
