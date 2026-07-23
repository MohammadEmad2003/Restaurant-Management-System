/**
 * Entity schemas + a tiny validator. Each schema declares required fields and
 * (optionally) an `enum`/`type` so writes are validated before persistence.
 * This is the structure-enforcement layer that keeps Firestore consistent.
 */

const t = (type, opts = {}) => ({ type, ...opts });

export const schemas = {
  workers: {
    name: t('string', { required: true }),
    username: t('string', { required: true }),
    role: t('string', { required: true, enum: ['admin', 'cashier', 'chef'] }),
    phone: t('string'),
    salary: t('number', { min: 0 }),
    hireDate: t('string'),
    status: t('string', { enum: ['active', 'inactive'], default: 'active' }),
  },
  attendance: {
    workerId: t('string', { required: true }),
    workerName: t('string'),
    checkInTime: t('number'),
    checkOutTime: t('number'),
    date: t('string', { required: true }),
    totalHours: t('number'),
    overtimeHours: t('number'),
    shift: t('string', { enum: ['day', 'night'] }), // day = 12:00→00:00, night = 00:00→12:00
    lateMinutes: t('number', { default: 0 }),
    excused: t('boolean', { default: false }), // admin can excuse lateness (no deduction)
    status: t('string', { enum: ['present', 'absent'], default: 'present' }),
    isOffDay: t('boolean', { default: false }), // worked on a day not scheduled → overtime
    overtimeApproved: t('boolean', { default: true }), // admin can apply/remove overtime
  },
  cashierShifts: {
    cashierId: t('string', { required: true }),
    cashierName: t('string'),
    status: t('string', { enum: ['open', 'closed'], default: 'open' }),
    openedAt: t('number', { required: true }),
    closedAt: t('number'),
    openingFloat: t('number', { default: 0 }),   // starting cash; 0 = previous cash deposited to owner
    cashSales: t('number', { default: 0 }),       // cash orders during the shift
    expectedCash: t('number', { default: 0 }),    // openingFloat + cashSales
    countedCash: t('number', { default: 0 }),     // cash the cashier physically counted
    difference: t('number', { default: 0 }),      // countedCash - expectedCash (+ over / - short)
    confirmed: t('boolean', { default: false }),
    depositedToOwner: t('boolean', { default: false }),
    nextCashierId: t('string'),
    nextCashierName: t('string'),
    notes: t('string'),
    // Whether the next cashier has already opened their shift against this
    // one's handed-over (not deposited to owner) float — prevents the same
    // physical cash from being re-added to the Restaurant Cash Ledger twice.
    handoverConsumed: t('boolean', { default: false }),
  },
  clients: {
    name: t('string', { required: true }),
    phoneNumbers: t('array', { default: [] }),
    addresses: t('array', { default: [] }),
    city: t('string'),          // fixed, admin-managed location (for profit-by-area reports); was "governorate"
    area: t('string'),          // area / district within the city
    notes: t('string'),
    loyaltyPoints: t('number', { default: 0 }),
    totalSpent: t('number', { default: 0 }),
    visitCount: t('number', { default: 0 }),
    preferences: t('array', { default: [] }),
    status: t('string', { enum: ['active', 'deleted'], default: 'active' }),
  },
  locations: {
    city: t('string', { required: true }),  // was "governorate"
    area: t('string'), // a single area/district inside the city
  },
  deliveryAgents: {
    name: t('string', { required: true }),
    phone: t('string'),
    active: t('boolean', { default: true }),
  },
  // Restaurant-level Cash Ledger — the sole authoritative source for the
  // Restaurant-wide Cash Drawer balance. Deliberately independent of
  // cashierShifts: a transaction may optionally reference the shift that was
  // open when it happened (cashierShiftId), but a valid cash transaction must
  // never be blocked or lost just because no shift happens to be open.
  cashLedger: {
    amount: t('number', { required: true }), // signed: positive = cash in, negative = cash out
    transactionType: t('string', {
      required: true,
      enum: ['CASH_SALE', 'DELIVERY_AGENT_PAID_NOW', 'PENDING_PAYMENT_SETTLEMENT', 'SHIFT_OPEN_FLOAT', 'SHIFT_CLOSE_ADJUSTMENT', 'CASH_ADVANCE'],
    }),
    orderId: t('string'),
    cashierShiftId: t('string'), // nullable — optional attribution only, never a precondition
    createdByUserId: t('string'),
  },
  goods: {
    name: t('string', { required: true }),
    unit: t('string', { required: true }),
    quantityAvailable: t('number', { default: 0 }),
    purchasePrice: t('number', { min: 0, default: 0 }),
    minimumStockLevel: t('number', { default: 0 }),
    category: t('string'),
  },
  products: {
    name: t('string', { required: true }),
    category: t('string', { required: true }),
    price: t('number', { required: true, min: 0 }),
    ingredients: t('array', { default: [] }), // [{ goodId, quantityRequired }]
    imageUrl: t('string'),
    active: t('boolean', { default: true }),
  },
  orders: {
    clientId: t('string'),
    cashierId: t('string'), // derived from the authenticated user when omitted
    orderDate: t('number'),
    products: t('array', { required: true }), // [{ productId, quantity, unitPrice }]
    totalPrice: t('number'),
    notes: t('string'),
    paymentMethod: t('string', { enum: ['cash', 'card', 'wallet'], default: 'cash' }),
    status: t('string', { enum: ['pending', 'preparing', 'completed', 'cancelled'], default: 'pending' }),
    city: t('string'),       // snapshot of the customer's location for reporting; was "governorate"
    area: t('string'),
    deliveryAddress: t('string'),   // specific drop-off address for delivery orders
    deliveryPerson: t('string'),    // name of the delivery man handling the order (printed on receipt)
    deliveryAgentId: t('string'),   // registered delivery agent handling this order, if any
    deliveryAgentName: t('string'), // snapshot of the agent's name
    // No schema-level default: orderService.create() decides paid-vs-pending
    // based on whether a delivery agent is assigned — a static default here
    // would run before that business logic and always win.
    paymentStatus: t('string', { enum: ['paid', 'pending'] }),
    // Only meaningful for delivery-agent orders: whether the cashier collected
    // the money immediately, or the agent settles at the end of the day.
    // "Payment is expected" (END_OF_DAY + pending) vs "payment actually
    // received" (paid, regardless of timing) are never the same state.
    // PAID_NOW: money already received, order is PAID immediately.
    // END_OF_DAY: agent explicitly expected to settle at end of day.
    // UNPAID_PRINTED: receipt printed now but payment simply hasn't been
    // received yet — a distinct business intent from END_OF_DAY even though
    // both currently resolve to paymentStatus=pending (never conflate this
    // enum with paymentStatus itself).
    paymentTiming: t('string', { enum: ['PAID_NOW', 'END_OF_DAY', 'UNPAID_PRINTED'] }),
    paidAt: t('string'),
  },
  goodsChecks: {
    auditId: t('string'),          // human-readable audit code, e.g. AUD-XYZ123
    date: t('string', { required: true }),
    goodId: t('string', { required: true }),
    expectedQuantity: t('number'),
    actualQuantity: t('number', { required: true }),
    difference: t('number'),
    reason: t('string'),
    checkedBy: t('string'),
  },
  purchases: {
    goodId: t('string', { required: true }),
    quantity: t('number', { required: true, min: 0 }),
    unitPrice: t('number', { required: true, min: 0 }),
    totalCost: t('number'),
    supplier: t('string'),
    supplierId: t('string'),
    date: t('string'),
  },
  suppliers: {
    name: t('string', { required: true }),
    phone: t('string'),
    email: t('string'),
    address: t('string'),
    notes: t('string'),
  },
  expenses: {
    type: t('string', { required: true, enum: ['purchase', 'salary', 'misc', 'petty_cash', 'rent'] }),
    amount: t('number', { required: true, min: 0 }),
    description: t('string'),
    category: t('string', { enum: ['utilities', 'cleaning', 'repairs', 'transport', 'supplies', 'maintenance', 'miscellaneous', 'rent', 'other'], default: 'miscellaneous' }),
    refId: t('string'),
    paidBy: t('string'),        // worker name who handled the payment
    receiptUrl: t('string'),    // optional receipt image reference
    date: t('string'),
  },
  salaries: {
    workerId: t('string', { required: true }),
    month: t('string', { required: true }),
    baseSalary: t('number', { default: 0 }),
    overtimeHours: t('number', { default: 0 }),
    overtimePay: t('number', { default: 0 }),
    lateMinutes: t('number', { default: 0 }),
    lateDeduction: t('number', { default: 0 }),
    bonus: t('number', { default: 0 }),
    deductions: t('number', { default: 0 }),
    netPay: t('number'),
    notes: t('string'),
    paid: t('boolean', { default: false }),
  },
  reservations: {
    clientId: t('string'),
    clientName: t('string'),
    // Free-text table label (e.g. "T5") — not a foreign key; there is no tables collection.
    tableId: t('string'),
    partySize: t('number', { default: 1 }),
    dateTime: t('number', { required: true }),
    status: t('string', { enum: ['booked', 'seated', 'completed', 'no_show', 'waitlist'], default: 'booked' }),
    notes: t('string'),
  },
  kdsTickets: {
    orderId: t('string', { required: true }),
    items: t('array', { default: [] }),
    status: t('string', { enum: ['new', 'preparing', 'ready', 'served'], default: 'new' }),
    priority: t('string', { enum: ['low', 'normal', 'high'], default: 'normal' }),
  },
  shifts: {
    // Weekly template: a worker is assigned a recurring shift on a day of the week
    // (0 = Sunday … 6 = Saturday) rather than a one-off calendar date.
    workerId: t('string', { required: true }),
    workerName: t('string'),
    start: t('string', { required: true }),
    end: t('string', { required: true }),
    role: t('string'),
    dayOfWeek: t('number', { required: true, min: 0 }),
  },
  complaints: {
    clientId: t('string'),
    clientName: t('string', { required: true }),
    phone: t('string'),
    description: t('string', { required: true }),
    category: t('string', { enum: ['food', 'service', 'cleanliness', 'other'], default: 'other' }),
    status: t('string', { enum: ['open', 'in-progress', 'resolved', 'closed'], default: 'open' }),
    priority: t('string', { enum: ['low', 'normal', 'high'], default: 'normal' }),
    date: t('string', { required: true }),
    resolvedBy: t('string'),
    resolvedAt: t('number'),
    resolutionNotes: t('string'),
  },
  rents: {
    locationId: t('string', { required: true }),
    locationName: t('string'),
    landlord: t('string'),
    amount: t('number', { required: true, min: 0 }),
    dueDate: t('string', { required: true }),
    paidDate: t('string'),
    paymentMethod: t('string', { enum: ['cash', 'card', 'bank-transfer'], default: 'cash' }),
    period: t('string', { enum: ['weekly', 'biweekly', 'monthly', 'quarterly', 'annual'], default: 'monthly' }),
    status: t('string', { enum: ['upcoming', 'paid', 'overdue'], default: 'upcoming' }),
    receiptUrl: t('string'),
    notes: t('string'),
  },
  cashAdvances: {
    workerId: t('string', { required: true }),
    workerName: t('string', { required: true }),
    amount: t('number', { required: true, min: 0 }),
    date: t('string', { required: true }),
    description: t('string'),
    status: t('string', { enum: ['pending', 'deducted', 'reimbursed'], default: 'pending' }),
    repaymentMethod: t('string', { enum: ['salary-deduction', 'cash-reimbursement'], default: 'salary-deduction' }),
    notes: t('string'),
  },
  loyaltyTx: {
    clientId: t('string', { required: true }),
    points: t('number', { required: true }),
    type: t('string', { required: true, enum: ['earn', 'redeem'] }),
    orderId: t('string'),
    date: t('string'),
  },
};

/** Validate `data` against a schema. Returns { valid, errors, value }. */
export function validate(collection, data, { partial = false } = {}) {
  const schema = schemas[collection];
  if (!schema) return { valid: true, errors: [], value: data };

  const errors = [];
  const value = { ...data };

  for (const [field, rule] of Object.entries(schema)) {
    const present = value[field] !== undefined && value[field] !== null && value[field] !== '';
    if (!present && rule.default !== undefined && !partial) value[field] = rule.default;
    if (!present) {
      if (rule.required && !partial) errors.push(`${field} is required`);
      continue;
    }
    if (rule.type === 'number' && typeof value[field] !== 'number') {
      const n = Number(value[field]);
      if (Number.isNaN(n)) errors.push(`${field} must be a number`);
      else value[field] = n;
    }
    if (rule.type === 'array' && !Array.isArray(value[field])) errors.push(`${field} must be an array`);
    if (rule.enum && !rule.enum.includes(value[field])) errors.push(`${field} must be one of: ${rule.enum.join(', ')}`);
    if (rule.min !== undefined && Number(value[field]) < rule.min) errors.push(`${field} must be >= ${rule.min}`);
  }
  return { valid: errors.length === 0, errors, value };
}

export default { schemas, validate };
