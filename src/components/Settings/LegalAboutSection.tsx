import { GlassPanel } from "@/components/shared/GlassPanel";
import { APP_VERSION, PRODUCT_TAGLINE, PRODUCT_DESCRIPTION } from "@/lib/appVersion";
import { LEGAL_VERSION, isLegalAccepted } from "@/lib/legal";
import { useSettingsStore } from "@/state/settingsStore";

/** Placeholder URLs — replace with attorney-approved pages before commercial sale. */
const EULA_URL = "https://github.com/JerryKoller/Kill-Chain/blob/main/LEGAL/EULA.md";
const PRIVACY_URL = "https://github.com/JerryKoller/Kill-Chain/blob/main/LEGAL/PRIVACY.md";
const THIRD_PARTY_URL = "https://github.com/JerryKoller/Kill-Chain/blob/main/THIRD_PARTY_NOTICES.md";

function Section({ title, sub }: { title: string; sub?: string }) {
  return (
    <div>
      <div className="text-sm font-semibold uppercase tracking-[0.2em] text-white/90">{title}</div>
      {sub && <div className="text-[11px] text-dim mt-1 leading-relaxed">{sub}</div>}
    </div>
  );
}

export function LegalAboutSection() {
  const legalAcceptedAt = useSettingsStore((s) => s.legalAcceptedAt);
  const legalAcceptedVersion = useSettingsStore((s) => s.legalAcceptedVersion);
  const accepted = isLegalAccepted(legalAcceptedVersion, legalAcceptedAt);

  return (
    <GlassPanel intense className="p-5">
      <Section
        title="About Kill Chain"
        sub={`v${APP_VERSION} — ${PRODUCT_TAGLINE}`}
      />
      <p className="mt-3 text-sm text-white/80 leading-relaxed">{PRODUCT_DESCRIPTION}</p>

      <div className="mt-4 rounded-xl border border-white/10 bg-black/30 p-4 text-[12px] text-white/75 leading-relaxed space-y-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.25em] text-dim mb-1">License acceptance</div>
          {accepted ? (
            <span>
              Accepted {LEGAL_VERSION}
              {legalAcceptedAt ? ` · ${new Date(legalAcceptedAt).toLocaleString()}` : ""}
            </span>
          ) : (
            <span className="text-plasma">Not accepted for {LEGAL_VERSION}</span>
          )}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.25em] text-dim mb-1">Trademark notice</div>
          Kill Chain is not affiliated with, endorsed by, or sponsored by Sony, Bose, Apple, JBL,
          Sonos, or other manufacturers named in compatibility profiles. Trademarks belong to their
          owners. Profiles are independent starting points and are not certifications.
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.25em] text-dim mb-1">Content responsibility</div>
          You are responsible for having the right to process audio routed through Kill Chain,
          including web and system-capture sources.
        </div>
        <div className="text-[11px] text-dim">
          Airspace routing and ad-blocking behaviour may have separate legal implications — review
          with counsel before commercial distribution. (Attorney review pending.)
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <a
          href={EULA_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="kc-btn kc-btn--ghost kc-btn--sm"
        >
          EULA (draft)
        </a>
        <a
          href={PRIVACY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="kc-btn kc-btn--ghost kc-btn--sm"
        >
          Privacy Policy (draft)
        </a>
        <a
          href={THIRD_PARTY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="kc-btn kc-btn--ghost kc-btn--sm"
        >
          Third-party notices
        </a>
      </div>

      <p className="mt-3 text-[10px] text-dim leading-relaxed">
        Commercial licensing, refund policy, tax, and distribution terms are tracked separately —
        see repository <span className="font-mono">LEGAL/</span> before selling copies.
      </p>
    </GlassPanel>
  );
}
