/**
 * Deterministic avatar renderer.
 *
 * The model chooses a concept in words. This module turns those words into
 * vector geometry locally. We never execute model-authored markup — the SVG is
 * assembled here from sanitized colours and a seeded generator, so the same
 * identity always renders the same face.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

import { avatarSvgPath, ensureDir, mediatorAssetsDir } from "./paths.mjs";

/** Small deterministic PRNG so a given identity always produces one avatar. */
function seededRandom(seedText) {
  const h = createHash("sha256").update(String(seedText), "utf8").digest();
  let i = 0;
  return () => {
    const v = h.readUInt32BE((i * 4) % 28);
    i += 1;
    return (v >>> 0) / 0xffffffff;
  };
}

/**
 * Shape families the renderer knows how to draw.
 * Order matters: the first family whose pattern matches the concept wins.
 */
export const SHAPE_FAMILIES = [
  { id: "eye", re: /\b(eye|iris|pupil|gaze|watch(er|ing)?|observer|lens|retina)\b/i },
  { id: "orbital", re: /\b(orbit|orbital|constellation|star|cosmic|planet|satellite|celestial|nebula|astral)\b/i },
  { id: "crystal", re: /\b(crystal|crystalline|facet|prism|gem|shard|refract|diamond)\b/i },
  { id: "monolith", re: /\b(monolith|slab|obelisk|pillar|column|stele|tower|megalith)\b/i },
  { id: "lattice", re: /\b(archive|library|ledger|index|lattice|grid|matrix|catalog|record)\b/i },
  { id: "owl", re: /\b(owl|raptor|bird|avian|feather)\b/i },
  { id: "mask", re: /\b(mask|visor|face(plate)?|helm|persona)\b/i },
  { id: "glyph", re: /\b(glyph|sigil|rune|mark|minimal|typographic|symbol)\b/i },
];

export function chooseShapeFamily({ concept = "", shapeLanguage = "", displayName = "" } = {}) {
  const text = `${concept} ${shapeLanguage} ${displayName}`;
  const hit = SHAPE_FAMILIES.find((f) => f.re.test(text));
  return hit ? hit.id : "prism";
}

const CX = 64;
const CY = 64;

