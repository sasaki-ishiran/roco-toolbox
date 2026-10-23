import { act, renderHook } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  buildDefaultFilter,
  buildCoverageSlots,
} from '../domain/coverageTargets';
import {
  DEFAULT_MOTHER_CRITERIA,
  countQualifiedMotherChains,
  effectiveMotherVoices,
} from '../domain/motherCriteria';
import { groupMothersByEgg } from '../domain/petFilters';
import { computeStudCoverage } from '../domain/studCoverage';
import { parseBackup } from '../domain/parseBackup';
import { eggGroupNames, species, targetNaturePool, targetNatures } from '../data/catalog';
import { getCoverageFilter, toggleFilterGrade } from './coverageFilterStore';
import { setMotherCriteria } from './motherCriteriaStore';
import { useCollectionSummary } from './useCollectionSummary';

const loadOwned = () => {
  const raw = JSON.parse(
    readFileSync(resolve(process.cwd(), 'src/domain/__fixtures__/backup-sample.json'), 'utf8'),
  );
  return parseBackup(raw, 'test').pets;
};

vi.mock('./useSnapshots', () => ({ useSnapshots: () => ({ loaded: true, snapshots: [] }) }));
vi.mock('./useOwnedPets', () => {
  const raw = JSON.parse(
    readFileSync(resolve(process.cwd(), 'src/domain/__fixtures__/backup-sample.json'), 'utf8'),
  );
  const owned = parseBackup(raw, 'test').pets;
  return { useOwnedPets: () => ({ owned, accounts: ['测试甲'] }) };
});

const expectedMother = (criteria: { bodies: string[]; voices: string[] }) => {
  const owned = loadOwned();
  const speciesByGameId = new Map(species.map((entry) => [entry.gameId, entry]));
  const groups = groupMothersByEgg(owned, speciesByGameId, species, 'perfect');
  return countQualifiedMotherChains(groups, owned, {
    bodies: criteria.bodies as never,
    voices: effectiveMotherVoices(criteria.voices as never, 'perfect'),
  });
};

beforeEach(() => {
  // 复位档位到默认「大婉」
  const grades = getCoverageFilter().grades;
  for (const grade of grades) toggleFilterGrade(grade);
  toggleFilterGrade('大婉');
  setMotherCriteria({ ...DEFAULT_MOTHER_CRITERIA });
});

describe('useCollectionSummary', () => {
  test('母本与种公数字都等于既有领域函数的结果', () => {
    const { result } = renderHook(() => useCollectionSummary());
    const owned = loadOwned();

    expect(result.current.mother.collected).toBe(expectedMother(DEFAULT_MOTHER_CRITERIA));
    expect(result.current.mother.total).toBe(result.current.motherGroups.length);

    const slots = buildCoverageSlots(buildDefaultFilter(targetNatures), targetNaturePool);
    const expectedStud = computeStudCoverage(slots, species, owned, eggGroupNames, 'perfect');
    expect(result.current.stud.covered).toBe(expectedStud.covered);
    expect(result.current.stud.passedGroups).toBe(expectedStud.passedGroups);
    expect(result.current.stud.groupCount).toBe(expectedStud.groupCount);
  });

  test('改母本达标条件会改个人母本进度（与看板同源）', () => {
    const { result } = renderHook(() => useCollectionSummary());
    const before = result.current.mother.collected;

    // fixture 里唯一的达标母本是「大块头 + 100dB」：换成小不点 / -100 后应下降
    act(() => setMotherCriteria({ bodies: ['小不点'], voices: ['-100'] }));
    expect(result.current.mother.collected).toBe(
      expectedMother({ bodies: ['小不点'], voices: ['-100'] }),
    );
    expect(result.current.mother.collected).not.toBe(before);
  });

  test('清空种公目标不抹掉母本进度，也不影响母本分母', () => {
    const { result } = renderHook(() => useCollectionSummary());
    const motherBefore = { ...result.current.mother };

    act(() => toggleFilterGrade('大婉')); // 档位清空 → 没有种公槽位
    expect(result.current.stud.groupCount).toBe(0);
    expect(result.current.mother).toEqual(motherBefore);

    act(() => toggleFilterGrade('大婉'));
  });
});
