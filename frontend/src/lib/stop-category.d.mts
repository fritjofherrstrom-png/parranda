export type StopCategoryFamily = "food" | "drink" | "culture" | "nature" | "sight" | "shop";
export const STOP_CATEGORY_FAMILIES: StopCategoryFamily[];
export function stopCategoryFamily(type: unknown): StopCategoryFamily | null;
