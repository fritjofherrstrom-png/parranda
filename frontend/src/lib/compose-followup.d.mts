export declare const UPGRADE_DELAY_MS: number;

export interface ComposeFollowupInput {
  supplyLifecycleComplete?: boolean;
  composed?: boolean;
  structureOnly?: boolean;
  hasStructure?: boolean;
  transientSourceRetry?: boolean;
  silent?: boolean;
}

export interface ComposeFollowupPlan {
  schedule: boolean;
  delayMs: number | null;
  upgradePending: boolean;
}

export declare function planComposeFollowup(input?: ComposeFollowupInput): ComposeFollowupPlan;
