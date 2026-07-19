import fs from 'fs';
import { renderReportPdf } from './src/utils/pdf.js';

const result = await renderReportPdf({
  restaurantName: 'مطعم الأمواج',
  title: 'تقرير المبيعات اليومي',
  date: '٢٠٢٥/٠٧/٢٣',
  lang: 'ar',
  columns: [
    { key: 'name', label: 'المنتج' },
    { key: 'qty', label: 'الكمية' },
    { key: 'price', label: 'السعر' },
    { key: 'total', label: 'الإجمالي' }
  ],
  rows: [
    { name: 'شاورما دجاج', qty: 5, price: 25, total: 125 },
    { name: 'كبسة لحم', qty: 3, price: 40, total: 120 },
    { name: 'عصير برتقال طازج', qty: 8, price: 10, total: 80 },
    { name: 'منسف أردني', qty: 2, price: 50, total: 100 }
  ],
  totals: {
    'إجمالي المبيعات': 425,
    'عدد الطلبات': 18
  }
});

fs.writeFileSync('test-arabic-fix.pdf', result.buffer);
console.log('PDF written: test-arabic-fix.pdf');
console.log('Size:', (result.buffer.length / 1024).toFixed(1), 'KB');
