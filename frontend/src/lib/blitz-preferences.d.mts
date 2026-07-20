export type BlitzPreferenceBundle = {
  id: string;
  preferences: readonly string[];
};

export const BLITZ_PREFERENCE_BUNDLES: readonly BlitzPreferenceBundle[];

export function chooseBlitzPreferences(options?: {
  previous?: readonly string[];
  random?: () => number;
}): string[];
