export type BasemapTheme = "day" | "night";
export const BASEMAP_PROVIDER: { tiles: string; glyphs: string; attribution: string };
export const BASEMAP_PALETTES: Record<BasemapTheme, Record<string, string>>;
export function basemapStyle(theme: BasemapTheme): any;
export function basemapPaint(theme: BasemapTheme): Array<[string, string, string]>;
export const BASEMAP_LAYER_IDS: string[];
