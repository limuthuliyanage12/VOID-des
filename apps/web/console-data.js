/* VOID · console-data.js: sample data for the two consoles. Names and order details are placeholders.
   The checks at the foot assert that the sums match the fan site, so a bad edit shows up in the console. */
(() => {
const D = window.D = {};
D.weekly = [['1 Jan', 300], ['8 Jan', 262], ['15 Jan', 238, 'Phase 1 sold out'], ['22 Jan', 270], ['29 Jan', 265], ['5 Feb', 265, 'Phase 3 opened'], ['12 Feb', 142], ['19 Feb', 100]];
D.channels = [['Instagram', 792], ['WhatsApp', 534], ['Promoter links', 313], ['Direct', 203]];
D.paid = [['Card', 12810000], ['Koko', 2840000], ['Split pay', 940000]];
D.orders = [
  { code: 'VOID-2701842', who: 'Sanduni Wijesinghe', item: '2 × Phase 3', qty: 2, amount: 18900, status: 'Paid', pay: 'Card' },
  { code: 'VOID-2701841', who: 'Kavindu Rathnayake', item: '4 × Phase 3', qty: 4, amount: 37800, status: 'Split pending', pay: 'Split' },
  { code: 'VOID-2701840', who: 'Ishara Gunawardena', item: 'Table P04 · Platinum', qty: 1, amount: 189000, status: 'Paid', pay: 'Koko' },
  { code: 'VOID-2701839', who: 'Dinesh Abeysekara', item: '1 × Phase 3', qty: 1, amount: 9450, status: 'Refunded', pay: 'Card' },
  { code: 'VOID-2701838', who: 'Nethmi Jayawardena', item: '6 × Phase 3', qty: 6, amount: 56700, status: 'Paid', pay: 'Card' },
  { code: 'VOID-2701837', who: 'Tharaka Bandara', item: 'Table G02 · Gold', qty: 1, amount: 105000, status: 'Split pending', pay: 'Split' },
];
D.splits = [
  { id: 'SP-038', lead: 'Kavindu Rathnayake', item: '4 × Phase 3', size: 4, paid: 2, share: 9450, hours: 31 },
  { id: 'SP-037', lead: 'Tharaka Bandara', item: 'Table G02 · Gold', size: 6, paid: 4, share: 17500, hours: 5 },
  { id: 'SP-036', lead: 'Malsha Peiris', item: '3 × Phase 3', size: 3, paid: 1, share: 9450, hours: 19 },
];
D.koko = [
  { code: 'VOID-2701840', who: 'Ishara Gunawardena', total: 189000, got: 1, status: 'Active' },
  { code: 'VOID-2701822', who: 'Ruwan Senanayake', total: 28350, got: 2, status: 'Active' },
  { code: 'VOID-2701795', who: 'Hiruni De Alwis', total: 18900, got: 3, status: 'Completed' },
];
D.staff = [
  { name: 'Chamara Fonseka', role: 'Gate lead', gate: true, box: true, online: true },
  { name: 'Piumi Herath', role: 'Scanner', gate: true, box: false, online: true },
  { name: 'Lahiru Madushan', role: 'Scanner', gate: true, box: false, online: false },
  { name: 'Anjali Cooray', role: 'Box office', gate: false, box: true, online: true },
];
D.links = [
  { name: 'Instagram launch', ref: 'ig-launch', clicks: 8420, sales: 792 },
  { name: 'WhatsApp community', ref: 'wa-community', clicks: 5120, sales: 534 },
  { name: 'Promoter. Dilini', ref: 'promo-dilini', clicks: 2180, sales: 313 },
];
D.invoices = [
  { no: 'INV-027', to: 'Island Catering Co.', what: 'Catering and bar stock', amount: 640000, issued: '13 Feb 2027', due: 'Due today', status: 'Pending' },
  { no: 'INV-026', to: 'Colombo Sound Works', what: 'Sound and lighting hire', amount: 1850000, issued: '6 Feb 2027', due: '20 Feb 2027', status: 'Pending' },
  { no: 'INV-025', to: 'Lotus Tower Management', what: 'Venue hire, grounds', amount: 2400000, issued: '20 Jan 2027', due: '3 Feb 2027', status: 'Paid' },
];
D.payouts = [
  { code: 'PB-2704', e: 1, amount: 1340000, date: '28 Feb 2027', status: 'Awaiting approval' },
  { code: 'PB-2703', e: 3, amount: 2010000, date: '28 Feb 2027', status: 'Awaiting approval' },
  { code: 'PB-2702', e: 0, amount: 7920000, date: '28 Feb 2027', status: 'Awaiting approval' },
  { code: 'PB-2701', e: 0, amount: 4380000, date: '14 Feb 2027', status: 'Paid', ref: 'COMB-88214' },
  { code: 'PB-2700', e: 0, amount: 3250000, date: '31 Jan 2027', status: 'Paid', ref: 'COMB-87102' },
];
D.users = [
  { name: 'Sanduni Wijesinghe', email: 'sanduni.w@example.com', orders: 3, joined: '4 Jan 2027' },
  { name: 'Kavindu Rathnayake', email: 'kavindu.r@example.com', orders: 2, joined: '9 Jan 2027' },
  { name: 'Ishara Gunawardena', email: 'ishara.g@example.com', orders: 1, joined: '2 Feb 2027' },
  { name: 'Nethmi Jayawardena', email: 'nethmi.j@example.com', orders: 4, joined: '27 Dec 2026' },
];
D.audit = [
  { at: Date.parse('2027-02-19T09:12:00+05:30'), who: 'Super admin', action: 'Approved payout', target: 'PB-2701', result: 'Paid' },
  { at: Date.parse('2027-02-12T14:40:00+05:30'), who: 'Nimal Perera', action: 'Published layout', target: 'VOID 2027 · v3', result: 'Awaiting review' },
  { at: Date.parse('2027-02-08T10:01:00+05:30'), who: 'System', action: 'Opened tier', target: 'VOID 2027 · Phase 3', result: 'On sale' },
  { at: Date.parse('2027-01-20T16:22:00+05:30'), who: 'Super admin', action: 'Approved event', target: 'South Coast Sundown', result: 'Live' },
];
/* Seed layout, in percent of an 80 m by 60 m plan. */
const L = [{ type: 'stage', name: 'Main stage', x: 38, y: 6, w: 24, h: 13 }, { type: 'zone', name: 'GA floor', x: 30, y: 24, w: 40, h: 46, capacity: 2400, tier: 'Phase 3' }, { type: 'gate', name: 'Entry gate', x: 6, y: 78, w: 8, h: 6 }];
for (let i = 0; i < 8; i++) { L.push({ type: 'table', name: 'G0' + (i + 1), x: 10 + (i % 2) * 8, y: 22 + Math.floor(i / 2) * 11, w: 5, h: 6.67, capacity: 6, tier: 'Gold' }); L.push({ type: 'table', name: 'P0' + (i + 1), x: 77 + (i % 2) * 8, y: 22 + Math.floor(i / 2) * 11, w: 5, h: 6.67, capacity: 10, tier: 'Platinum' }); }
for (let i = 0; i < 6; i++) L.push({ type: 'stall', name: 'Food stall ' + (i + 1), x: 32 + i * 6.5, y: 82, w: 5, h: 6.67 });
D.layout = { version: 3, status: 'Draft', objects: L };

const sum = (a) => a.reduce((n, x) => n + x[1], 0);
console.assert(sum(D.weekly) === 1842, 'weekly tickets must total 1,842');
console.assert(sum(D.channels) === 1842, 'channels must total 1,842');
console.assert(V.events[0].sold * 9000 === V.events[0].gross, 'flagship gross must be 16,578,000');
console.assert(V.events.reduce((n, e) => n + e.gross, 0) === 27238000, 'platform gross must be 27,238,000');
})();
