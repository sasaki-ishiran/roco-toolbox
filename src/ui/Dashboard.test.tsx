import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Dashboard } from './Dashboard';
import type { CollectionSummary } from './useCollectionSummary';
import type { NestPet, NestPlan } from '../domain/nestPlan';
import { toggleAllAccounts } from './accountFilterStore';
import { getCoverageFilter, setTargetGrade, toggleFilterGrade } from './coverageFilterStore';
import { setTargetMode } from './targetModeStore';
import { DEFAULT_MOTHER_CRITERIA } from '../domain/motherCriteria';
import { setMotherCriteria } from './motherCriteriaStore';

const h = vi.hoisted(() => ({
  summary: null as unknown as CollectionSummary,
  accounts: ['测试甲'],
}));

vi.mock('./useCollectionSummary', () => ({ useCollectionSummary: () => h.summary }));
vi.mock('./useOwnedPets', () => ({
  useOwnedPets: () => ({ owned: h.summary.owned, accounts: h.accounts }),
}));

const motherGroup = (index: number) =>
  ({
    chainKey: `c${index}`,
    formLabel: `母本${index}`,
    memberIndexes: [],
    eggGroups: [2],
    motherClass: null,
    eggGameId: 100 + index,
  }) as never;

const nestPet = (key: string, name: string, gender: '公' | '母'): NestPet => ({
  key,
  gameId: 3001,
  name,
  account: '测试甲',
  gender,
  nature: '固执',
  voiceDb: 100,
  medalBody: '大块头',
  box: '盒子1 第1位',
});

/** 手写一份可展示的配窝方案，验证看板直接渲染摆位与配对 */
const demoPlan: NestPlan = {
  account: '测试甲',
  pairings: [{
    tier: 'normal60',
    groupIds: [2],
    natureName: '固执',
    grade: '大婉',
    account: '测试甲',
    father: nestPet('f', '父兽', '公'),
    mother: nestPet('m', '母兽', '母'),
    academyParent: null,
    partner: nestPet('f', '父兽', '公'),
    natureChance: 0.6,
    distance: 8,
    fatherPosition: { x: 8, y: 0 },
    motherPosition: { x: 0, y: 0 },
    expected: { species: '母兽', nature: '固执', body: '大块头', voice: '100' },
    expectedValue: 0.6,
  }],
  blockedLinks: [],
  slots: [
    { position: { x: 0, y: 0 }, pet: nestPet('m', '母兽', '母'), cluster: 0, academy: false },
    { position: { x: 8, y: 0 }, pet: nestPet('f', '父兽', '公'), cluster: 0, academy: false },
  ],
  nestsUsed: 2,
  nestsTotal: 11,
  clusters: [[{ x: 0, y: 0 }, { x: 8, y: 0 }]],
  unfilled: [],
  delegated: [],
  alternatives: [],
};

beforeEach(() => {
  h.accounts = ['测试甲'];
  toggleAllAccounts([]);
  h.summary = {
    loaded: true,
    owned: [{ gameId: 3200, account: '测试甲' } as never],
    motherGroups: Array.from({ length: 5 }, (_, index) => motherGroup(index)),
    mode: 'perfect',
    mother: { collected: 0, total: 5 },
    stud: {
      cells: [
        { groupId: 3, state: 'breedable' } as never,
        { groupId: 4, state: 'empty' } as never,
      ],
      groupCount: 14,
      passedGroups: 0,
      total: 2,
      covered: 2,
      groupSummary: [],
    },
    coverageByAccount: new Map([
      [
        '测试甲',
        {
          cells: [
            { groupId: 3, state: 'breedable' } as never,
            { groupId: 4, state: 'empty' } as never,
          ],
          groupCount: 14,
          passedGroups: 0,
          total: 2,
          covered: 0,
          groupSummary: [],
        },
      ],
    ]),
    plans: [],
    recommendations: [
      {
        id: 'r1',
        natureName: '固执',
        displayName: '火花',
        groupIds: [2],
        groupLabels: ['巨灵组'],
        grade: '大婉',
        gameId: 1,
      },
    ],
  };
});

