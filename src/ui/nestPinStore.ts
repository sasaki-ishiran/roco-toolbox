import type { NestPin } from '../domain/nestPlan';
import { createModuleStore } from './createModuleStore';

/**
 * 「换这条」：用户手动指定的配窝选择（某个缺口性格 + 档位，改用哪一对精灵来配）。
 *
 * 放模块级 + localStorage：看板切页签回来是重新挂载的，选择不能丢。
 */
const store = createModuleStore<NestPin[]>([], { persistKey: 'roco.nestPins' });

/** 同一个缺口只保留最后点的那条。 */
const sameCell = (a: NestPin, b: NestPin): boolean =>
  a.account === b.account && a.natureName === b.natureName && a.grade === b.grade;

export function pinNestCandidate(pin: NestPin): void {
  store.set([...store.get().filter((item) => !sameCell(item, pin)), pin]);
}

/** 取消手动指定：传账号就只清这个账号，不传就全清（回到自动排窝）。 */
export function clearNestPins(account?: string): void {
  store.set(account ? store.get().filter((pin) => pin.account !== account) : []);
}

/** 仅供测试：清空。 */
export function resetNestPinsForTest(): void {
  store.set([]);
}

export function useNestPins(): NestPin[] {
  return store.use();
}
