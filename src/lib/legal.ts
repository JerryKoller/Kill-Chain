/**
 * Legal acceptance version — bump when EULA / Privacy draft text changes
 * enough that existing installs should re-agree.
 */
export const LEGAL_VERSION = "1.0-draft";

/** Short labels for the gate and Settings. */
export const LEGAL_EULA_TITLE = "End User License Agreement (draft)";
export const LEGAL_PRIVACY_TITLE = "Privacy Policy (draft)";

/**
 * In-app draft text (mirrors LEGAL/EULA.md + LEGAL/PRIVACY.md).
 * Keep in sync when those files change; bump LEGAL_VERSION when you do.
 */
export const LEGAL_EULA_BODY = `Kill Chain — End User License Agreement (DRAFT)

Attorney review required. This is a placeholder for a commercial EULA.
Do not distribute commercially until counsel approves the final text.

1. Grant of license
Subject to payment (if applicable) and compliance with this agreement, Jerry Koller
grants you a limited, non-exclusive, non-transferable license to install and use
Kill Chain on Windows devices you own or control.

2. Restrictions
You may not reverse engineer, decompile, or redistribute the software except as
expressly permitted. Compatibility profiles name third-party products for
identification only — no endorsement is implied.

3. Content and routing
You are responsible for ensuring you have the right to process any audio you route
through Kill Chain, including captured system audio and web playback.

4. Disclaimer
THE SOFTWARE IS PROVIDED "AS IS" WITHOUT WARRANTY OF ANY KIND. See the full
agreement (to be completed by counsel) for limitation of liability.

5. Contact
Licensing inquiries: (add contact before commercial launch).`;

export const LEGAL_PRIVACY_BODY = `Kill Chain — Privacy Policy (DRAFT)

Attorney review required. This is a placeholder. Final policy must be
published before commercial sale.

Summary
Kill Chain is designed to run locally on your Windows PC. By default:

- Audio processing happens on your machine.
- Settings and presets are stored in local storage on your device.
- Crash reporting is opt-in and only sends data if you enable it and a
  reporting endpoint is configured at build time.

Data we do not collect (default configuration)
- We do not operate a central account system for the desktop app.
- We do not upload your music library, Airspace browsing history, or DSP settings
  unless you explicitly export or share them.

Third-party components
Kill Chain embeds Electron/Chromium and other open-source libraries. See
THIRD_PARTY_NOTICES.md in the repository.

Updates
This draft will be replaced with counsel-approved language before commercial
distribution.`;

export function isLegalAccepted(
  acceptedVersion: string | null | undefined,
  acceptedAt: string | null | undefined,
): boolean {
  return Boolean(acceptedAt) && acceptedVersion === LEGAL_VERSION;
}
