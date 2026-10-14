import type { CommitmentEntry } from "./commitment-snapshot.mjs";
export type LiveEventChoice={occurrence_id:string;action:"keep"|"remove"|"replace"};
export function isLiveOccurrenceId(value:unknown):boolean;
export function liveStopChoiceId(stop:any):string|null;
export function scopeLiveChoices(entries:Record<string,CommitmentEntry>,date:string):{entries:Record<string,CommitmentEntry>;pinnedIds:string[];excludedIds:string[];liveEventChoices:LiveEventChoice[]};
