export type NoDayCause = "interests" | "sources" | "supply";
export type NoDayAction = "edit_interests" | "retry" | "restart" | null;

export function noDayState(input: {
  settled: boolean;
  interestsUnconfirmed: boolean;
  sourcesUnanswered: boolean;
  sourceFailed: boolean;
  canRebuild: boolean;
  hasPicks: boolean;
}): { cause: NoDayCause; action: NoDayAction } | null;

export function evidencedMissingIntents(missingIntents: unknown, sourceStatus: any): string[];
