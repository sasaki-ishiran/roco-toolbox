import { useMemo } from 'react';
import type { AccountSnapshot } from '../domain/parseBackup';
import type { OwnedPet } from '../domain/types';
import { useSnapshots } from './useSnapshots';
import { filterByAccounts, useAccountFilter } from './accountFilterStore';

/**
 * 账号的显示名。重名时补 UID 后缀：
 * 账号身份是游戏 UID，两个同名但不同 UID 的真实账号是**两个账号**，
 * 直接显示同一个名字会让它们在界面上被当成一个（筛选也分不开）。
 */
const labelerFor =
  (snapshots: AccountSnapshot[]) =>
  (snapshot: AccountSnapshot): string => {
    const sameName = snapshots.filter((item) => item.accountName === snapshot.accountName).length;
    return sameName > 1 ? `${snapshot.accountName}(${snapshot.gameId})` : snapshot.accountName;
  };

/**
 * 本机全部账号的精灵，并**按账号筛选**（看板 / 覆盖度 / 换什么共用）。
 * 三个页面的数字都从这里出，账号一改就一起改，不会出现「这页筛了那页没筛」。
 */
export function useOwnedPets(): { owned: OwnedPet[]; accounts: string[] } {
  const { snapshots } = useSnapshots();
  const { excluded } = useAccountFilter();

  return useMemo(() => {
    const labelOf = labelerFor(snapshots);
    const accounts = [...new Set(snapshots.map(labelOf))];
    // 精灵上的 account 就是显示名（领域层按它聚账号：配窝不能跨账号配对）
    const all = snapshots.flatMap((snapshot) => {
      const label = labelOf(snapshot);
      return snapshot.pets.map((pet) => (pet.account === label ? pet : { ...pet, account: label }));
    });
    return { owned: filterByAccounts(all, excluded), accounts };
  }, [snapshots, excluded]);
}
