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
    role: t('string', { required: true, enum: ['admin', 'cashier'] }),
    phone: t('string'),
    salary: t('number', { min: 0 }),
    hireDate: t('string'),
    status: t('string', { enum: ['active', 'inactive'], default: 'active' }),
    branchId: t('string'),
  },
  attendance: {
    workerId: t('string', { required: true }),
    checkInTime: t('number'),
    checkOutTime: t('number'),
    date: t('string', { required: true }),
    totalHours: t('number'),
    overtimeHours: t('number'),
  },
  clients: {
    name: t('string', { required: true }),
    phoneNumbers: t('array', { default: [] }),
    addresses: t('array', { default: [] }),
    notes: t('string'),
    loyaltyPoints: t('number', { default: 0 }),
    totalSpent: t('number', { default: 0 }),
    visitCount: t('number', { default: 0 }),
    preferences: t('array', { default: [] }),
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
    branchId: t('string'),
  },
  goodsChecks: {
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
    date: t('string'),
  },
  expenses: {
    type: t('string', { required: true, enum: ['purchase', 'salary', 'misc'] }),
    amount: t('number', { required: true, min: 0 }),
    description: t('string'),
    refId: t('string'),
    date: t('string'),
  },
  salaries: {
    workerId: t('string', { required: true }),
    month: t('string', { required: true }),
    baseSalary: t('number', { default: 0 }),
    overtimePay: t('number', { default: 0 }),
    deductions: t('number', { default: 0 }),
    netPay: t('number'),
    paid: t('boolean', { default: false }),
  },
  reservations: {
    clientId: t('string'),
    clientName: t('string'),
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
    workerId: t('string', { required: true }),
    workerName: t('string'),
    start: t('string', { required: true }),
    end: t('string', { required: true }),
    role: t('string'),
    date: t('string', { required: true }),
    branchId: t('string'),
  },
  branches: {
    name: t('string', { required: true }),
    address: t('string'),
    phone: t('string'),
    active: t('boolean', { default: true }),
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
