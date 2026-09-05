/**
 * Ask the DEEP supervisor to choose the Mediator's identity.
 *
 * This runs once. The result becomes canon and is never replaced automatically —
 * regeneration requires an explicit human action.
 */
import { writeAvatar } from "./avatar.mjs";
import { IDENTITY_PROMPT, hasIdentity, loadIdentity, saveIdentity, validateIdentity } from "./identity.mjs";
import { invokeSupervisor } from "./supervisorInvoker.mjs";

/**
 * @param {object} opts
 * @param {string} opts.model      DEEP supervisor model id
 * @param {boolean} opts.force     replace an existing identity (human-confirmed)
 * @param {number} opts.attempts   validation retries, for readability/safety failures only
 */
export async function generateIdentity({
  model,
  force = false,
  attempts = 2,
  timeoutMs = 30 * 60 * 1000,
  signal = null,
  log = () => {},
} = {}) {
  if (!force && hasIdentity()) {
    return { ok: true, reused: true, identity: loadIdentity(), calls: [], warnings: [] };
  }
  if (!model) return { ok: false, reason: "no-deep-model-configured", calls: [], identity: null };

  const calls = [];
  let prompt = IDENTITY_PROMPT;
  let lastErrors = [];

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    log(`  asking ${model} to design its own identity (attempt ${attempt}/${attempts}) — this model is slow by design…`);
    const call = await invokeSupervisor({
      prompt,
      model,
      role: "DEEP_SUPERVISOR",
      title: "kc-mediator-identity",
      timeoutMs,
      signal,
      log,
    });
    calls.push(call);
    if (!call.ok) {
      return { ok: false, reason: call.error || "identity-call-failed", calls, identity: null };
    }

    const validated = validateIdentity(call.text, { creatingModel: model });
    if (validated.ok) {
      const identity = saveIdentity(validated.identity, { sourceText: call.text });
      const avatar = writeAvatar(identity);
      log(`  identity accepted: ${identity.displayName} — avatar family "${avatar.family}"`);
      return { ok: true, reused: false, identity, avatar, calls, warnings: validated.warnings };
    }

    lastErrors = validated.errors;
    log(`  identity rejected: ${validated.errors.join(", ")}`);
    // Re-ask, naming only the constraint that failed. The aesthetic choice
    // stays the model's; we are correcting readability and safety, not taste.
    prompt = `${IDENTITY_PROMPT}

Your previous proposal was rejected for these specific reasons:
${validated.errors.map((e) => `- ${describeRejection(e)}`).join("\n")}

Keep your concept. Change only what is needed to satisfy those constraints.`;
  }

  return { ok: false, reason: `identity-invalid:${lastErrors.join(",")}`, calls, identity: null };
}

function describeRejection(err) {
  if (err.startsWith("invalid-color:")) {
    return `${err.split(":")[1]} was not a hex literal. Use #rgb, #rrggbb, or #rrggbbaa.`;
  }
  if (err.startsWith("text-contrast-too-low:")) {
    return `text on background contrast was ${err.split(":")[1]}:1. It must be at least 3:1, and 4.5:1 is preferred.`;
  }
  if (err === "primary-too-close-to-robo-puppy-green") {
    return "your primary colour was too close to Robo Puppy's green. Pick something clearly your own.";
  }
  if (err === "avatar-confusable-with-robo-puppy") {
    return "your avatar was dog-like. You are not the apprentice; choose a different form.";
  }
  if (err === "no-json-object") return "the reply was not one parseable JSON object.";
  return err;
}
