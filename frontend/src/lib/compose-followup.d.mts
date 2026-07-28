export declare const LIVE_REFRESH_DELAYS_MS: number[];

export interface ComposeFollowupInput {
  composed?: boolean;
  hasStructure?: boolean;
  transientSourceRetry?: boolean;
  livePending?: boolean;
  silent?: boolean;
  pollAttempt?: number;
  delays?: number[];
}

export interface ComposeFollowupPlan {
  schedule: boolean;
  delayMs: number | null;
  nextPollAttempt: number;
  upgradePending: boolean;
  liveRefreshExhausted: boolean;
}

export declare function planComposeFollowup(input?: ComposeFollowupInput): ComposeFollowupPlan;
