export function fetchPlannerLifecycle(url: string, options: {
  payload: unknown;
  signal: AbortSignal;
  onPending?: () => void;
  fetcher?: typeof fetch;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
}): Promise<{ response: Response; body: any }>;
