# 工具箱 HTML 原型共用外壳

项目规范：[原型与外壳规范](../../设计资产/原型与外壳规范.md)；历史稿与采用证据：[设计资产总览](../../设计资产/README.md)。本文只维护接入方式。

原型应复用这两份文件，不再复制新的工具箱导航。源样式对应 `src/App.tsx`、`src/ui/TabNav.tsx`、`src/ui/plan/GroupPlanHub.tsx`。这不是业务组件，不改 React 代码。

```html
<link rel="stylesheet" href="../../../docs/prototypes/shared/toolbox-shell.css">
<link rel="stylesheet" href="../../../docs/prototypes/shared/toolbox-modal.css">
<main id="app"></main>
<script src="../../../docs/prototypes/shared/toolbox-shell.js"></script>
<script>
const shell = ToolboxShell.mount('#app', {
  groupName: '换蛋小组', memberCount: 6,
  renderHub: tab => tab === 'mine' ? '<p>我的收集</p>' : '<p>组内广场</p>'
});
// 打开独立详情：隐藏组头和组内页签，不更改全局“小组”选中态。
shell.openDetail({title:'蛋仓', render:()=>'<p>库存列表</p>'});
// 单项详情用弹窗，嵌套关闭回上层；最后一层关闭恢复列表。
shell.openModal({title:'蛋详情', render:()=>'<p>蛋与实际亲本</p>'});
// shell.closeModal(); shell.closeAllModals();
// 返回保留进入来源、嵌套层级与列表滚动位置。
// shell.back(); shell.selectHub('square'); shell.refresh(); shell.toast('已保存');
</script>
```

- `renderHub` 只返回当前模块内容；工具箱标题栏、主导航、组头、计划中心页签由外壳负责。
- 支持 file URL，不依赖 React、Tailwind 编译或网络。
- 六个主标签只实现“小组”，其他入口点击说明原型范围。
- 原型共享资源时，应以项目根目录为本地服务根目录；本轮只提供本地预览，不部署。
- 完整列表调用 openDetail，保留主导航、收起组内页签。轻量详情/编辑调用 openModal，保留来源背景、屏蔽背景交互、Tab 焦点留在弹窗，Esc 关闭最上层。
- 业务示例、蛋数据、卡片、状态由原型自己的文件管理。

模态层由 shell.state.modals 管理，统一处理嵌套、滚动恢复、背景 inert 和焦点。最后一层关闭清理旧控件；业务变更后自行更新列表或调用 refresh。
