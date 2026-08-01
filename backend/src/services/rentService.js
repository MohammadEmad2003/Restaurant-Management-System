import { createCrudService } from './baseService.js';

const base = createCrudService('rents', { entityName: 'rent' });

/** Default `initialDate` to today when not explicitly given, same as every
 * other "date this was entered" field elsewhere in the app. */
async function create(data, user) {
  return base.create({ ...data, initialDate: data.initialDate || new Date().toISOString().slice(0, 10) }, user);
}

/**
 * Rent/periodic-payment records are payroll/accounting bookkeeping only —
 * they deliberately do NOT touch the Restaurant Cash Ledger/Cash Drawer at
 * all (that's a separate financial concept). Paying one just flips its
 * status/paidDate so the admin can see what's settled; unpaying reverses
 * that flip.
 */
async function pay(id, { paymentMethod = 'cash', receiptUrl } = {}, user) {
  const before = await base.get(id, user);
  const paidDate = new Date().toISOString();
  const paymentHistory = [...(before.paymentHistory || []), { date: paidDate, amount: before.amount, paymentMethod }];
  return base.update(id, { status: 'paid', paidDate, paymentMethod, receiptUrl, paymentHistory }, user);
}

/** Reverse a pay() — e.g. it was marked paid by mistake. */
async function markUnpaid(id, user) {
  return base.update(id, { status: 'upcoming', paidDate: null }, user);
}

export const rentService = { ...base, create, pay, markUnpaid };
export default rentService;
