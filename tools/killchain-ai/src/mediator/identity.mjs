/**
 * Mediator identity.
 *
 * The human deliberately did not choose how the Mediator is represented. The
 * configured DEEP supervisor does, once, and the choice is then canon.
 *
 * Safety posture: the model specifies design *intent* as data. We never execute
 * generated HTML, CSS, or JS. Every colour is re-parsed into a canonical hex
 * literal before it reaches a stylesheet, so a "colour" cannot smuggle in
 * `url(...)`, `expression(...)`, or a closing brace.
 *
 * This is a creative self-representation exercise: what design would a model
 * choose to represent this function? It is not a claim about consciousness,
 * preference, or subjective experience.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { extractJsonObject } from "./supervisorProtocol.mjs";
import {
  ensureDir,
  identityPath,
  identitySourcePath,
  mediatorAssetsDir,
  themePath,
} from "./paths.mjs";

export const IDENTITY_VERSION = 1;

/** Robo Puppy's established accent. The Mediator must not be confusable with him. */
export const PUPPY_ACCENT = "#3dffb0";
export const PUPPY_EYE = "#39ff88";

export const THEME_KEYS = ["primary", "secondary", "background", "surface", "text", "warning", "success"];

export const IDENTITY_PROMPT = `You are the senior Mediator in an autonomous software-development system.

Robo Puppy is the local junior developer you supervise. He is a small model who
does the implementation work. You route, teach, review, and decide when to stop.

The human has deliberately not chosen your visual identity. They have asked you
to choose it yourself.

Design the visual identity you would choose to represent your role. You may choose:
- a name / callsign
- avatar concept
- symbols
- primary and secondary colors
- background treatment
- typography mood
- panel geometry
- information density
- status indicators
- motion language
- overall atmosphere

Do not optimize for what you think the human expects. Do not default to a robot
face, and do not imitate Robo Puppy — you are a different member of this chain.
Unexpected but coherent choices are welcome. Choose a representation that fits
the role you actually perform.

Constraints that exist for engineering reasons, not aesthetic ones:
- Colors must be hex literals (#rgb, #rrggbb, or #rrggbbaa).
- Text must be readable against your chosen background (aim for a contrast
  ratio of at least 4.5:1). This console is left running for hours.
- Your primary color must be clearly distinguishable from Robo Puppy's green (${PUPPY_ACCENT}).
- Your avatar must not be a dog.

Reply with ONE fenced JSON object and nothing else:

\`\`\`json
{
  "displayName": "...",
  "tagline": "...",
  "avatar": {
    "concept": "...",
    "shapeLanguage": "...",
    "symbols": ["...", "..."]
  },
  "theme": {
    "primary": "#______",
    "secondary": "#______",
    "background": "#______",
    "surface": "#______",
    "text": "#______",
    "warning": "#______",
    "success": "#______"
  },
  "visualStyle": "...",
  "motionStyle": "...",
  "personality": "...",
  "rationale": "..."
}
\`\`\``;

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** Canonicalize to #rrggbb / #rrggbbaa, or null. Nothing else is ever emitted. */
export function sanitizeColor(value) {
  const raw = String(value ?? "").trim();
  if (!HEX_RE.test(raw)) return null;
  const body = raw.slice(1);
  if (body.length === 3) {
    return `#${body.split("").map((c) => c + c).join("").toLowerCase()}`;
  }
  return `#${body.toLowerCase()}`;
}

/** Strip control characters and cap length. Text is rendered as textContent only. */
export function sanitizeText(value, max = 400) {
  return String(value ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function srgbChannel(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex) {
  const b = hex.slice(1);
  const r = parseInt(b.slice(0, 2), 16);
  const g = parseInt(b.slice(2, 4), 16);
  const bl = parseInt(b.slice(4, 6), 16);
  return 0.2126 * srgbChannel(r) + 0.7152 * srgbChannel(g) + 0.0722 * srgbChannel(bl);
}

export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return (light + 0.05) / (dark + 0.05);
}

/** Perceptual-ish distance, good enough to catch "this is basically Puppy green". */
export function colorDistance(a, b) {
  const pa = a.slice(1);
  const pb = b.slice(1);
  const dr = parseInt(pa.slice(0, 2), 16) - parseInt(pb.slice(0, 2), 16);
  const dg = parseInt(pa.slice(2, 4), 16) - parseInt(pb.slice(2, 4), 16);
  const db = parseInt(pa.slice(4, 6), 16) - parseInt(pb.slice(4, 6), 16);
  return Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db);
}

const DOGGY = /\b(dog|puppy|pup|hound|canine|terrier|retriever|labrador|beagle|corgi|wolf|shiba)\b/i;

/**
 * Validate a proposed identity.
 *
 * Rejection is limited to the reasons the human authorized: unreadable,
 * inappropriate, confusable with Robo Puppy, or technically unsafe. Taste is
 * explicitly not grounds for rejection.
 */
