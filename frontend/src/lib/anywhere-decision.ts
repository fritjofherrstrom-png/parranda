/**
 * Typed bridge to the SHARED honesty module at the repo root
 * (anywhere-render-decision.js). One honesty rule for both apps — the UMD
 * attaches to globalThis when no CommonJS `module` exists (Vite/browser), and
 * node tests require() it directly.
 */
// @ts-ignore — UMD side-effect module outside the workspace root (fs.allow: '..')
import "../../../anywhere-render-decision.js";

export type AnywhereStatus =
  | "composed"
  | "composed_limited"
  | "structure_only"
  | "unavailable";

export interface AnywhereClassification {
  status: AnywhereStatus;
  hasStructure: boolean;
  placeLabel: string;
  /** Qualifying readiness caps the server attached when it promoted a day that
   *  is real but smaller or less certain than ideal. Empty for a full day. */
  limitations?: string[];
  /** Closed absence causes. sparse_supply means trusted places are too few;
   *  network_walking_* means the enabled final walk was not verified and can
   *  also accompany structure_only. Neither invents an unresolved anchor. */
  unavailableReason?: "sparse_supply" | "network_walking_unavailable" | "network_walking_provider_unavailable" | "network_walking_busy" | "network_walking_invalid_configuration";
  realPlaceCount?: number;
}

interface AnywhereDecisionApi {
  classifyAnywhereResult(response: unknown, opts?: { place?: string }): AnywhereClassification;
  isComposedStatus(status: string): boolean;
  safeResponseFor(response: unknown, classification?: AnywhereClassification): any;
  shouldRetryTransientSource(response: unknown, classification?: AnywhereClassification): boolean;
}

export function anywhereDecision(): AnywhereDecisionApi {
  const api = (globalThis as any).AnywhereRenderDecision;
  if (!api) throw new Error("anywhere-render-decision failed to load");
  return api as AnywhereDecisionApi;
}
