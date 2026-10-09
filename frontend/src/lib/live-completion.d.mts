export declare const LIVE_COMPLETION_ENDPOINT: string;
export declare const LIVE_ROUTE_UPGRADE_ENDPOINT: string;
export declare const LIVE_COMPLETION_QUERY: string;
export declare const LIVE_COMPLETION_POLL_DELAYS_MS: number[];
export declare const LIVE_COMPLETION_MAX_LIFETIME_MS: number;

export interface LiveCompletionCapability {
  token: string;
  expiresInMs: number;
  routeUpgrade: "explicit_request" | "not_supported";
}

export declare function takeLiveCompletion(body: any): { body: any; capability: LiveCompletionCapability | null };

export type LiveCompletionRead =
  | { kind: "pending" }
  | { kind: "expired" }
  | { kind: "unavailable" }
  | { kind: "terminal"; liveEvents: any; routeUpgrade: "explicit_request" | "not_supported" };

export declare function readLiveCompletionResponse(status: number, body: any): LiveCompletionRead;

export type LiveRouteUpgradeRead =
  | { kind: "pending" }
  | { kind: "expired" }
  | { kind: "not_authorized" }
  | { kind: "not_eligible" }
  | { kind: "rejected" }
  | { kind: "failed" }
  | { kind: "applied"; result: any };

export declare function readLiveRouteUpgradeResponse(status: number, body: any): LiveRouteUpgradeRead;

export interface LiveCompletionOutcome {
  live: "terminal" | "expired" | "unavailable" | "cancelled";
  upgrade: LiveRouteUpgradeRead | null;
}

export declare function followLiveCompletion(input: {
  capability: LiveCompletionCapability;
  signal: AbortSignal;
  onLiveEvents?: (liveEvents: any) => void;
  fetcher?: (url: string, init: RequestInit) => Promise<{ status: number; json(): Promise<any> }>;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
  delays?: number[];
}): Promise<LiveCompletionOutcome>;
