/**
 * Type-to-search preset combobox — shared by Morph Pad corners and the
 * sequencer Draw A / Draw B instrument picker.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type PresetSearchOption = {
  id: string;
  name: string;
  category: string;
  user?: boolean;
  desc?: string;
};

function filterOptions(all: PresetSearchOption[], query: string): PresetSearchOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return all.slice(0, 48);
  const scored: { opt: PresetSearchOption; score: number }[] = [];
  for (const opt of all) {
    const name = opt.name.toLowerCase();
    const cat = opt.category.toLowerCase();
    const desc = (opt.desc ?? "").toLowerCase();
    let score = -1;
    if (name === q) score = 100;
    else if (name.startsWith(q)) score = 80;
    else if (name.includes(q)) score = 60;
    else if (cat.startsWith(q) || cat.includes(q)) score = 40;
    else if (desc.includes(q)) score = 20;
    else if (opt.id.toLowerCase().includes(q)) score = 15;
    if (score >= 0) scored.push({ opt, score: score + (opt.user ? 5 : 0) });
  }
  scored.sort((a, b) => b.score - a.score || a.opt.name.localeCompare(b.opt.name));
  return scored.slice(0, 48).map((s) => s.opt);
}

export function PresetSearchCombobox({
  value,
  color,
  options,
  onChange,
  placeholder = "Search presets…",
  className = "",
  minWidthClass = "min-w-[11rem]",
}: {
  value: string;
  color: string;
  options: PresetSearchOption[];
  onChange: (id: string) => void;
  placeholder?: string;
  className?: string;
  minWidthClass?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.id === value);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hi, setHi] = useState(0);

  const results = useMemo(() => filterOptions(options, query), [options, query]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    setHi(0);
  }, [query, open]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${hi}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [hi, open]);

  const pick = useCallback((id: string) => {
    onChange(id);
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  }, [onChange]);

  const onFocus = () => {
    setOpen(true);
    setQuery("");
    setHi(0);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHi((h) => Math.min(results.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = results[hi];
      if (hit) pick(hit.id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setQuery("");
      inputRef.current?.blur();
    }
  };

  return (
    <div ref={wrapRef} className={`relative min-w-0 flex-1 ${minWidthClass} ${className}`}>
      <div
        className="flex items-center gap-1.5 h-8 rounded-lg border bg-black/45 px-2 transition"
        style={{
          borderColor: open ? `${color}88` : "rgba(255,255,255,0.12)",
          boxShadow: open ? `0 0 16px ${color}22` : undefined,
        }}
      >
        <span className="pointer-events-none text-[10px] text-white/40" aria-hidden>⌕</span>
        <input
          ref={inputRef}
          value={open ? query : (selected?.name ?? "")}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={onFocus}
          onKeyDown={onKeyDown}
          placeholder={placeholder || "Select instrument"}
          className="min-w-0 flex-1 bg-transparent text-[11px] text-white/85 outline-none placeholder:text-white/40"
          aria-label={placeholder || "Select instrument"}
          aria-expanded={open}
          aria-autocomplete="list"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
        />
        {!open && (
          <span className="pointer-events-none text-[9px] text-white/35 shrink-0" aria-hidden>▾</span>
        )}
        {!open && selected && (
          <span
            className="shrink-0 rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider max-w-[4.5rem] truncate"
            style={{ color, background: `${color}18` }}
            title={selected.category}
          >
            {selected.category}
          </span>
        )}
      </div>

      {open && (
        <div
          ref={listRef}
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 max-h-64 overflow-y-auto rounded-xl border border-white/12 bg-[#0a0a0e]/97 shadow-[0_16px_40px_rgba(0,0,0,0.65)] backdrop-blur-md"
          role="listbox"
        >
          {results.length === 0 ? (
            <div className="px-3 py-3 text-[11px] text-white/40">No presets match “{query}”</div>
          ) : (
            results.map((opt, idx) => {
              const active = idx === hi;
              const current = opt.id === value;
              return (
                <button
                  key={opt.id}
                  type="button"
                  data-idx={idx}
                  role="option"
                  aria-selected={current}
                  onMouseEnter={() => setHi(idx)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(opt.id)}
                  className={`flex w-full items-start gap-2 px-2.5 py-1.5 text-left transition ${
                    active ? "bg-white/[0.08]" : "hover:bg-white/[0.04]"
                  }`}
                >
                  <span
                    className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: current ? color : opt.user ? "#ff9a6b" : "rgba(255,255,255,0.25)" }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-semibold text-white/90">{opt.name}</span>
                    <span className="block truncate text-[9px] text-white/35">
                      {opt.category}{opt.desc ? ` · ${opt.desc}` : ""}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
