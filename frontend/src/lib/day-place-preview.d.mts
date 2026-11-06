import type { DayEdit } from '../../../shared/planner-intent.mjs';
export type DayPlaceAnswer = { response: { ok: boolean; status: number }; body: any };
export function buildDayPlacePayload(args: { anchor: any; entry: any; commitments?: any; query?: string; candidate?: { id: string; label?: string }; replaceId?: string }): { payload: any; edit: DayEdit | null; commitments: any };
export function requestDayPlace(args: { payload: any; lang: string; signal: AbortSignal; onCancellationReady?: (cancel: () => void) => void; onPending?: () => void; fetcher?: typeof fetch }): Promise<DayPlaceAnswer>;
export function validDayPlacePreview(body: any, args: { edit: DayEdit; dateIso: string }): boolean;
export function releaseAddedDayEdit(edit: DayEdit | null, currentIds: string[], releaseExtent?: boolean): DayEdit | null;
