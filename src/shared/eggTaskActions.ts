import type { WorkflowTrade } from './eggWorkflow';

export const eggTaskReady = (trade: WorkflowTrade): boolean =>
  (!(trade.line || trade.legacy) || trade.placed) && (!trade.returnLine || !!trade.returnPlaced) &&
  (!trade.line||!!trade.giveEggId)&&(!trade.returnLine||!!trade.returnEggId);

export function eggTaskNeedsPlacement(trade: WorkflowTrade, accountId: string): boolean {
  if (trade.status !== 'accepted') return false;
  return trade.demanderAccountId === accountId
    ? !!trade.returnLine && !trade.returnPlaced
    : trade.supplierAccountId === accountId && !!(trade.line || trade.legacy) && !trade.placed;
}

export function eggTaskActionable(trade: WorkflowTrade, accountId: string): boolean {
  if (trade.status === 'proposed') return (trade.initiatorAccountId === trade.demanderAccountId ? trade.supplierAccountId : trade.demanderAccountId) === accountId;
  return trade.status === 'accepted' && (eggTaskNeedsPlacement(trade, accountId) ||
    (trade.supplierAccountId===accountId&&!!trade.line&&!trade.giveEggId)||(trade.demanderAccountId===accountId&&!!trade.returnLine&&!trade.returnEggId) ||
    (trade.demanderAccountId === accountId && eggTaskReady(trade)));
}
