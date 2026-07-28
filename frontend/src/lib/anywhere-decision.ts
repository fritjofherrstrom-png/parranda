/**
 * Typed bridge to the SHARED honesty module at the repo root
 * (anywhere-render-decision.js). One honesty rule for both apps — the UMD
 * attaches to globalThis when no CommonJS `module` exists (Vite/browser), and
 * node tests require() it directly.
 */
// @ts-ignore — UMD side-effect module outside the workspace root (fs.allow: '..')
import "../../../anywhere-render-decision.js";

export type AnywhereStatus = "composed" | "structure_only" | "unavailable";

export interface AnywhereClassification {
  status: AnywhereStatus;
  hasStructure: boolean;
  placeLabel: string;
  /** Set on "unavailable" when the resolved place's trusted loader found real
   *  places — just too few for a reliable day. Never set on unresolved places
   *  or loader failures, so honest-absence copy stays the default. */
  unavailableReason?: "sparse_supply";
  realPlaceCount?: number;
}

interface AnywhereDecisionApi {
  classifyAnywhereResult(response: unknown, opts?: { place?: string }): AnywhereClassification;
  safeResponseFor(response: unknown, classification?: AnywhereClassification): any;
  shouldRetryTransientSource(response: unknown, classification?: AnywhereClassification): boolean;
}

export function anywhereDecision(): AnywhereDecisionApi {
  const api = (globalThis as any).AnywhereRenderDecision;
  if (!api) throw new Error("anywhere-render-decision failed to load");
  return api as AnywhereDecisionApi;
}