export function validateIdentity(raw, { creatingModel = null } = {}) {
  const obj = typeof raw === "object" && raw !== null ? raw : extractJsonObject(raw);
  const errors = [];
  const warnings = [];
  if (!obj) return { ok: false, errors: ["no-json-object"], warnings, identity: null };

  const displayName = sanitizeText(obj.displayName, 48);
  if (!displayName) errors.push("missing-displayName");

  const tagline = sanitizeText(obj.tagline, 160);
  const avatarIn = obj.avatar && typeof obj.avatar === "object" ? obj.avatar : {};
  const concept = sanitizeText(avatarIn.concept, 400);
  const shapeLanguage = sanitizeText(avatarIn.shapeLanguage, 240);
  const symbols = Array.isArray(avatarIn.symbols)
    ? avatarIn.symbols.map((s) => sanitizeText(s, 40)).filter(Boolean).slice(0, 6)
    : [];
  if (!concept) errors.push("missing-avatar-concept");

  // "Do not copy Robo Puppy" is a hard constraint; unexpected is fine, a second dog is not.
  if (DOGGY.test(`${concept} ${shapeLanguage} ${displayName}`)) {
    errors.push("avatar-confusable-with-robo-puppy");
  }

  const themeIn = obj.theme && typeof obj.theme === "object" ? obj.theme : {};
  const theme = {};
  for (const key of THEME_KEYS) {
    const color = sanitizeColor(themeIn[key]);
    if (!color) errors.push(`invalid-color:${key}`);
    else theme[key] = color;
  }

  if (theme.text && theme.background) {
    const ratio = contrastRatio(theme.text, theme.background);
    if (ratio < 3) errors.push(`text-contrast-too-low:${ratio.toFixed(2)}`);
    else if (ratio < 4.5) warnings.push(`text-contrast-below-aa:${ratio.toFixed(2)}`);
  }
  if (theme.primary && theme.background) {
    const ratio = contrastRatio(theme.primary, theme.background);
    if (ratio < 2) warnings.push(`primary-contrast-low:${ratio.toFixed(2)}`);
  }
  if (theme.primary && colorDistance(theme.primary, PUPPY_ACCENT) < 60) {
    errors.push("primary-too-close-to-robo-puppy-green");
  }

  if (errors.length) return { ok: false, errors, warnings, identity: null };

  return {
    ok: true,
    errors: [],
    warnings,
    identity: {
      version: IDENTITY_VERSION,
      displayName,
      tagline,
      avatar: { concept, shapeLanguage, symbols },
      theme,
      visualStyle: sanitizeText(obj.visualStyle, 400),
      motionStyle: sanitizeText(obj.motionStyle, 400),
      personality: sanitizeText(obj.personality, 400),
      rationale: sanitizeText(obj.rationale, 2000),
      creatingModel: creatingModel ? sanitizeText(creatingModel, 80) : null,
      createdAt: Date.now(),
    },
  };
}

export function saveIdentity(identity, { sourceText = null } = {}) {
  ensureDir(mediatorAssetsDir);
  writeFileSync(identityPath, `${JSON.stringify(identity, null, 2)}\n`, "utf8");
  writeFileSync(themePath, `${JSON.stringify(identity.theme, null, 2)}\n`, "utf8");
  if (sourceText != null) writeFileSync(identitySourcePath, String(sourceText), "utf8");
  return identity;
}

export function loadIdentity() {
  if (!existsSync(identityPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(identityPath, "utf8"));
    // Re-sanitize on read. A hand-edited file must not be able to inject CSS.
    const revalidated = validateIdentity(parsed, { creatingModel: parsed.creatingModel });
    if (!revalidated.ok) return null;
    return { ...revalidated.identity, createdAt: parsed.createdAt || revalidated.identity.createdAt };
  } catch {
    return null;
  }
}

export function hasIdentity() {
  return loadIdentity() != null;
}

/**
 * Placeholder used before the Mediator has chosen. Deliberately plain — it must
 * not look like a design decision anyone made.
 */
export function provisionalIdentity() {
  return {
    version: IDENTITY_VERSION,
    provisional: true,
    displayName: "MEDIATOR",
    tagline: "Identity not yet chosen.",
    avatar: { concept: "An unlit placeholder marker awaiting self-selection.", shapeLanguage: "neutral rounded square", symbols: [] },
    theme: {
      primary: "#8a93a6",
      secondary: "#5b6478",
      background: "#0b0d12",
      surface: "#141822",
      text: "#d8dde8",
      warning: "#e0b45c",
      success: "#6fbf8f",
    },
    visualStyle: "Neutral holding state.",
    motionStyle: "Still.",
    personality: "Undeclared.",
    rationale: "The Mediator has not yet been asked to choose an identity. Run `mediator identity` to have the deep supervisor design one.",
    creatingModel: null,
    createdAt: null,
  };
}
