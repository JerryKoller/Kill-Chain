/**
 * Deterministic UI metrics via page-context JS.
 * Intended to run through CDP Runtime.evaluate (Electron :9223 or Chrome).
 * Not a replacement for human eyes.
 */
export const DEFAULT_VIEWPORTS = [1440, 1366, 1280];

export function metricsExpression({
  selectors = [],
  widths = DEFAULT_VIEWPORTS,
} = {}) {
  const payload = JSON.stringify({ selectors, widths });
  return `(() => {
    const { selectors, widths } = ${payload};
    const measure = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return { sel, found: false };
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const overflowX = el.scrollWidth - el.clientWidth;
      const overflowY = el.scrollHeight - el.clientHeight;
      const truncated = cs.textOverflow === "ellipsis" || (el.scrollWidth > el.clientWidth + 1);
      return {
        sel,
        found: true,
        tag: el.tagName,
        title: el.getAttribute("title"),
        aria: el.getAttribute("aria-label"),
        role: el.getAttribute("role"),
        text: (el.innerText || "").slice(0, 180),
        box: { x: r.x, y: r.y, w: r.width, h: r.height },
        client: { w: el.clientWidth, h: el.clientHeight },
        scroll: { w: el.scrollWidth, h: el.scrollHeight },
        overflowX,
        overflowY,
        overflowing: overflowX > 1,
        truncated,
        gap: cs.gap,
        columnGap: cs.columnGap,
        rowGap: cs.rowGap,
        opacity: cs.opacity,
        color: cs.color,
        backgroundColor: cs.backgroundColor,
        outline: cs.outline,
        outlineWidth: cs.outlineWidth,
        boxShadow: cs.boxShadow,
        display: cs.display,
        visibility: cs.visibility,
        fontSize: cs.fontSize,
      };
    };
    const original = window.innerWidth;
    const byWidth = {};
    const applyWidth = (w) => {
      // Visual viewport hint only; the host should set the window size.
      byWidth[String(w)] = selectors.map(measure);
    };
    applyWidth(window.innerWidth);
    return {
      href: location.href,
      title: document.title,
      viewport: { innerWidth: window.innerWidth, innerHeight: window.innerHeight, original },
      widths,
      byWidth,
      bodyOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  })()`;
}

export function assertMetrics(report, assertions = []) {
  const failures = [];
  for (const a of assertions) {
    const width = String(a.width || report.viewport?.innerWidth);
    const rows = report.byWidth?.[width] || report.byWidth?.[Object.keys(report.byWidth || {})[0]] || [];
    const row = rows.find((r) => r.sel === a.sel);
    if (!row || !row.found) {
      if (a.requireFound !== false) failures.push({ ...a, reason: "not-found" });
      continue;
    }
    if (typeof a.maxOverflowX === "number" && row.overflowX > a.maxOverflowX) {
      failures.push({ ...a, reason: `overflowX ${row.overflowX} > ${a.maxOverflowX}` });
    }
    if (typeof a.minOpacity === "number" && Number(row.opacity) < a.minOpacity) {
      failures.push({ ...a, reason: `opacity ${row.opacity} < ${a.minOpacity}` });
    }
    if (a.gapEquals && String(row.gap) !== String(a.gapEquals)) {
      failures.push({ ...a, reason: `gap ${row.gap} != ${a.gapEquals}` });
    }
    if (a.notTruncated && row.truncated) {
      failures.push({ ...a, reason: "truncated" });
    }
  }
  return { ok: failures.length === 0, failures, report };
}
