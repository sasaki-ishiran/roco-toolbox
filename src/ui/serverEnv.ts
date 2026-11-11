/** 当前页面所在环境：由 hostname 推导，切服重载后自动变化，不写死。 */
export type ServerEnv = 'test' | 'prod' | 'custom';

export function serverEnvOf(hostname: string): ServerEnv {
  const host = (hostname || '').toLowerCase();
  if (host === 'roco-toolbox.pages.dev') return 'prod';
  if (host === 'roco-toolbox-downloads.pages.dev') return 'prod';
  if (host === 'test.roco-toolbox.pages.dev' || host === 'internal.roco-toolbox.pages.dev') return 'test';
  if (host.endsWith('.roco-toolbox.pages.dev')) return 'test';
  return 'custom';
}
