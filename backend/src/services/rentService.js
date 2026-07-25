import { createCrudService } from './baseService.js';
import { cashLedgerService } from './cashLedgerService.js';
import { cashierShiftService } from './cashierShiftService.js';

const base = createCrudService('rents', { entityName: 'rent' });

/**
 * Rent only touches the Restaurant Cash Ledger at the moment it's actually
 * paid, and only when paid in cash (card/bank-transfer never touch the
 * physical drawer). `orderId` doubles as the rent record's id so a later
 * edit or delete of an already-cash-paid rent can find and correct exactly
 * what it contributed, the same reference-based pattern used elsewhere.
 */
async function pay(id, { paymentMethod = 'cash', receiptUrl } = {}, user) {
  const before = await base.get(id, user);
  const updated = await base.update(id, {
    status: 'paid', paidDate: new Date().toISOString(), paymentMethod, receiptUrl,
  }, user);

  if (paymentMethod === 'cash') {
    const openShift = await cashierShiftService.openShiftFor(user?.sub, user);
    await cashLedgerService.record({
      restaurantId: before.restaurantId,
      amount: -(before.amount || 0),
      transactionType: 'RENT_PAID',
      orderId: id,
      cashierShiftId: openShift?.id || null,
      createdByUserId: user?.sub,
    });
  }
  return updated;
}

/** If a cash-paid rent's amount is corrected afterward, adjust the ledger by
 * exactly the delta rather than leaving the original amount permanently
 * recorded. */
async function update(id, patch, user) {
  const before = await base.get(id, user);
  const newAmount = patch.amount != null ? +patch.amount : before.amount;
  const updated = await base.update(id, { ...patch, amount: newAmount }, user);

  if (newAmount !== before.amount) {
    const currentContribution = await cashLedgerService.contributionFor(before.restaurantId, id);
    if (currentContribution) {
      const delta = -newAmount - currentContribution;
      if (delta) {
        const openShift = await cashierShiftService.openShiftFor(user?.sub, user);
        await cashLedgerService.record({
          restaurantId: before.restaurantId,
          amount: delta,
          transactionType: 'RENT_PAID',
          orderId: id,
          cashierShiftId: openShift?.id || null,
          createdByUserId: user?.sub,
        });
      }
    }
  }
  return updated;
}

/** Deleting an already-cash-paid rent reverses whatever it contributed —
 * the physical cash was already paid out, so removing the record is a
 * correction, not a way to make the ledger forget real cash left the till. */
async function remove(id, user) {
  const before = await base.get(id, user);
  const contribution = await cashLedgerService.contributionFor(before.restaurantId, id);
  if (contribution) {
    await cashLedgerService.record({
      restaurantId: before.restaurantId,
      amount: -contribution,
      transactionType: 'RENT_PAID',
      orderId: id,
      createdByUserId: user?.sub,
    });
  }
  return base.remove(id, user);
}

export const rentService = { ...base, pay, update, remove };
export default rentService;
