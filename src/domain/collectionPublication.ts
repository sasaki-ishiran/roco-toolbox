import type { GroupTargetConfig, PublishedStudResource } from '../shared/collectionGroups';
import { motherResourceCriteriaIdOf, type PublishedMotherResource } from '../shared/motherGroups';
import { isMotherResourceComparable } from './motherSharing';
import { isStudResourceComparable } from './studSharing';

/**
 * 小组「我的共享资源」状态（2026-10-25 从旧 `MotherSharing` 补回）。
 *
 * 二期重写小组页时只保留了「已发布 / 未发布」，把「需更新」丢了：导入新数据后，
 * 本机重建出的资源与服务器上已发布的不一致，但界面仍显示「已发布」，用户不知道要重新发布。
 *
 * 判定 = 摘要仍与当前口径/图鉴可比 **且** 与已发布内容完全一致；任一不满足都是「需更新」。
 */
export type GroupPublicationStatus = '未发布' | '已发布' | '需更新';

export function groupPublicationStatus(input: {
  type: 'mother' | 'stud';
  mother: PublishedMotherResource | null;
  stud: PublishedStudResource | null;
  target: GroupTargetConfig | null;
  targetRevision: number;
  catalogVersion: string;
  /** 本机数据重建的资源是否与已发布的一致（没有可重建数据时按 true 传） */
  unchanged: boolean;
}): GroupPublicationStatus {
  const published = input.type === 'stud' ? input.stud : input.mother;
  if (!published) return '未发布';
  const comparable =
    input.type === 'stud'
      ? input.target?.kind === 'stud' &&
        isStudResourceComparable(input.stud, input.target, input.targetRevision, input.catalogVersion)
      : // 2026-10-29：产线口径（目标模式）编进 criteriaId；组长切模式后旧摘要自动需更新。
        isMotherResourceComparable(
          input.mother,
          input.catalogVersion,
          motherResourceCriteriaIdOf(
            input.target?.kind === 'mother' ? input.target.mode : 'perfect',
          ),
        );
  return comparable && input.unchanged ? '已发布' : '需更新';
}
