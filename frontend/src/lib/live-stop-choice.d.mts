import type { CommitmentEntry } from "./commitment-snapshot.mjs";
import type { Lang } from "../components/planner/copy";
import type { LiveEvents, PulseEvent } from "../components/planner/types";
import type { MapStop } from "./maps-links.mjs";
import type { LiveEventRelevance } from "./pulse-view.mjs";
export type LiveEventChoice={occurrence_id:string;action:"keep"|"remove"|"replace"};
export function isLiveOccurrenceId(value:unknown):boolean;
export function liveStopChoiceId(stop:any):string|null;
export function selectableLiveOccurrenceId(event:any,date:string|null|undefined):string|null;
export interface LiveRouteSuggestionContext {
  live: LiveEvents | null;
  date: string | null;
  stops: Array<MapStop & { daypart?: string | null; is_live_event?: boolean }>;
  selected: string[];
  commitments: Record<string, CommitmentEntry>;
}
export function suggestLiveRouteEnd(input: LiveRouteSuggestionContext & { now: Date; lang: Lang }):
  { event: PulseEvent; lastLabel: string; relevance: LiveEventRelevance } | null;
export function scopeLiveChoices(entries:Record<string,CommitmentEntry>,date:string):{entries:Record<string,CommitmentEntry>;pinnedIds:string[];excludedIds:string[];liveEventChoices:LiveEventChoice[]};
