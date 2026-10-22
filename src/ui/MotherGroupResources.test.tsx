import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { MotherGroupResources } from './MotherGroupResources';
import {
  FIXTURE_CATALOG_VERSION,
  catalog,
  member,
  resourceWith,
  sharedAccount,
} from '../test/fixtures/motherSharing';
import type { MotherGroupDetail } from '../shared/motherGroups';

const group: MotherGroupDetail = {
  group: { id: 'g1', name: '组', ownerAccountId: 'A', createdAt: 1 },
  members: [
    member('A', resourceWith([101], { accounts: [sharedAccount(1001, [101])] })),
    member('B', resourceWith([], { accounts: [sharedAccount(1002, [])] })),
    member('C', null),
  ],
};

const renderResources = () =>
  render(
    <MotherGroupResources
      group={group}
      viewerAccountId="A"
      species={catalog}
      catalogVersion={FIXTURE_CATALOG_VERSION}
    />,
  );

describe('MotherGroupResources 三视图', () => {
  test('我缺的：已有人拥有的在前，无人拥有的要限定「已发布成员均无」', () => {
    renderResources();
    const rows = screen.getAllByTestId('mother-resource-row');
    const text = rows.map((row) => row.textContent).join('\n');
    expect(text).toContain('水蓝蓝');
    expect(text).toContain('纯母种');
    expect(text).toContain('已发布成员均无，另 1 人待发布/更新');
    expect(text).not.toContain('火花');
  });

  test('小组资源：显示拥有者与来源账号、缺口和未知人数', () => {
    renderResources();
    fireEvent.click(screen.getByTestId('mother-view-all'));

    const fire = screen
      .getAllByTestId('mother-resource-row')
      .find((row) => row.textContent?.includes('火花'));
    expect(fire).toBeTruthy();
    expect(fire).toHaveTextContent('有：A（账号1001）');
    expect(fire).toHaveTextContent('缺：B，另 1 人待发布/更新');
  });

  test('搜索按蛋聚合：搜「火神」能命中「火花」那颗蛋', () => {
    renderResources();
    fireEvent.click(screen.getByTestId('mother-view-all'));
    fireEvent.change(screen.getByTestId('mother-search'), { target: { value: '火神' } });

    const rows = screen.getAllByTestId('mother-resource-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('火花');
  });

  test('固定口径始终显示，不受全局筛选影响', () => {
    renderResources();
    expect(screen.getByTestId('mother-criteria')).toHaveTextContent('母 · 大块头 · +100dB');
  });
});