describe('Dashboard（看板）', () => {
  test('看板账号默认全选，单账号不能取消最后一个选择', () => {
    h.summary = { ...h.summary, owned: [], recommendations: [] };
    render(<Dashboard onNavigate={vi.fn()} />);
    const summary = screen.getByTestId('dashboard-account-summary');
    expect(summary).toHaveTextContent('测试甲(1/1)');
    expect(summary).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('dashboard-account-selector')).toBeNull();

    fireEvent.click(summary);
    const account = screen.getByTestId('dashboard-account-测试甲');
    expect(account).toHaveAttribute('aria-pressed', 'true');
    expect(account).toBeDisabled();
    expect(screen.queryByTestId('account-filter')).toBeNull();
  });

  test('多账号使用卡片选择，且始终保留至少一个账号', () => {
    h.accounts = ['测试甲', '测试乙', '测试丙', '测试丁'];
    h.summary = { ...h.summary, owned: [], recommendations: [] };
    render(<Dashboard onNavigate={vi.fn()} />);
    const summary = screen.getByTestId('dashboard-account-summary');
    expect(summary).toHaveTextContent('(4/4)');
    fireEvent.click(summary);
    expect(summary).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('dashboard-account-selector')).toBeVisible();

    const first = screen.getByTestId('dashboard-account-测试甲');
    const second = screen.getByTestId('dashboard-account-测试乙');
    const third = screen.getByTestId('dashboard-account-测试丙');
    const fourth = screen.getByTestId('dashboard-account-测试丁');
    expect(first).toHaveAttribute('aria-pressed', 'true');
    expect(second).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(first);
    expect(first).toHaveAttribute('aria-pressed', 'false');
    expect(second).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(second);
    expect(second).toHaveAttribute('aria-pressed', 'false');
    expect(summary).toHaveTextContent('测试丙、测试丁(2/4)');
    expect(within(summary).getByText('、测试丁')).toHaveClass('truncate');
    expect(summary).toHaveAttribute('title', '测试丙、测试丁 (2/4)');

    fireEvent.click(third);
    expect(third).toHaveAttribute('aria-pressed', 'false');
    expect(fourth).toBeDisabled();
    expect(summary).toHaveTextContent('测试丁(1/4)');
    fireEvent.click(screen.getByTestId('dashboard-account-select-all'));
    expect(first).toHaveAttribute('aria-pressed', 'true');
    expect(second).toHaveAttribute('aria-pressed', 'true');
    expect(third).toHaveAttribute('aria-pressed', 'true');
    expect(fourth).toHaveAttribute('aria-pressed', 'true');
  });

  test('未设置种公目标时配窝摘要不声称全部收集', () => {
    h.summary = {
      ...h.summary,
      stud: { ...h.summary.stud, cells: [], groupCount: 0, passedGroups: 0, total: 0 },
      recommendations: [],
    };
    render(<Dashboard onNavigate={vi.fn()} />);
    expect(screen.getByTestId('nest-summary-line')).toHaveTextContent('未设置种公目标');
    expect(screen.getByTestId('nest-summary-line')).not.toHaveTextContent('全部收集');
  });
  test('结构与顺序：目标摘要 → 并列进度 → 行动切换 → 种公推荐 → 配窝汇总', () => {
    const { container } = render(<Dashboard onNavigate={vi.fn()} />);
    const order = [
      screen.getByTestId('target-mode'),
      screen.getByTestId('progress-card-action-stud'),
      screen.getByTestId('progress-card-action-mother'),
      screen.getByTestId('dashboard-action-switch'),
      screen.getByTestId('recommend-list'),
      screen.getByTestId('nest-summary'),
    ];
    for (let i = 1; i < order.length; i += 1) {
      expect(
        order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    // 配窝明细现在直接落在看板（2026-10-25 用户要求）；母本档位明细仍在收集页
    expect(screen.getByTestId('breed-empty')).toBeTruthy();
    expect(container.querySelector('[data-testid="mother-grade-inventory"]')).toBeNull();
    expect(screen.queryByTestId('mother-actions')).toBeNull();
    expect(screen.queryByText('看我的种公 ›', { exact: true })).toBeNull();
    expect(screen.queryByText('看我的待补齐母本 ›', { exact: true })).toBeNull();
  });

  test('主页四种奖牌组合单行显示，选择后收敛为单一目标', () => {
    setTargetMode('perfect');
    setTargetGrade('大婉');
    toggleFilterGrade('小粗');
    render(<Dashboard onNavigate={vi.fn()} />);

    const choices = screen.getByRole('group', { name: '目标奖牌组合（公母共用）' });
    expect(choices.className).toContain('grid-cols-4');
    expect(
      Array.from(choices.querySelectorAll('button')).map((button) => button.dataset.testid),
    ).toEqual([
      'dashboard-target-grade-大婉',
      'dashboard-target-grade-大粗',
      'dashboard-target-grade-小婉',
      'dashboard-target-grade-小粗',
    ]);
    // 档位单选：后点的「小粗」替换掉「大婉」，不会再出现多选提示
    expect(screen.queryByTestId('dashboard-target-multiple-note')).toBeNull();
    expect(screen.getByTestId('dashboard-target-grade-小粗')).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByTestId('dashboard-target-grade-大婉').querySelectorAll('img')[1].getAttribute('src'),
    ).toBe('/ui/medals/1026-max.png');
    expect(screen.getByTestId('dashboard-target-body-note')).toHaveTextContent(
      '大块头对应身高 100%，小不点对应身高 0%',
    );
    expect(screen.getByTestId('dashboard-target-body-note')).not.toHaveTextContent('无体型奖牌');
    expect(screen.queryByText('目标奖牌组合（公母共用）', { exact: true })).toBeNull();

    fireEvent.click(screen.getByTestId('dashboard-target-grade-大粗'));
    expect(getCoverageFilter().grades).toEqual(['大粗']);
    expect(screen.queryByTestId('dashboard-target-multiple-note')).toBeNull();
    expect(screen.queryByTestId('dashboard-clear-studs-target')).toBeNull();
  });

  test('主页奖牌图标会随目标模式显示对应声音奖牌', () => {
    setTargetMode('medal');
    setTargetGrade('大婉');
    h.summary = { ...h.summary, mode: 'medal' };
    render(<Dashboard onNavigate={vi.fn()} />);

    const button = screen.getByTestId('dashboard-target-grade-大婉');
    expect(button.querySelectorAll('img')[0].getAttribute('src')).toBe('/ui/medals/1001.png');
    expect(button.querySelectorAll('img')[1].getAttribute('src')).toBe('/ui/medals/1026.png');
    expect(screen.getByTestId('dashboard-target-voice-note')).toHaveTextContent(
      '婉转声 ≥96、粗嗓门 ≤-96',
    );
  });

  test('看板选择奖牌会同步筛选母本全收集进度和缺口', () => {
    setTargetMode('perfect');
    setTargetGrade('大婉');
    setMotherCriteria({ ...DEFAULT_MOTHER_CRITERIA });
    h.summary = {
      ...h.summary,
      owned: [
        {
          gameId: 3200,
          name: '大婉母本甲',
          gender: '母',
          nature: '固执',
          voiceDb: 100,
          medalBody: '大块头',
          isShiny: false,
          account: '测试甲',
        },
        {
          gameId: 3201,
          name: '大婉母本乙',
          gender: '母',
          nature: '固执',
          voiceDb: 100,
          medalBody: '大块头',
          isShiny: false,
          account: '测试甲',
        },
        {
          gameId: 3202,
          name: '大粗母本',
          gender: '母',
          nature: '固执',
          voiceDb: -100,
          medalBody: '大块头',
          isShiny: false,
          account: '测试甲',
        },
      ] as never[],
      motherGroups: Array.from({ length: 3 }, (_, index) => ({
        chainKey: `c${index}`,
        formLabel: `母本${index}`,
        memberIndexes: [index],
        eggGroups: [2],
        motherClass: null,
        eggGameId: 100 + index,
      }) as never),
      mother: { collected: 0, total: 3 },
    };
    render(<Dashboard onNavigate={vi.fn()} />);

    const progress = screen.getByTestId('progress-card-action-mother');
    expect(progress).toHaveTextContent('2 / 3');
    fireEvent.click(screen.getByTestId('dashboard-target-grade-大粗'));
    expect(progress).toHaveTextContent('1 / 3');

    fireEvent.click(screen.getByTestId('dashboard-action-mothers'));
    expect(screen.getAllByTestId('mother-action-item')).toHaveLength(2);

    act(() => {
      setTargetGrade('大婉');
      setMotherCriteria({ ...DEFAULT_MOTHER_CRITERIA });
    });
  });

  test('看板用账号摘要替代蛋组与性格设置入口', () => {
    render(<Dashboard onNavigate={vi.fn()} />);

    expect(screen.getByTestId('dashboard-target-header')).toHaveTextContent('账号');
    expect(screen.getByTestId('dashboard-account-summary')).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-target-settings')).toBeNull();
    expect(screen.queryByRole('dialog', { name: '调整目标' })).toBeNull();
  });

  test('母本缺口和种公推荐可通过按钮切换', () => {
    render(<Dashboard onNavigate={vi.fn()} />);
    const studsButton = screen.getByTestId('dashboard-action-studs');
    const mothersButton = screen.getByTestId('dashboard-action-mothers');
    expect(
      studsButton.compareDocumentPosition(mothersButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByTestId('recommend-list')).toBeTruthy();

    fireEvent.click(mothersButton);
    expect(screen.getByTestId('mother-actions')).toBeTruthy();
    expect(screen.queryByTestId('recommend-list')).toBeNull();

    fireEvent.click(studsButton);
    expect(screen.getByTestId('recommend-list')).toBeTruthy();
    expect(screen.queryByTestId('mother-actions')).toBeNull();
  });

  test('看板不显示个人种公目标标题或母本条件入口', () => {
    render(<Dashboard onNavigate={vi.fn()} />);

    expect(screen.queryByText('个人种公目标', { exact: true })).toBeNull();
    expect(screen.queryByTestId('mother-criteria-edit')).toBeNull();
    expect(screen.queryByRole('button', { name: '调整母本达标条件 ›' })).toBeNull();
    expect(screen.queryByText('清空种公目标', { exact: true })).toBeNull();
  });

  test('母本缺口默认全部展示，四列显示头像和推荐性格，并保留完整入口', () => {
    const onNavigate = vi.fn();
    render(<Dashboard onNavigate={onNavigate} />);
    fireEvent.click(screen.getByTestId('dashboard-action-mothers'));
    const items = screen.getAllByTestId('mother-action-item');
    expect(items).toHaveLength(5);
    expect(screen.getByTestId('mother-action-items').className).toContain('grid-cols-4');
    expect(within(screen.getByTestId('mother-actions')).getAllByTestId('pet-avatar')).toHaveLength(5);
    expect(screen.getAllByTestId('mother-action-nature')).toHaveLength(5);
    expect(within(items[0]).getByTestId('mother-action-nature').textContent).toBeTruthy();
    expect(within(items[0]).getByTestId('pet-avatar').className).toContain('h-[52px]');
    expect(screen.getByTestId('mother-actions').className).not.toContain('p-4');
    expect(screen.queryByRole('heading', { name: '母本缺口' })).toBeNull();
    expect(items[0]).toHaveAttribute('aria-label', expect.stringContaining('还没有达标母本'));
    fireEvent.click(screen.getByTestId('mother-actions-more'));
    expect(onNavigate).toHaveBeenCalledWith({
      type: 'open-collection',
      location: { kind: 'mothers', status: 'missing' },
    });
  });

  test('种公推荐卡点开「种公推荐 · 怎么补」悬浮窗，目标卡是种公蓝', () => {
    render(<Dashboard onNavigate={vi.fn()} />);
    fireEvent.click(within(screen.getByTestId('recommend-item')).getByRole('button'));
    expect(screen.getByTestId('gap-fill-eyebrow').textContent).toBe('种公推荐 · 怎么补');
    expect(screen.getByTestId('gap-target-tag').textContent).toBe('推荐');
    expect(screen.queryByTestId('gap-add-to-plan')).toBeNull();
    fireEvent.click(screen.getByTestId('gap-fill-close'));
    expect(screen.queryByTestId('gap-fill-dialog')).toBeNull();
  });

  test('点母本缺口卡打开「怎么补」悬浮窗，没有可配的线时写本号跨号都无法配对', () => {
    const onNavigate = vi.fn();
    render(<Dashboard onNavigate={onNavigate} />);
    fireEvent.click(screen.getByTestId('dashboard-action-mothers'));

    fireEvent.click(within(screen.getAllByTestId('mother-action-item')[0]).getByRole('button'));
    expect(screen.getByRole('dialog', { name: '怎么补' })).toBeTruthy();
    expect(screen.getByTestId('gap-fill-eyebrow').textContent).toBe('母本缺口 · 怎么补');
    expect(screen.getByTestId('gap-unpairable').textContent).toContain('本号、跨号都无法配对');

    fireEvent.click(screen.getByTestId('gap-fill-close'));
    expect(screen.queryByTestId('gap-fill-dialog')).toBeNull();
  });

  test('进度卡与行动都发明确导航意图', () => {
    const onNavigate = vi.fn();
    render(<Dashboard onNavigate={onNavigate} />);

    fireEvent.click(screen.getByTestId('progress-card-action-stud'));
    expect(onNavigate).toHaveBeenCalledWith({
      type: 'open-collection',
      location: { kind: 'studs', view: 'coverage' },
    });

    fireEvent.click(screen.getByTestId('progress-card-action-mother'));
    expect(onNavigate).toHaveBeenCalledWith({
      type: 'open-collection',
      location: { kind: 'mothers', status: 'missing' },
    });

    // 2026-11-19 用户口径：补全计划不再放「看缺口 / 看推荐种公」入口
    expect(screen.queryByTestId('nest-open-coverage')).toBeNull();
    expect(screen.queryByTestId('nest-open-swap')).toBeNull();
  });

  test('看板直接展示配窝建议的配对（标题已改为补全计划，摆位图已移除）', () => {
    h.summary = { ...h.summary, plans: [demoPlan] };
    render(<Dashboard onNavigate={vi.fn()} />);

    expect(screen.getByText('补全计划')).toBeTruthy();
    // 2026-11-18：汇总只剩双组 / 母本 / 需传蛋；这份方案三者都是 0，不再渲染空胶囊行
    expect(screen.queryByTestId('nest-plan-pills')).toBeNull();
    expect(screen.getByTestId('breed-list')).toBeTruthy();
    // 2026-11-19 用户口径：补全计划不再画小窝摆位图
    expect(screen.queryByTestId('nest-layout')).toBeNull();
    expect(screen.getAllByTestId('breed-suggestion').length).toBeGreaterThan(0);
  });

  test('补全计划汇总不再写学院 / 性格档位，只剩双组 / 母本 / 需传蛋', () => {
    const dualPlan: NestPlan = {
      ...demoPlan,
      pairings: [{ ...demoPlan.pairings[0], groupIds: [2, 7] }],
    };
    h.summary = { ...h.summary, plans: [dualPlan] };
    render(<Dashboard onNavigate={vi.fn()} />);

    const pills = screen.getByTestId('nest-plan-pills');
    expect(pills).toHaveTextContent('双组');
    expect(pills).not.toHaveTextContent('学院');
    expect(pills).not.toHaveTextContent('性格');
  });

  test('补全计划按号各报缺口，不把几个号加成一个总数（2026-11-18 修正）', () => {
    h.accounts = ['测试甲', '测试乙'];
    const coverageOf = (states: Array<'breedable' | 'empty'>) =>
      ({
        cells: states.map((state, index) => ({ groupId: 3 + index, state }) as never),
        groupCount: 14,
        passedGroups: 0,
        total: states.length,
        covered: 0,
        groupSummary: [],
      }) as never;
    h.summary = {
      ...h.summary,
      coverageByAccount: new Map([
        ['测试甲', coverageOf(['breedable', 'empty'])],
        ['测试乙', coverageOf(['breedable'])],
      ]),
    };
    render(<Dashboard onNavigate={vi.fn()} />);

    const line = screen.getByTestId('nest-summary-line');
    // 甲号差 2、乙号差 1：分别写出来，不合成「还差 3 个」
    expect(line).toHaveTextContent('测试甲 2');
    expect(line).toHaveTextContent('测试乙 1');
    expect(line).not.toHaveTextContent('还差 3');
    expect(screen.getAllByTestId('nest-gap-account')).toHaveLength(2);
  });

  test('没有可自己孵的方案时明确解释，不制造空推荐', () => {
    h.summary = {
      ...h.summary,
      stud: {
        ...h.summary.stud,
        cells: [{ groupId: 4, state: 'empty' } as never],
      },
    };
    render(<Dashboard onNavigate={vi.fn()} />);
    expect(screen.getByTestId('breed-empty')).toHaveTextContent('没有能自己孵的方案');
  });

  test('目标全收齐时不写「还差」也不让用户去导入', () => {
    h.summary = {
      ...h.summary,
      stud: { ...h.summary.stud, cells: [], groupCount: 14, passedGroups: 14 },
      coverageByAccount: new Map([
        [
          '测试甲',
          {
            cells: [],
            groupCount: 14,
            passedGroups: 14,
            total: 0,
            covered: 0,
            groupSummary: [],
          },
        ],
      ]),
      recommendations: [],
    };
    render(<Dashboard onNavigate={vi.fn()} />);
    expect(screen.getByTestId('nest-summary-line')).toHaveTextContent('已全部收集');
    expect(screen.getByTestId('breed-empty')).toHaveTextContent('已全部收集');
    expect(screen.getByTestId('recommend-empty')).toHaveTextContent('没有要补的缺口');
  });
});
