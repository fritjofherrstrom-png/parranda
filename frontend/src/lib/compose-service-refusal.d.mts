export interface ComposeServiceRefusal {
  kind: "busy" | "rate_limited";
  retry_after_seconds: number | null;
}

export declare function composeServiceRefusal(status: number, body: unknown): ComposeServiceRefusal | null;
