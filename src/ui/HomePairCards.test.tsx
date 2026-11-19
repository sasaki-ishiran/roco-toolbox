import { render, screen, within } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { HomePair, HomeResident, OwnedPet } from '../domain/types';
import { HomePairCards } from './HomePairCards';

const owned = (over: Partial<OwnedPet> & Pick<OwnedPet, 'name' | 'gender' | 'gameId'>): OwnedPet => ({
  nature: '固执',
  voiceDb: 100,
  medalBody: '大块头',
  weightPercent: 99,
  heightPercent: 100,
  isShiny: false,
  account: '测试甲',
  ...over,
});

const resident = (
  over: Partial<HomeResident> & Pick<HomeResident, 'actorId' | 'name' | 'gender'>,
): HomeResident => ({
  instanceId: `ins_${over.actorId}`,
  baseId: '3001',
  furnitureGuid: 'nest_1',
  ...over,
});

describe('家园配窝卡片（一个窝一只精灵）', () => {
  test('学院 1:2 = 一公两母三个窝、一张卡；公本只出现一次', () => {
    const residents = [
      resident({ actorId: 'f1', name: '喵喵', gender: '母', nature: '胆小' }),
      resident({ actorId: 'f2', name: '喵喵', gender: '母', nature: '开朗' }),
      resident({ actorId: 'm1', name: '火花', gender: '公', nature: '固执', nest: {
        furnitureGuid: 'nest_m1', configId: 1001072, nestType: 'academy', nestName: '学院小窝',
      } }),
    ];
    const pets = new Map<string, OwnedPet>([
      ['ins_f1', owned({ gameId: 3001, name: '喵喵', gender: '母', nature: '胆小', voiceDb: 97 })],
      ['ins_f2', owned({ gameId: 3001, name: '喵喵', gender: '母', nature: '开朗' })],
      ['ins_m1', owned({ gameId: 3003, name: '火花', gender: '公', nature: '固执' })],
    ]);
    const couples: HomePair[] = [
      { femaleActorId: 'f1', maleActorIds: ['m1'] },
      { femaleActorId: 'f2', maleActorIds: ['m1'] },
    ];

    render(<HomePairCards couples={couples} residents={residents} pets={pets} />);
    const cards = screen.getAllByTestId('home-pair-card');
    expect(cards).toHaveLength(1);
    // 三个窝：两母 + 一公
    const females = within(cards[0]).getByTestId('home-pair-females');
    const males = within(cards[0]).getByTestId('home-pair-males');
    expect(within(females).getAllByTestId('breed-pet-card')).toHaveLength(2);
    expect(within(males).getAllByTestId('breed-pet-card')).toHaveLength(1);
    // 学院 100%：卡头和第二个母本上方各一枚；声音只写一次
    // 每个母本上方都写性格% + 声音（第二只母本用 extra 那一行）
    const heads = [
      within(cards[0]).getByTestId('home-pair-head'),
      within(cards[0]).getByTestId('home-pair-head-extra'),
    ];
    for (const head of heads) {
      expect(head).toHaveTextContent('100%固执');
      expect(head).toHaveTextContent('99dB');
    }
    expect(within(cards[0]).getAllByTestId('home-pair-nature')).toHaveLength(2);
    // 学院那只（公）绿框
    expect(within(males).getByTestId('breed-pet-card').className).toContain('border-emerald-500');
  });

  test('母本在背包里缺失时仍按 femaleActorId 放左列，不冒充种公', () => {
    const residents = [
      resident({ actorId: 'f1', name: '胆小鳗鱼', gender: '未知', nature: '胆小', baseId: '3266' }),
      resident({ actorId: 'm1', name: '豆丁鱼', gender: '公', nature: '沉默', baseId: '3384' }),
    ];
    // 背包里没有母本实例（莱茵家园的真实情况）：只剩一只种公
    const pets = new Map<string, OwnedPet>([
      ['ins_m1', owned({ gameId: 3384, name: '豆丁鱼', gender: '公', nature: '沉默' })],
    ]);

    render(
      <HomePairCards
        couples={[{ femaleActorId: 'f1', maleActorIds: ['m1'] }]}
        residents={residents}
        pets={pets}
      />,
    );

    const card = screen.getByTestId('home-pair-card');
    expect(within(card).getByTestId('home-pair-females')).toHaveTextContent('胆小鳗鱼');
    expect(within(card).getByTestId('home-pair-males')).toHaveTextContent('豆丁鱼');
    // 母本可能已放生：卡头改写成提示，不再算后代性格和声音
    const notice = within(card).getByTestId('home-pair-released');
    expect(notice).toHaveTextContent('胆小鳗鱼');
    expect(notice).toHaveTextContent('可能已被放生');
    expect(notice).not.toHaveTextContent('30%');
    expect(notice).not.toHaveTextContent('dB');
    expect(within(card).queryByTestId('home-pair-head')).toBeNull();
  });

  test('1 公多母：种公置顶只出现一次，母本两列，各自只算自己的公本', () => {
    const residents = [
      resident({ actorId: 'm1', name: '豆丁鱼', gender: '公', nature: '沉默' }),
      resident({ actorId: 'f1', name: '胆小鳗鱼', gender: '母', nature: '胆小' }),
      resident({ actorId: 'f2', name: '优优', gender: '母', nature: '开朗' }),
      resident({ actorId: 'f3', name: '豆豆', gender: '母', nature: '踏实' }),
      resident({ actorId: 'f4', name: '叮叮卯', gender: '母', nature: '聪明' }),
    ];
    const pets = new Map<string, OwnedPet>([
      ['ins_m1', owned({ gameId: 3384, name: '豆丁鱼', gender: '公', nature: '沉默' })],
      ['ins_f1', owned({ gameId: 3266, name: '胆小鳗鱼', gender: '母', nature: '胆小' })],
      ['ins_f2', owned({ gameId: 3705, name: '优优', gender: '母', nature: '开朗' })],
      ['ins_f3', owned({ gameId: 3384, name: '豆豆', gender: '母', nature: '踏实' })],
      ['ins_f4', owned({ gameId: 3752, name: '叮叮卯', gender: '母', nature: '聪明' })],
    ]);
    const couples: HomePair[] = ['f1', 'f2', 'f3', 'f4'].map((femaleActorId) => ({
      femaleActorId,
      maleActorIds: ['m1'],
    }));

    render(<HomePairCards couples={couples} residents={residents} pets={pets} />);

    const card = screen.getByTestId('home-pair-card');
    const shared = within(card).getByTestId('home-pair-shared');
    // 共用种公只出现一次
    expect(within(shared).getAllByTestId('breed-pet-card')).toHaveLength(1);
    expect(shared).toHaveTextContent('共用');
    const mothers = within(card).getByTestId('home-pair-mothers');
    expect(within(mothers).getAllByTestId('breed-pet-card')).toHaveLength(4);
    const heads = within(mothers).getAllByTestId('home-pair-head');
    expect(heads[0]).toHaveTextContent('30%胆小');
    expect(heads[0]).toHaveTextContent('30%沉默');
    expect(heads[0]).toHaveTextContent('100dB');
    expect(heads[1]).toHaveTextContent('30%开朗');
    expect(heads[1]).not.toHaveTextContent('30%胆小');
  });

  test('2 公 3 母：每只母本只列自己实际配的种公；共用种公各出现一次', () => {
    const residents = [
      resident({ actorId: 'm1', name: '豆丁鱼', gender: '公', nature: '沉默' }),
      resident({ actorId: 'm2', name: '火花', gender: '公', nature: '胆小' }),
      resident({ actorId: 'f1', name: '优优', gender: '母', nature: '开朗' }),
      resident({ actorId: 'f2', name: '豆豆', gender: '母', nature: '踏实' }),
      resident({ actorId: 'f3', name: '叮叮卯', gender: '母', nature: '聪明' }),
    ];
    const pets = new Map<string, OwnedPet>([
      ['ins_m1', owned({ gameId: 3384, name: '豆丁鱼', gender: '公', nature: '沉默' })],
      ['ins_m2', owned({ gameId: 3003, name: '火花', gender: '公', nature: '胆小' })],
      ['ins_f1', owned({ gameId: 3705, name: '优优', gender: '母', nature: '开朗' })],
      ['ins_f2', owned({ gameId: 3384, name: '豆豆', gender: '母', nature: '踏实' })],
      ['ins_f3', owned({ gameId: 3752, name: '叮叮卯', gender: '母', nature: '聪明' })],
    ]);
    const couples: HomePair[] = [
      { femaleActorId: 'f1', maleActorIds: ['m1'] },
      { femaleActorId: 'f2', maleActorIds: ['m2'] },
      { femaleActorId: 'f3', maleActorIds: ['m1', 'm2'] },
    ];

    render(<HomePairCards couples={couples} residents={residents} pets={pets} />);

    const card = screen.getByTestId('home-pair-card');
    const shared = within(card).getByTestId('home-pair-shared');
    expect(within(shared).getAllByTestId('breed-pet-card')).toHaveLength(2);
    // 种公卡片上方不再写「配 N 只母本」
    expect(within(shared).queryByText('共用 · 配 2 只母本')).toBeNull();

    const heads = within(card).getAllByTestId('home-pair-head');
    expect(heads[0]).toHaveTextContent('30%开朗');
    expect(heads[0]).toHaveTextContent('30%沉默');
    expect(heads[0]).not.toHaveTextContent('30%胆小');
    expect(heads[1]).toHaveTextContent('30%踏实');
    expect(heads[1]).toHaveTextContent('30%胆小');
    expect(heads[1]).not.toHaveTextContent('30%沉默');
    expect(heads[2]).toHaveTextContent('30%聪明');
    expect(heads[2]).toHaveTextContent('30%沉默');
    expect(heads[2]).toHaveTextContent('30%胆小');
  });

  test('1 公 10 母不折叠：10 只母本全部显示', () => {
    const residents = [resident({ actorId: 'm1', name: '豆丁鱼', gender: '公', nature: '沉默' })];
    const pets = new Map<string, OwnedPet>([
      ['ins_m1', owned({ gameId: 3384, name: '豆丁鱼', gender: '公', nature: '沉默' })],
    ]);
    const couples: HomePair[] = [];
    for (let i = 1; i <= 10; i += 1) {
      residents.push(resident({ actorId: `f${i}`, name: `母本${i}`, gender: '母', nature: '胆小' }));
      pets.set(`ins_f${i}`, owned({ gameId: 3266, name: `母本${i}`, gender: '母', nature: '胆小' }));
      couples.push({ femaleActorId: `f${i}`, maleActorIds: ['m1'] });
    }

    render(<HomePairCards couples={couples} residents={residents} pets={pets} />);

    const card = screen.getByTestId('home-pair-card');
    expect(card.getAttribute('data-top')).toBe('male');
    expect(within(card).getByTestId('home-pair-shared')).toHaveTextContent('共用种公');
    expect(within(within(card).getByTestId('home-pair-shared')).getAllByTestId('breed-pet-card')).toHaveLength(1);
    expect(within(within(card).getByTestId('home-pair-mothers')).getAllByTestId('breed-pet-card')).toHaveLength(10);
    expect(within(card).queryByTestId('home-pair-more')).toBeNull();
  });

  test('10 公 1 母：母本置顶，10 只种公全部显示，不折叠', () => {
    const natures = ['开朗', '踏实', '聪明', '固执', '沉默', '平和', '急躁', '大胆', '认真', '冷静'];
    const residents = [
      resident({ actorId: 'f1', name: '胆小鳗鱼', gender: '母', nature: '胆小' }),
    ];
    const pets = new Map<string, OwnedPet>([
      ['ins_f1', owned({ gameId: 3266, name: '胆小鳗鱼', gender: '母', nature: '胆小' })],
    ]);
    const maleActorIds: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      const actorId = `m${i + 1}`;
      maleActorIds.push(actorId);
      residents.push(resident({ actorId, name: `种公${i + 1}`, gender: '公', nature: natures[i] }));
      pets.set(`ins_${actorId}`, owned({ gameId: 3384, name: `种公${i + 1}`, gender: '公', nature: natures[i] }));
    }

    render(
      <HomePairCards
        couples={[{ femaleActorId: 'f1', maleActorIds }]}
        residents={residents}
        pets={pets}
      />,
    );

    const card = screen.getByTestId('home-pair-card');
    expect(card.getAttribute('data-top')).toBe('female');
    const shared = within(card).getByTestId('home-pair-shared');
    expect(shared).toHaveTextContent('共用母本');
    expect(within(shared).getAllByTestId('breed-pet-card')).toHaveLength(1);
    // 超过 3 只种公：卡头不显示后代性格和声音，只写配了几只
    const head = within(shared).getByTestId('home-pair-head');
    expect(head).toHaveTextContent('配 10 只种公');
    expect(head).not.toHaveTextContent('30%');
    expect(head).not.toHaveTextContent('dB');
    expect(within(shared).queryAllByTestId('home-pair-nature')).toHaveLength(0);
    expect(within(within(card).getByTestId('home-pair-males')).getAllByTestId('breed-pet-card')).toHaveLength(10);
    expect(within(card).queryByTestId('home-pair-more')).toBeNull();
  });

  test('3 只种公仍显示后代性格声音，4 只起隐藏', () => {
    const natures = ['开朗', '踏实', '聪明', '固执'];
    const make = (count: number) => {
      const residents = [
        resident({ actorId: 'f1', name: '胆小鳗鱼', gender: '母', nature: '胆小' }),
      ];
      const pets = new Map<string, OwnedPet>([
        ['ins_f1', owned({ gameId: 3266, name: '胆小鳗鱼', gender: '母', nature: '胆小' })],
      ]);
      const maleActorIds: string[] = [];
      for (let i = 0; i < count; i += 1) {
        const actorId = `m${i + 1}`;
        maleActorIds.push(actorId);
        residents.push(resident({ actorId, name: `种公${i + 1}`, gender: '公', nature: natures[i] }));
        pets.set(`ins_${actorId}`, owned({ gameId: 3384, name: `种公${i + 1}`, gender: '公', nature: natures[i] }));
      }
      return { residents, pets, couples: [{ femaleActorId: 'f1', maleActorIds }] };
    };

    const three = make(3);
    const first = render(
      <HomePairCards couples={three.couples} residents={three.residents} pets={three.pets} />,
    );
    const threeHead = screen.getByTestId('home-pair-head');
    expect(threeHead).toHaveTextContent('30%胆小');
    expect(threeHead).toHaveTextContent('dB');
    expect(threeHead.querySelectorAll('[data-testid="home-pair-nature"]')).toHaveLength(4);
    first.unmount();

    const four = make(4);
    render(<HomePairCards couples={four.couples} residents={four.residents} pets={four.pets} />);
    const fourHead = screen.getByTestId('home-pair-head');
    expect(fourHead).toHaveTextContent('配 4 只种公');
    expect(fourHead).not.toHaveTextContent('30%');
    expect(fourHead).not.toHaveTextContent('dB');
  });

  test('普通窝：母本上方写概率 + 声音，下面是母 × 公', () => {
    const residents = [
      resident({ actorId: 'f1', name: '喵喵', gender: '母', nature: '胆小' }),
      resident({ actorId: 'm1', name: '火花', gender: '公', nature: '固执' }),
    ];
    const pets = new Map<string, OwnedPet>([
      ['ins_f1', owned({ gameId: 3001, name: '喵喵', gender: '母', nature: '胆小', voiceDb: 97 })],
      ['ins_m1', owned({ gameId: 3003, name: '火花', gender: '公', nature: '固执' })],
    ]);
    render(
      <HomePairCards
        couples={[{ femaleActorId: 'f1', maleActorIds: ['m1'] }]}
        residents={residents}
        pets={pets}
      />,
    );
    const card = screen.getByTestId('home-pair-card');
    const head = within(card).getByTestId('home-pair-head');
    expect(head).toHaveTextContent('30%胆小');
    expect(head).toHaveTextContent('30%固执');
    expect(head).toHaveTextContent('98dB');
    // 标签不写性别图标
    expect(head.textContent).not.toContain('♀');
    expect(head.textContent).not.toContain('♂');
    expect(within(card).getAllByTestId('breed-pet-card')).toHaveLength(2);
    // 精灵卡信息：蛋组 / 分贝 / 身高 / 体重 都在，编号已移除
    const petsInCard = within(card).getAllByTestId('breed-pet-card');
    expect(petsInCard[0]).not.toHaveTextContent('No.');
    expect(petsInCard[0]).toHaveTextContent('动物组');
    expect(petsInCard[0]).toHaveTextContent('97dB');
    expect(petsInCard[0]).toHaveTextContent('高');
    expect(petsInCard[0]).toHaveTextContent('重');
    // 底色跟性别一致（母粉 / 公蓝），边框比底色深一点
    expect(petsInCard[0].className).toContain('bg-pink-50');
    expect(petsInCard[0].className).toContain('border-pink-200');
    expect(petsInCard[1].className).toContain('bg-sky-50');
    expect(petsInCard[1].className).toContain('border-sky-200');
  });

  test('公母同性格：只写一枚 60%', () => {
    const residents = [
      resident({ actorId: 'f1', name: '喵喵', gender: '母', nature: '固执' }),
      resident({ actorId: 'm1', name: '火花', gender: '公', nature: '固执' }),
    ];
    const pets = new Map<string, OwnedPet>([
      ['ins_f1', owned({ gameId: 3001, name: '喵喵', gender: '母' })],
      ['ins_m1', owned({ gameId: 3003, name: '火花', gender: '公' })],
    ]);
    render(
      <HomePairCards
        couples={[{ femaleActorId: 'f1', maleActorIds: ['m1'] }]}
        residents={residents}
        pets={pets}
      />,
    );
    const chips = within(screen.getByTestId('home-pair-card')).getAllByTestId('home-pair-nature');
    expect(chips).toHaveLength(1);
    expect(chips[0]).toHaveTextContent('60%固执');
  });

  test('缺少公本时降级成「公本未知」，不崩也不空白', () => {
    const residents = [resident({ actorId: 'f1', name: '喵喵', gender: '母' })];
    const pets = new Map<string, OwnedPet>([
      ['ins_f1', owned({ gameId: 3001, name: '喵喵', gender: '母' })],
    ]);
    render(
      <HomePairCards
        couples={[{ femaleActorId: 'f1', maleActorIds: ['missing'] }]}
        residents={residents}
        pets={pets}
      />,
    );
    expect(screen.getByTestId('home-pair-card-list')).toHaveTextContent('公本未知');
  });

  test('11 个窝 = 11 只精灵：4 对（8 窝）+ 学院 1:2（3 窝）', () => {
    const residents: HomeResident[] = [];
    const pets = new Map<string, OwnedPet>();
    const couples: HomePair[] = [];
    for (let i = 0; i < 4; i += 1) {
      const f = `f${i}`;
      const m = `m${i}`;
      residents.push(resident({ actorId: f, name: '喵喵', gender: '母' }));
      residents.push(resident({ actorId: m, name: '火花', gender: '公' }));
      pets.set(`ins_${f}`, owned({ gameId: 3001, name: '喵喵', gender: '母' }));
      pets.set(`ins_${m}`, owned({ gameId: 3003, name: '火花', gender: '公' }));
      couples.push({ femaleActorId: f, maleActorIds: [m] });
    }
    residents.push(resident({ actorId: 'fa', name: '喵喵', gender: '母' }));
    residents.push(resident({ actorId: 'fb', name: '喵喵', gender: '母' }));
    residents.push(resident({ actorId: 'ma', name: '火花', gender: '公' }));
    couples.push({ femaleActorId: 'fa', maleActorIds: ['ma'] });
    couples.push({ femaleActorId: 'fb', maleActorIds: ['ma'] });

    render(<HomePairCards couples={couples} residents={residents} pets={pets} />);
    expect(screen.getAllByTestId('home-pair-card')).toHaveLength(5);
    expect(screen.getAllByTestId('breed-pet-card')).toHaveLength(11);
  });
});
