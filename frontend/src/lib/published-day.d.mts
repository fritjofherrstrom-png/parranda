import type { SavedEntry } from './anywhere-storage.mjs';
export interface PublishedDayReference { version:1; state:'ready'; ref:string; created_at:string; expires_at:string; }
export interface PublishedDay { entry:SavedEntry; publication:PublishedDayReference; }
interface Options { ref:string; decision:{ classifyAnywhereResult:(value:any,opts?:any)=>any; isComposedStatus:(status:string)=>boolean; safeResponseFor:(value:any,cls:any)=>any }; now?:number; signal?:AbortSignal; }
export declare const MAX_PUBLISHED_DAY_BYTES:number;
export declare function readyPublishedDay(value:unknown,now?:number):PublishedDayReference|null;
export declare function publishedDayHref(ref:string,lang:string):string|null;
export declare function parsePublishedDay(value:unknown,options:Options):PublishedDay|null;
export declare function readPublishedDay(response:Response,options:Options):Promise<PublishedDay>;
