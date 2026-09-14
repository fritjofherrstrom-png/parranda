export function fetchPlannerLifecycle(url: string, options: {
  payload: unknown;
  signal: AbortSignal;
  onPending?: () => void;
  onCancellationReady?: (cancel: () => void) => void;
  fetcher?: typeof fetch;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
}): Promise<{ response: Response; body: any }>;