function polygonPoints(sides, radius, rotation = 0, cx = CX, cy = CY) {
  const pts = [];
  for (let i = 0; i < sides; i += 1) {
    const a = rotation + (i * 2 * Math.PI) / sides;
    pts.push(`${(cx + radius * Math.cos(a)).toFixed(2)},${(cy + radius * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(" ");
}

function coreFor(family, theme, rnd) {
  const { primary, secondary, surface } = theme;
  switch (family) {
    case "eye":
      return `
    <ellipse cx="${CX}" cy="${CY}" rx="34" ry="20" fill="${surface}" stroke="${secondary}" stroke-width="1.5"/>
    <circle cx="${CX}" cy="${CY}" r="13" fill="none" stroke="${primary}" stroke-width="2.5"/>
    <circle class="mdr-core" cx="${CX}" cy="${CY}" r="5.5" fill="${primary}"/>
    <path d="M30 ${CY} Q ${CX} ${CY - 26} 98 ${CY}" fill="none" stroke="${primary}" stroke-width="1.2" opacity="0.55"/>
    <path d="M30 ${CY} Q ${CX} ${CY + 26} 98 ${CY}" fill="none" stroke="${primary}" stroke-width="1.2" opacity="0.55"/>`;

    case "orbital": {
      const tilt = Math.round(18 + rnd() * 30);
      return `
    <circle class="mdr-core" cx="${CX}" cy="${CY}" r="11" fill="${primary}"/>
    <ellipse cx="${CX}" cy="${CY}" rx="36" ry="13" fill="none" stroke="${secondary}" stroke-width="1.6" transform="rotate(${tilt} ${CX} ${CY})"/>
    <ellipse cx="${CX}" cy="${CY}" rx="28" ry="9" fill="none" stroke="${primary}" stroke-width="1.2" opacity="0.7" transform="rotate(${-tilt * 1.6} ${CX} ${CY})"/>
    <circle cx="${(CX + 36 * Math.cos((tilt * Math.PI) / 180)).toFixed(1)}" cy="${(CY + 13 * Math.sin((tilt * Math.PI) / 180)).toFixed(1)}" r="3" fill="${secondary}"/>`;
    }

    case "crystal": {
      const sides = 5 + Math.floor(rnd() * 3);
      return `
    <polygon points="${polygonPoints(sides, 34, -Math.PI / 2)}" fill="${surface}" stroke="${primary}" stroke-width="2"/>
    <polygon points="${polygonPoints(sides, 20, -Math.PI / 2)}" fill="none" stroke="${secondary}" stroke-width="1.3"/>
    <polygon class="mdr-core" points="${polygonPoints(sides, 8, -Math.PI / 2)}" fill="${primary}"/>`;
    }

    case "monolith":
      return `
    <rect x="${CX - 17}" y="24" width="34" height="80" rx="3" fill="${surface}" stroke="${primary}" stroke-width="2"/>
    <line x1="${CX}" y1="34" x2="${CX}" y2="94" stroke="${secondary}" stroke-width="1.3"/>
    <rect class="mdr-core" x="${CX - 6}" y="${CY - 6}" width="12" height="12" fill="${primary}"/>`;

    case "lattice": {
      const cells = [];
      for (let r = 0; r < 4; r += 1) {
        for (let c = 0; c < 4; c += 1) {
          const on = rnd() > 0.45;
          cells.push(`<rect x="${34 + c * 16}" y="${34 + r * 16}" width="12" height="12" rx="1.5" fill="${on ? primary : "none"}" stroke="${secondary}" stroke-width="1" opacity="${on ? 0.9 : 0.5}"/>`);
        }
      }
      return `\n    ${cells.join("\n    ")}\n    <rect class="mdr-core" x="${CX - 3}" y="${CY - 3}" width="6" height="6" fill="${primary}"/>`;
    }

    case "owl":
      return `
    <path d="M${CX} 30 C 92 30 100 58 96 76 C 92 96 78 102 ${CX} 102 C 50 102 36 96 32 76 C 28 58 36 30 ${CX} 30 Z" fill="${surface}" stroke="${secondary}" stroke-width="1.6"/>
    <circle cx="${CX - 14}" cy="62" r="11" fill="none" stroke="${primary}" stroke-width="2"/>
    <circle cx="${CX + 14}" cy="62" r="11" fill="none" stroke="${primary}" stroke-width="2"/>
    <circle class="mdr-core" cx="${CX - 14}" cy="62" r="4" fill="${primary}"/>
    <circle class="mdr-core" cx="${CX + 14}" cy="62" r="4" fill="${primary}"/>
    <path d="M${CX} 68 L ${CX - 5} 78 L ${CX + 5} 78 Z" fill="${secondary}"/>`;

    case "mask":
      return `
    <path d="M34 38 L94 38 L88 82 Q ${CX} 104 40 82 Z" fill="${surface}" stroke="${primary}" stroke-width="2"/>
    <rect class="mdr-core" x="42" y="56" width="18" height="5" rx="2.5" fill="${primary}"/>
    <rect class="mdr-core" x="68" y="56" width="18" height="5" rx="2.5" fill="${primary}"/>
    <line x1="${CX}" y1="70" x2="${CX}" y2="88" stroke="${secondary}" stroke-width="1.3"/>`;

    case "glyph":
      return `
    <path d="M40 92 L${CX} 32 L88 92" fill="none" stroke="${primary}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <line x1="50" y1="72" x2="78" y2="72" stroke="${secondary}" stroke-width="2.2" stroke-linecap="round"/>
    <circle class="mdr-core" cx="${CX}" cy="${CY + 26}" r="4" fill="${primary}"/>`;

    default:
      return `
    <polygon points="${polygonPoints(3, 34, -Math.PI / 2)}" fill="${surface}" stroke="${primary}" stroke-width="2"/>
    <polygon points="${polygonPoints(3, 19, Math.PI / 2)}" fill="none" stroke="${secondary}" stroke-width="1.4"/>
    <circle class="mdr-core" cx="${CX}" cy="${CY}" r="6" fill="${primary}"/>`;
  }
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Render the avatar.
 *
 * The `mdr-gear` ring and `mdr-core` marks are stable hooks the console uses to
 * express the current cognitive gear without changing the identity itself.
 */
export function renderAvatarSvg(identity) {
  const theme = identity.theme;
  const seed = `${identity.displayName}|${identity.avatar.concept}|${identity.avatar.shapeLanguage}`;
  const rnd = seededRandom(seed);
  const family = chooseShapeFamily({
    concept: identity.avatar.concept,
    shapeLanguage: identity.avatar.shapeLanguage,
    displayName: identity.displayName,
  });

  const symbolCount = Math.max(3, Math.min(8, identity.avatar.symbols.length || 4 + Math.floor(rnd() * 3)));
  const ticks = [];
  for (let i = 0; i < symbolCount; i += 1) {
    const a = (i * 2 * Math.PI) / symbolCount - Math.PI / 2;
    const r1 = 52;
    const r2 = 58;
    ticks.push(
      `<line x1="${(CX + r1 * Math.cos(a)).toFixed(2)}" y1="${(CY + r1 * Math.sin(a)).toFixed(2)}" x2="${(CX + r2 * Math.cos(a)).toFixed(2)}" y2="${(CY + r2 * Math.sin(a)).toFixed(2)}" stroke="${theme.secondary}" stroke-width="1.6" stroke-linecap="round"/>`,
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128" role="img" aria-label="${escapeXml(identity.displayName)} avatar">
  <title>${escapeXml(identity.displayName)}</title>
  <desc>${escapeXml(identity.avatar.concept)}</desc>
  <circle cx="${CX}" cy="${CY}" r="61" fill="${theme.background}"/>
  <circle class="mdr-gear" cx="${CX}" cy="${CY}" r="55" fill="none" stroke="${theme.primary}" stroke-width="1.4" stroke-dasharray="6 5" opacity="0.75"/>
  ${ticks.join("\n  ")}
  <g class="mdr-figure" data-family="${family}">${coreFor(family, theme, rnd)}
  </g>
</svg>
`;
}

export function writeAvatar(identity) {
  ensureDir(mediatorAssetsDir);
  const svg = renderAvatarSvg(identity);
  writeFileSync(avatarSvgPath, svg, "utf8");
  return { path: avatarSvgPath, svg, family: chooseShapeFamily({ concept: identity.avatar.concept, shapeLanguage: identity.avatar.shapeLanguage, displayName: identity.displayName }) };
}
