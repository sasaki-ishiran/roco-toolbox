/**
 * 蛋仓获得时间展示。
 *
 * 只格式化服务端已经确认的时间字段；缺失或非法值返回空串，
 * 由调用方决定「不显示」或「没有获得时间」，不要在这里补采集时间。
 */
const pad = (value: number): string => String(value).padStart(2, '0');

const parse = (value: string | null | undefined): Date | undefined => {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

/** 卡片用：MM-DD HH:mm（跟手机本地时区）。 */
export function formatEggObtainedAt(value: string | null | undefined): string {
  const date = parse(value);
  return date ? `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}` : '';
}

/** 详情用：YYYY-MM-DD HH:mm。 */
export function formatEggObtainedAtFull(value: string | null | undefined): string {
  const date = parse(value);
  return date
    ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    : '';
}
