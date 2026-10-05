/**
 * Typed bridge to the SHARED honesty module at the repo root
 * (anywhere-render-decision.js). One honesty rule for both apps.
 *
 * The module is UMD: it exports through `module.exports` when a CommonJS
 * `module` exists and attaches to globalThis otherwise. Which branch a bundler
 * takes is the bundler's business — Vite 8 (Rolldown) wraps it as CommonJS, so
 * a bare side-effect import no longer leaves a global behind — so the bridge
 * reads the module's own export first and the global only as a fallback.
 */
// @ts-ignore — UMD module outside the workspace root (fs.allow: '..')
import * as sharedDecisionModule from "../../../anywhere-render-decision.js";

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
  /** Set on "unavailable" when the resolved place's trusted loader found real
   *  places — just too few for a reliable day. Never set on unresolved places
   *  or loader failures, so honest-absence copy stays the default. */
  unavailableReason?: "sparse_supply";
  realPlaceCount?: number;
}

interface AnywhereDecisionApi {
  classifyAnywhereResult(response: unknown, opts?: { place?: string }): AnywhereClassification;
  isComposedStatus(status: string): boolean;
  safeResponseFor(response: unknown, classification?: AnywhereClassification): any;
  shouldRetryTransientSource(response: unknown, classification?: AnywhereClassification): boolean;
}

function isDecisionApi(value: unknown): value is AnywhereDecisionApi {
  return Boolean(value) && typeof (value as AnywhereDecisionApi).classifyAnywhereResult === "function";
}

export function anywhereDecision(): AnywhereDecisionApi {
  const moduleExport = (sharedDecisionModule as any)?.default ?? sharedDecisionModule;
  const api = isDecisionApi(moduleExport) ? moduleExport : (globalThis as any).AnywhereRenderDecision;
  if (!api) throw new Error("anywhere-render-decision failed to load");
  return api as AnywhereDecisionApi;
}
