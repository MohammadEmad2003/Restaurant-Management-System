/**
 * Mock data generators. Produces a realistic, interconnected dataset across
 * every module so the dashboard, reports and analytics show real numbers.
 */
import { hashPassword } from '../utils/hash.js';

const DAY = 864e5;
const now = Date.now();
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[randInt(0, arr.length - 1)];
const dayStr = (ts) => new Date(ts).toISOString().slice(0, 10);
const monthStr = (ts) => new Date(ts).toISOString().slice(0, 7);

export async function buildMockData() {
  /* ── Locations (admin-managed governorates + areas) ── */
  const locationDefs = [
    ['Cairo — القاهرة', ['Maadi — المعادي', 'Nasr City — مدينة نصر', 'Heliopolis — مصر الجديدة', 'Zamalek — الزمالك', 'Shoubra — شبرا']],
    ['Giza — الجيزة', ['Dokki — الدقي', 'Mohandessin — المهندسين', '6th October — السادس من أكتوبر', 'Sheikh Zayed — الشيخ زايد']],
    ['Alexandria — الإسكندرية', ['Smouha — سموحة', 'Miami — ميامي']],
  ];
  const locations = [];
  for (const [governorate, areas] of locationDefs) {
    for (const area of areas) locations.push({ id: `LOC-${locations.length + 1}`, governorate, area });
  }
  const areaPool = locations.map((l) => ({ governorate: l.governorate, area: l.area }));

  /* ── Workers ── */
  const workerDefs = [
    { name: 'Admin User — المدير', username: 'admin', password: 'admin123', role: 'admin', phone: '+20 100 111 2222', salary: 18000, hireDate: '2022-01-15' },
    { name: 'Sara Ahmed — سارة أحمد', username: 'cashier', password: 'cashier123', role: 'cashier', phone: '+20 101 222 3333', salary: 7000, hireDate: '2023-03-10' },
    { name: 'Omar Hassan — عمر حسن', username: 'omar', password: 'password123', role: 'cashier', phone: '+20 102 333 4444', salary: 7200, hireDate: '2023-06-01' },
    { name: 'Layla Mahmoud — ليلى محمود', username: 'layla', password: 'password123', role: 'cashier', phone: '+20 103 444 5555', salary: 6800, hireDate: '2024-01-20' },
    { name: 'Khaled Nabil — خالد نبيل', username: 'khaled', password: 'password123', role: 'admin', phone: '+20 104 555 6666', salary: 15000, hireDate: '2022-09-05' },
    { name: 'Mona Adel — منى عادل', username: 'mona', password: 'password123', role: 'cashier', phone: '+20 105 666 7777', salary: 6500, hireDate: '2024-04-12', status: 'inactive' },
  ];
  const workers = [];
  for (const w of workerDefs) {
    workers.push({
      id: `WRK-${w.username}`,
      name: w.name, username: w.username, passwordHash: await hashPassword(w.password),
      role: w.role, phone: w.phone, salary: w.salary, hireDate: w.hireDate,
      status: w.status || 'active',
    });
  }

  /* ── Goods (inventory) ── */
  const goods = [
    { id: 'GD-cheese', name: 'Mozzarella Cheese — جبنة موتزاريلا', unit: 'g', quantityAvailable: 18000, purchasePrice: 0.012, minimumStockLevel: 5000, category: 'Dairy' },
    { id: 'GD-beef', name: 'Beef — لحم بقري', unit: 'g', quantityAvailable: 12000, purchasePrice: 0.02, minimumStockLevel: 4000, category: 'Meat' },
    { id: 'GD-chicken', name: 'Chicken — دجاج', unit: 'g', quantityAvailable: 15000, purchasePrice: 0.011, minimumStockLevel: 4000, category: 'Meat' },
    { id: 'GD-flour', name: 'Flour — دقيق', unit: 'g', quantityAvailable: 40000, purchasePrice: 0.002, minimumStockLevel: 8000, category: 'Dry' },
    { id: 'GD-rice', name: 'Rice — أرز', unit: 'g', quantityAvailable: 9000, purchasePrice: 0.003, minimumStockLevel: 10000, category: 'Dry' },
    { id: 'GD-sauce', name: 'Tomato Sauce — صلصة طماطم', unit: 'ml', quantityAvailable: 8000, purchasePrice: 0.004, minimumStockLevel: 3000, category: 'Sauce' },
    { id: 'GD-oil', name: 'Olive Oil — زيت زيتون', unit: 'ml', quantityAvailable: 6000, purchasePrice: 0.01, minimumStockLevel: 2000, category: 'Sauce' },
    { id: 'GD-lettuce', name: 'Lettuce — خس', unit: 'g', quantityAvailable: 3000, purchasePrice: 0.005, minimumStockLevel: 1500, category: 'Vegetable' },
    { id: 'GD-onion', name: 'Onion — بصل', unit: 'g', quantityAvailable: 5000, purchasePrice: 0.003, minimumStockLevel: 2000, category: 'Vegetable' },
    { id: 'GD-potato', name: 'Potato — بطاطس', unit: 'g', quantityAvailable: 14000, purchasePrice: 0.0025, minimumStockLevel: 5000, category: 'Vegetable' },
    { id: 'GD-cola', name: 'Cola Can — كولا', unit: 'can', quantityAvailable: 240, purchasePrice: 0.4, minimumStockLevel: 100, category: 'Beverage' },
    { id: 'GD-water', name: 'Water Bottle — مياه', unit: 'bottle', quantityAvailable: 300, purchasePrice: 0.15, minimumStockLevel: 120, category: 'Beverage' },
    { id: 'GD-coffee', name: 'Coffee Beans — بن', unit: 'g', quantityAvailable: 4000, purchasePrice: 0.03, minimumStockLevel: 1000, category: 'Beverage' },
    { id: 'GD-milk', name: 'Milk — حليب', unit: 'ml', quantityAvailable: 7000, purchasePrice: 0.002, minimumStockLevel: 3000, category: 'Dairy' },
    { id: 'GD-sugar', name: 'Sugar — سكر', unit: 'g', quantityAvailable: 9000, purchasePrice: 0.001, minimumStockLevel: 2000, category: 'Dry' },
  ];

  /* ── Products with recipes (ingredients reference goods) ── */
  const products = [
    { id: 'PRD-margherita', name: 'Margherita Pizza — بيتزا مارجريتا', category: 'Pizza', price: 12, ingredients: [{ goodId: 'GD-cheese', quantityRequired: 200 }, { goodId: 'GD-flour', quantityRequired: 300 }, { goodId: 'GD-sauce', quantityRequired: 100 }, { goodId: 'GD-oil', quantityRequired: 20 }] },
    { id: 'PRD-pepperoni', name: 'Pepperoni Pizza — بيتزا بيبروني', category: 'Pizza', price: 14, ingredients: [{ goodId: 'GD-cheese', quantityRequired: 200 }, { goodId: 'GD-flour', quantityRequired: 300 }, { goodId: 'GD-sauce', quantityRequired: 100 }, { goodId: 'GD-beef', quantityRequired: 80 }] },
    { id: 'PRD-beefburger', name: 'Beef Burger — برجر لحم', category: 'Burgers', price: 9, ingredients: [{ goodId: 'GD-beef', quantityRequired: 180 }, { goodId: 'GD-flour', quantityRequired: 80 }, { goodId: 'GD-lettuce', quantityRequired: 30 }, { goodId: 'GD-onion', quantityRequired: 20 }] },
    { id: 'PRD-chickenburger', name: 'Chicken Burger — برجر دجاج', category: 'Burgers', price: 8.5, ingredients: [{ goodId: 'GD-chicken', quantityRequired: 170 }, { goodId: 'GD-flour', quantityRequired: 80 }, { goodId: 'GD-lettuce', quantityRequired: 30 }] },
    { id: 'PRD-caesar', name: 'Caesar Salad — سلطة سيزر', category: 'Salads', price: 7, ingredients: [{ goodId: 'GD-lettuce', quantityRequired: 150 }, { goodId: 'GD-chicken', quantityRequired: 100 }, { goodId: 'GD-oil', quantityRequired: 15 }] },
    { id: 'PRD-fries', name: 'French Fries — بطاطس مقلية', category: 'Sides', price: 4, ingredients: [{ goodId: 'GD-potato', quantityRequired: 250 }, { goodId: 'GD-oil', quantityRequired: 50 }] },
    { id: 'PRD-grilledchicken', name: 'Grilled Chicken — دجاج مشوي', category: 'Main', price: 11, ingredients: [{ goodId: 'GD-chicken', quantityRequired: 300 }, { goodId: 'GD-oil', quantityRequired: 30 }] },
    { id: 'PRD-ricebowl', name: 'Chicken Rice Bowl — أرز بالدجاج', category: 'Main', price: 8, ingredients: [{ goodId: 'GD-rice', quantityRequired: 200 }, { goodId: 'GD-chicken', quantityRequired: 150 }] },
    { id: 'PRD-cola', name: 'Cola — كولا', category: 'Drinks', price: 2, ingredients: [{ goodId: 'GD-cola', quantityRequired: 1 }] },
    { id: 'PRD-water', name: 'Water — مياه', category: 'Drinks', price: 1, ingredients: [{ goodId: 'GD-water', quantityRequired: 1 }] },
    { id: 'PRD-coffee', name: 'Coffee — قهوة', category: 'Hot Drinks', price: 3, ingredients: [{ goodId: 'GD-coffee', quantityRequired: 18 }, { goodId: 'GD-milk', quantityRequired: 100 }, { goodId: 'GD-sugar', quantityRequired: 10 }] },
  ].map((p) => ({ ...p, active: true, imageUrl: '' }));

  /* ── Clients ── */
  const clientDefs = [
    ['Ahmed Ali — أحمد علي', ['+20 100 123 4567', '+20 111 765 4321'], ['12 Nile St, Cairo', 'Office: 5 Tahrir Sq']],
    ['Fatima Youssef — فاطمة يوسف', ['+20 101 234 5678'], ['34 Zamalek, Cairo']],
    ['Mohamed Saeed — محمد سعيد', ['+20 102 345 6789'], ['7 Maadi, Cairo']],
    ['Nour Hassan — نور حسن', ['+20 103 456 7890', '+20 109 999 8888'], ['90 Heliopolis']],
    ['Yara Ibrahim — يارا إبراهيم', ['+20 104 567 8901'], ['Nasr City, Cairo']],
    ['Tarek Fouad — طارق فؤاد', ['+20 105 678 9012'], ['Dokki, Giza']],
    ['Hana Mostafa — هنا مصطفى', ['+20 106 789 0123'], ['6th October City']],
    ['Ali Mansour — علي منصور', ['+20 107 890 1234'], ['New Cairo']],
    ['Salma Adel — سلمى عادل', ['+20 108 901 2345'], ['Garden City']],
    ['Karim Wael — كريم وائل', ['+20 109 012 3456'], ['Sheikh Zayed']],
    ['Dina Sami — دينا سامي', ['+20 110 111 2222'], ['Mohandessin']],
    ['Hassan Tamer — حسن تامر', ['+20 111 222 3333'], ['Shoubra, Cairo']],
  ];
  const clients = clientDefs.map(([name, phoneNumbers, addresses], i) => {
    const loc = pick(areaPool);
    return {
      id: `CLI-${String(i + 1).padStart(3, '0')}`,
      name, phoneNumbers, addresses,
      governorate: loc.governorate, area: loc.area,
      notes: pick(['VIP customer', 'Prefers extra cheese', 'Allergic to nuts', 'Delivery only', '']),
      loyaltyPoints: 0, totalSpent: 0, visitCount: 0,
      preferences: pick([['No onion'], ['Spicy'], ['Extra sauce'], []]),
      createdAt: now - randInt(30, 300) * DAY,
    };
  });

  /* ── Orders across the last 30 days (drives finance + analytics) ── */
  const orders = [];
  const loyaltyTx = [];
  const kdsTickets = [];
  for (let d = 30; d >= 0; d--) {
    const ordersToday = randInt(3, 9);
    for (let k = 0; k < ordersToday; k++) {
      const ts = now - d * DAY - randInt(0, 14) * 3.6e6 - randInt(0, 59) * 60000;
      const lineCount = randInt(1, 4);
      const lines = [];
      for (let l = 0; l < lineCount; l++) {
        const p = pick(products);
        lines.push({ productId: p.id, name: p.name, quantity: randInt(1, 3), unitPrice: p.price });
      }
      const total = +lines.reduce((s, x) => s + x.quantity * x.unitPrice, 0).toFixed(2);
      const client = Math.random() < 0.7 ? pick(clients) : null;
      const cashier = pick(workers.filter((w) => w.status === 'active'));
      const status = Math.random() < 0.08 ? 'cancelled' : 'completed';
      const order = {
        id: `ORD-${dayStr(ts).replace(/-/g, '')}-${k}`,
        invoiceNo: `INV-${String(orders.length + 1).padStart(5, '0')}`,
        clientId: client?.id || null, clientName: client?.name || 'Walk-in',
        governorate: client?.governorate || '', area: client?.area || '',
        cashierId: cashier.id, orderDate: ts,
        products: lines, totalPrice: total,
        notes: '', paymentMethod: pick(['cash', 'card', 'wallet']),
        status,
      };
      orders.push(order);

      if (status === 'completed' && client) {
        client.totalSpent = +(client.totalSpent + total).toFixed(2);
        client.visitCount += 1;
        const pts = Math.floor(total * 0.1);
        client.loyaltyPoints += pts;
        loyaltyTx.push({ id: `LOY-${loyaltyTx.length + 1}`, clientId: client.id, points: pts, type: 'earn', orderId: order.id, date: dayStr(ts), createdAt: ts });
      }
    }
  }
  // a handful of live kitchen tickets from the most recent orders
  for (const order of orders.filter((o) => o.status === 'completed').slice(-6)) {
    kdsTickets.push({
      id: `KDS-${order.id}`, orderId: order.id, invoiceNo: order.invoiceNo,
      items: order.products.map((p) => ({ name: p.name, quantity: p.quantity })),
      status: pick(['new', 'preparing', 'ready']), priority: pick(['normal', 'normal', 'high']),
      startedAt: now - randInt(1, 25) * 60000,
    });
  }

  /* ── Attendance (last ~25 working days per active worker) ── */
  const attendance = [];
  for (const w of workers.filter((x) => x.status === 'active')) {
    for (let d = 25; d >= 0; d--) {
      if (Math.random() < 0.15) continue; // day off
      const date = dayStr(now - d * DAY);
      const checkIn = new Date(`${date}T08:${String(randInt(0, 30)).padStart(2, '0')}:00`).getTime();
      const hours = +rand(7, 10).toFixed(2);
      const checkOut = checkIn + hours * 3.6e6;
      attendance.push({
        id: `ATT-${w.id}-${date}`, workerId: w.id, workerName: w.name, date,
        checkInTime: checkIn, checkOutTime: checkOut,
        totalHours: hours, overtimeHours: Math.max(0, +(hours - 8).toFixed(2)),
        shift: 'day', lateMinutes: Math.random() < 0.2 ? randInt(5, 25) : 0,
        excused: false, status: 'present', isOffDay: false, overtimeApproved: true,
      });
    }
  }

  /* ── Purchases + Expenses ── */
  const purchases = [];
  const expenses = [];
  for (let d = 28; d >= 0; d -= randInt(2, 5)) {
    const g = pick(goods);
    const qty = randInt(2000, 8000);
    const cost = +(qty * g.purchasePrice).toFixed(2);
    const date = dayStr(now - d * DAY);
    purchases.push({ id: `PUR-${purchases.length + 1}`, goodId: g.id, quantity: qty, unitPrice: g.purchasePrice, totalCost: cost, supplier: pick(['FreshCo', 'MetroSupply', 'FarmDirect']), date });
    expenses.push({ id: `EXP-pur-${expenses.length + 1}`, type: 'purchase', amount: cost, description: `Purchase ${g.name}`, refId: g.id, date });
  }
  expenses.push({ id: 'EXP-misc-1', type: 'misc', amount: 450, description: 'Electricity bill', date: dayStr(now - 10 * DAY) });
  expenses.push({ id: 'EXP-misc-2', type: 'misc', amount: 300, description: 'Cleaning supplies', date: dayStr(now - 5 * DAY) });

  /* ── Salaries (current month) ── */
  const month = monthStr(now);
  const salaries = workers.filter((w) => w.status === 'active').map((w, i) => {
    const overtimePay = +rand(100, 600).toFixed(2);
    return { id: `SAL-${month}-${w.id}`, workerId: w.id, workerName: w.name, month, baseSalary: w.salary, overtimePay, deductions: 0, netPay: +(w.salary + overtimePay).toFixed(2), paid: i % 2 === 0 };
  });

  /* ── Goods checks (waste) ── */
  const goodsChecks = [];
  for (let i = 0; i < 14; i++) {
    const g = pick(goods);
    const expected = g.quantityAvailable;
    const actual = +(expected - rand(0, expected * 0.05)).toFixed(2);
    const diff = +(expected - actual).toFixed(2);
    goodsChecks.push({
      id: `CHK-${i + 1}`, date: dayStr(now - randInt(0, 27) * DAY), goodId: g.id,
      expectedQuantity: expected, actualQuantity: actual, difference: diff,
      lossValue: +(diff * g.purchasePrice).toFixed(2),
      reason: pick(['Spoilage', 'Over-portioning', 'Spillage', 'Theft suspected', 'Expired']),
      checkedBy: 'WRK-admin',
    });
  }

  /* ── Reservations ── */
  const reservations = [];
  for (let i = 0; i < 12; i++) {
    const future = i < 8;
    const dt = now + (future ? randInt(1, 10) : -randInt(1, 15)) * DAY + randInt(11, 22) * 3.6e6;
    const c = pick(clients);
    reservations.push({
      id: `RSV-${i + 1}`, clientId: c.id, clientName: c.name,
      tableId: `T${randInt(1, 20)}`, partySize: randInt(2, 8), dateTime: dt,
      status: future ? pick(['booked', 'booked', 'waitlist']) : pick(['completed', 'completed', 'no_show']),
      notes: pick(['Birthday', 'Window seat', 'Anniversary', '']),
    });
  }

  /* ── Shifts (weekly template: Sun–Thu working week) ── */
  const shifts = [];
  for (const w of workers.filter((x) => x.status === 'active')) {
    for (let dow = 0; dow <= 4; dow++) { // 0=Sun … 4=Thu
      shifts.push({
        id: `SHF-${w.id}-${dow}`, workerId: w.id, workerName: w.name,
        dayOfWeek: dow, start: '09:00', end: '17:00', role: w.role,
      });
    }
  }

  /* ── Audit log samples ── */
  const auditLogs = [
    { id: 'LOG-1', userId: 'WRK-admin', userName: 'Admin User', action: 'PRODUCT_CREATED', entityType: 'products', entityId: 'PRD-margherita', timestamp: now - 20 * DAY },
    { id: 'LOG-2', userId: 'WRK-admin', userName: 'Admin User', action: 'GOOD_PURCHASED', entityType: 'goods', entityId: 'GD-cheese', timestamp: now - 3 * DAY },
    { id: 'LOG-3', userId: 'WRK-cashier', userName: 'Sara Ahmed', action: 'ORDER_CREATED', entityType: 'orders', entityId: orders[0]?.id, timestamp: now - 1 * DAY },
  ];

  /* ── Settings ── */
  const settings = [{
    id: 'SET-main', restaurantName: 'Bella Cucina — بيلا كوتشينا',
    currency: 'EGP', taxRate: 14, language: 'en', theme: 'violet',
    loyaltyRate: 0.1, address: 'Tahrir St, Cairo', phone: '+20 2 1000 1000',
  }];

  return {
    locations, workers, goods, products, clients, orders, loyaltyTx, kdsTickets,
    attendance, purchases, expenses, salaries, goodsChecks, reservations, shifts,
    auditLogs, settings,
  };
}

export default buildMockData;
