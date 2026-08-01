import { createCrudService } from './baseService.js';
import { cashLedgerService } from './cashLedgerService.js';
import { cashierShiftService } from './cashierShiftService.js';

const base = createCrudService('expenses', { entityName: 'petty_cash' });

/**
 * Petty cash is real cash leaving the drawer by definition, so every entry
 * keeps the Restaurant Cash Ledger in sync with the expense record's amount
 * across its whole lifecycle (create / edit / delete) — the same pattern
 * used for Cash Advances.
 */
async function create(data, user) {
  // The date is always the system's own current date, never client-supplied —
  // the cashier/admin cannot back-date or post-date an expense from the UI.
  const created = await base.create({ ...data, date: new Date().toISOString().slice(0, 10) }, user);
  const openShift = await cashierShiftService.openShiftFor(user?.sub, user);
  await cashLedgerService.record({
    restaurantId: user?.restaurantId,
    amount: -(created.amount || 0),
    transactionType: 'PETTY_CASH_EXPENSE',
    orderId: created.id,
    cashierShiftId: openShift?.id || null,
    createdByUserId: user?.sub,
  });
  return created;
}

async function update(id, patch, user) {
  const before = await base.get(id, user);
  const newAmount = patch.amount != null ? +patch.amount : before.amount;
  const updated = await base.update(id, { ...patch, amount: newAmount }, user);

  if (newAmount !== before.amount) {
    const currentContribution = await cashLedgerService.contributionFor(before.restaurantId, id);
    const delta = -newAmount - currentContribution;
    if (delta) {
      const openShift = await cashierShiftService.openShiftFor(user?.sub, user);
      await cashLedgerService.record({
        restaurantId: before.restaurantId,
        amount: delta,
        transactionType: 'PETTY_CASH_EXPENSE',
        orderId: id,
        cashierShiftId: openShift?.id || null,
        createdByUserId: user?.sub,
      });
    }
  }
  return updated;
}

async function remove(id, user) {
  const before = await base.get(id, user);
  const contribution = await cashLedgerService.contributionFor(before.restaurantId, id);
  if (contribution) {
    await cashLedgerService.record({
      restaurantId: before.restaurantId,
      amount: -contribution,
      transactionType: 'PETTY_CASH_EXPENSE',
      orderId: id,
      createdByUserId: user?.sub,
    });
  }
  return base.remove(id, user);
}

export const pettyCashService = { ...base, create, update, remove };
export default pettyCashService;
