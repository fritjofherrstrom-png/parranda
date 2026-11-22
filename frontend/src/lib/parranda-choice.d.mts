export declare const PARRANDA_CHOOSES: "parranda_chooses";
export declare const PARRANDA_CHOOSES_FLAG_KEY: string;

export declare function readParrandaChoosesFlag(options?: {
  search?: string;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
}): boolean;

export interface ParrandaChoicePick {
  key: string;
  label: string;
  reason: string | null;
}

export interface ParrandaChoiceView {
  status: string;
  picks: ParrandaChoicePick[];
  note: string | null;
}

export declare function parrandaChoiceView(block: unknown, lang?: "sv" | "en"): ParrandaChoiceView | null;
