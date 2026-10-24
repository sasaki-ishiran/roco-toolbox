export const isCollectorCaptureUrl = (url: string): boolean =>
  /^https:\/\/roco-share\.invalid\/collector\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(url);
export const MAX_CAPTURE_BYTES = 128 * 1024 * 1024;
