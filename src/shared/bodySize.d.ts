export interface BodySize { small: number; big: number }
export function resolveBodySize(entry: {
  weight?: string;
  adultSmallWeight?: number | null;
  adultBigWeight?: number | null;
} | null | undefined): BodySize | null;
export function bodyMedalOf(size: BodySize | null | undefined, weightKg: number | null | undefined): '' | '小不点' | '大块头';
