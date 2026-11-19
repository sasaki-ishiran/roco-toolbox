import type { PetGrade } from '../domain/petFilters';
import { createModuleStore } from './createModuleStore';

/**
 * 跨号补种公任务（2026-11-03）：
 * 在种公阵列里选中的「源号配对 → 把蛋传给目标号」，记到看板的配窝建议里。
 * 本质是给自己补种公：源号孵出蛋、传蛋、目标号收货。
 */
export interface StudTransferTask {
  id: string;
  createdAt: number;
  /**
   * 补什么：`stud` = 补种公（原逻辑）；`mother` = 补母本（2026-11-18）。
   * 老任务没有这个字段，按 `stud` 处理。
   */
  kind?: 'stud' | 'mother';
  targetAccount: string;
  sourceAccount: string;
  /** 蛋物种（母本蛋血脉）。 */
  eggGameId: number;
  motherGameId: number;
  motherName: string;
  motherNature: string;
  motherCaptureId?: string;
  fatherGameId: number;
  fatherName: string;
  fatherNature: string;
  fatherCaptureId?: string;
  natureName: string;
  grade: PetGrade;
  groupIds: number[];
  chance: number;
  /** 补母本时：对性母概率（推荐性格 × 出母率）；界面写「对性母 6%」 */
  femaleChance?: number;
  /** 补母本时：目标号已有同种（同一颗蛋）的目标档位公，到手就能和它配窝 */
  sameSpecies?: boolean;
}

const KEY = 'roco.studTransferTask.v1';

const store = createModuleStore<StudTransferTask[]>([], { persistKey: KEY });

/** 同一个目标号 + 同一个源号 + 同一颗蛋 + 同一性格/档位，只记一条。 */
const taskKey = (task: Omit<StudTransferTask, 'id' | 'createdAt'>): string =>
  `${task.kind ?? 'stud'}|${task.targetAccount}|${task.sourceAccount}|${task.eggGameId}|${task.natureName}|${task.grade}`;

export function addStudTransferTask(input: Omit<StudTransferTask, 'id' | 'createdAt'>): void {
  const key = taskKey(input);
  const current = store.get();
  if (current.some((task) => taskKey(task) === key)) return;
  store.set([...current, { ...input, id: key, createdAt: Date.now() }]);
}

export function removeStudTransferTask(id: string): void {
  store.set(store.get().filter((task) => task.id !== id));
}

export function useStudTransferTasks(): StudTransferTask[] {
  return store.use();
}

/** 测试之间复位（模块级状态会跨用例串味）。 */
export function resetStudTransferTasksForTest(): void {
  store.set([]);
}
