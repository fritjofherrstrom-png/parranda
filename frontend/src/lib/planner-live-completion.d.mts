import type { LiveEvents } from '../components/planner/types';

export interface LiveCompletionCapability {
  token: string;
  expires_in_ms: number;
}
export function extractLiveCompletion(body: any): { body: any; capability: LiveCompletionCapability | null };
export function readLiveCompletion(input: {
  capability: LiveCompletionCapability | null;
  signal: AbortSignal;
  selectedDate: string;
  wait: (delay: number, signal: AbortSignal) => Promise<void>;
  isCurrent: () => boolean;
  onReady: (events: LiveEvents) => void;
  fetcher?: typeof fetch;
  now?: () => number;
}): Promise<boolean>;
