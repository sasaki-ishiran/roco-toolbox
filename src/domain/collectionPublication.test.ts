import { describe, expect, test } from 'vitest';
import { MOTHER_CRITERIA_ID, type PublishedMotherResource } from '../shared/motherGroups';
import { studSlotSetIdOf, type PublishedStudResource, type StudTargetConfig } from '../shared/collectionGroups';
import { groupPublicationStatus } from './collectionPublication';

const CATALOG = 'cat-1';

const motherResource = (patch: Partial<PublishedMotherResource> = {}): PublishedMotherResource => ({
  schemaVersion: 1,
  criteriaId: MOTHER_CRITERIA_ID,
  catalogVersion: CATALOG,
  accounts: [],
  revision: 1,
  publishedAt: 1,
  ...patch,
});

const target: StudTargetConfig = {
  kind: 'stud',
  mode: 'perfect',
  catalogVersion: CATALOG,
  slots: [{ groupId: 1, natureId: 2, natureName: '固执', grade: '大婉' }],
};

const studResource = (patch: Partial<PublishedStudResource> = {}): PublishedStudResource => ({
  schemaVersion: 1,
  kind: 'stud',
  mode: 'perfect',
  catalogVersion: CATALOG,
  targetId: studSlotSetIdOf(target),
  targetRevision: 3,
  accounts: [],
  revision: 1,
  publishedAt: 1,
  ...patch,
});

const motherStatus = (input: {
  mother: PublishedMotherResource | null;
  unchanged?: boolean;
  catalogVersion?: string;
}) =>
  groupPublicationStatus({
    type: 'mother',
    mother: input.mother,
    stud: null,
    target: null,
    targetRevision: 0,
    catalogVersion: input.catalogVersion ?? CATALOG,
    unchanged: input.unchanged ?? true,
  });

const studStatus = (input: {
  stud: PublishedStudResource | null;
  targetRevision?: number;
  unchanged?: boolean;
}) =>
  groupPublicationStatus({
    type: 'stud',
    mother: null,
    stud: input.stud,
    target,
    targetRevision: input.targetRevision ?? 3,
    catalogVersion: CATALOG,
    unchanged: input.unchanged ?? true,
  });

describe('小组共享资源发布状态', () => {
  test('没有发布过 → 未发布', () => {
    expect(motherStatus({ mother: null })).toBe('未发布');
    expect(studStatus({ stud: null })).toBe('未发布');
  });

  test('母本：口径与图鉴一致且内容没变 → 已发布', () => {
    expect(motherStatus({ mother: motherResource() })).toBe('已发布');
  });

  test('母本：图鉴变了 / 口径变了 → 需更新', () => {
    expect(motherStatus({ mother: motherResource(), catalogVersion: 'cat-0' })).toBe('需更新');
    expect(motherStatus({ mother: motherResource({ criteriaId: 'mother-v2-x' }) })).toBe('需更新');
  });

  test('导入新数据后本机重建内容不一致 → 需更新（即使口径没变）', () => {
    expect(motherStatus({ mother: motherResource(), unchanged: false })).toBe('需更新');
    expect(studStatus({ stud: studResource(), unchanged: false })).toBe('需更新');
  });

  test('种公：目标集合 / 目标修订 / 图鉴变了 → 需更新', () => {
    expect(studStatus({ stud: studResource() })).toBe('已发布');
    expect(studStatus({ stud: studResource({ targetId: 'stud-other' }) })).toBe('需更新');
    expect(studStatus({ stud: studResource({ targetRevision: 2 }) })).toBe('需更新');
    expect(studStatus({ stud: studResource({ catalogVersion: 'cat-0' }) })).toBe('需更新');
  });
});
