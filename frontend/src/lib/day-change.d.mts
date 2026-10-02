export interface DayChange {
  inputs: {
    walk: { from: string; to: string } | null;
    day: { from: 0 | 1; to: 0 | 1 } | null;
    picksAdded: string[];
    picksRemoved: string[];
  };
  stops: {
    added: string[];
    removed: string[];
    kept: number;
    before: number;
    after: number;
    reordered: boolean;
  };
  km: { before: number; after: number } | null;
  hasRoute: boolean;
  routeChanged: boolean;
}

export function describeDayChange(previous: unknown, next: unknown): DayChange;

export function dayChangeSegments(
  change: DayChange | null | undefined,
  labels?: {
    lang?: string;
    walkLabel?: (key: string) => string;
    pickLabel?: (key: string) => string;
    dayLabel?: (offset: 0 | 1) => string;
  },
): string[];
