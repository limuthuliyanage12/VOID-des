/* The prototype's sample data (shared.js, console-data.js, venue3d.js), renamed to VOID. */

export const EVENTS = [
  { id: 0, name: 'VOID 2027', slug: 'void-2027', date: '2027-02-27', venue: 'Lotus Tower', city: 'Colombo', from: 9000, genre: 'Electronic', status: 'Selling fast', organizer: 'Nimal Perera', sold: 1842, gross: 16_578_000, art: 'colombo-night', cap: 2400, region: 'Colombo' },
  { id: 1, name: 'After Hours. Warehouse', slug: 'after-hours-warehouse', date: '2027-03-06', venue: 'Trace Expert City', city: 'Colombo', from: 4500, genre: 'Electronic', status: 'On sale', organizer: 'Dilini Fernando', sold: 630, gross: 2_835_000, art: 'dj-booth', cap: 1200, region: 'Colombo' },
  { id: 2, name: 'The Sunday Sessions', slug: 'the-sunday-sessions', date: '2027-03-14', venue: 'Viharamahadevi Park', city: 'Colombo', from: 2500, genre: 'Live music', status: 'On sale', organizer: 'Kasun Silva', sold: 450, gross: 1_125_000, art: 'viharamahadevi-park', cap: 1000, region: 'Colombo' },
  { id: 3, name: 'South Coast Sundown', slug: 'south-coast-sundown', date: '2027-03-20', venue: 'The Bay', city: 'Mirissa', from: 6000, genre: 'Electronic', status: 'Selling fast', organizer: 'Amaya Dias', sold: 710, gross: 4_260_000, art: 'mirissa', cap: 900, region: 'South coast' },
  { id: 4, name: 'Colombo Jazz Collective', slug: 'colombo-jazz-collective', date: '2027-03-26', venue: 'Park Street Mews', city: 'Colombo', from: 3500, genre: 'Jazz', status: 'On sale', organizer: 'Ravindu Jayasuriya', sold: 240, gross: 840_000, art: 'live-band', cap: 600, region: 'Colombo' },
  { id: 5, name: 'Hill Country Unplugged', slug: 'hill-country-unplugged', date: '2027-04-10', venue: 'Lake Club', city: 'Kandy', from: 4000, genre: 'Live music', status: 'Sold out', organizer: 'Shanika Mendis', sold: 400, gross: 1_600_000, art: 'kandy-lake', cap: 400, region: 'Hill country' },
  { id: 6, name: 'Island Frequencies', slug: 'island-frequencies', date: '2027-04-24', venue: 'Havelock City', city: 'Colombo', from: 5000, genre: 'Electronic', status: 'Registering interest', organizer: 'Tharindu Peiris', sold: 0, gross: 0, art: 'festival-stage', cap: 1800, region: 'Colombo' },
  { id: 7, name: 'Galle Fort Afterglow', slug: 'galle-fort-afterglow', date: '2027-05-08', venue: 'Dutch Hospital', city: 'Galle', from: 5500, genre: 'Live music', status: 'Registering interest', organizer: null, sold: 0, gross: 0, art: 'galle-fort', cap: 700, region: 'South coast' },
] as const;

export const VENUES = [
  { name: 'Lotus Tower', city: 'Colombo', capacity: 2400, region: 'Colombo', modelStatus: 'ready' },
  { name: 'Trace Expert City', city: 'Colombo', capacity: 1200, region: 'Colombo', modelStatus: 'none' },
  { name: 'The Bay', city: 'Mirissa', capacity: 900, region: 'South coast', modelStatus: 'none' },
  { name: 'Havelock City', city: 'Colombo', capacity: 1800, region: 'Colombo', modelStatus: 'in review' },
  { name: 'Viharamahadevi Park', city: 'Colombo', capacity: 1000, region: 'Colombo', modelStatus: 'none' },
  { name: 'Park Street Mews', city: 'Colombo', capacity: 600, region: 'Colombo', modelStatus: 'none' },
  { name: 'Lake Club', city: 'Kandy', capacity: 400, region: 'Hill country', modelStatus: 'none' },
  { name: 'Dutch Hospital', city: 'Galle', capacity: 700, region: 'South coast', modelStatus: 'none' },
] as const;

/* Price tiers for the flagship. Other events scale price by their own from price over 9,000. */
export const BASE_TIERS: [string, number, number][] = [['Early Bird', 3500, 300], ['Phase 1', 5000, 500], ['Phase 2', 7000, 800], ['Phase 3', 9000, 400], ['Gate', 12000, 200]];
export const FLAGSHIP_PHASE3_SOLD = 242;

export const WEEKLY: [string, number, string?][] = [['1 Jan', 300], ['8 Jan', 262], ['15 Jan', 238, 'Phase 1 sold out'], ['22 Jan', 270], ['29 Jan', 265], ['5 Feb', 265, 'Phase 3 opened'], ['12 Feb', 142], ['19 Feb', 100]];
export const CHANNELS: [string, number][] = [['Instagram', 792], ['WhatsApp', 534], ['Promoter links', 313], ['Direct', 203]];
export const PAID: [string, number][] = [['Card', 12_810_000], ['Koko', 2_840_000], ['Split pay', 940_000]];

export const FANS = [
  { name: 'Sanduni Wijesinghe', email: 'sanduni.w@example.com', joined: '2027-01-04' },
  { name: 'Kavindu Rathnayake', email: 'kavindu.r@example.com', joined: '2027-01-09' },
  { name: 'Ishara Gunawardena', email: 'ishara.g@example.com', joined: '2027-02-02' },
  { name: 'Nethmi Jayawardena', email: 'nethmi.j@example.com', joined: '2026-12-27' },
];

export const STAFF = [
  { name: 'Chamara Fonseka', role: 'gate lead', gate: true, box: true, online: true, mobile: '0771234501' },
  { name: 'Piumi Herath', role: 'scanner', gate: true, box: false, online: true, mobile: '0771234502' },
  { name: 'Lahiru Madushan', role: 'scanner', gate: true, box: false, online: false, mobile: '0771234503' },
  { name: 'Anjali Cooray', role: 'box office', gate: false, box: true, online: true, mobile: '0771234504' },
] as const;

export const LINKS = [{ name: 'Instagram launch', ref: 'ig-launch', clicks: 8420, sales: 792 }, { name: 'WhatsApp community', ref: 'wa-community', clicks: 5120, sales: 534 }, { name: 'Promoter. Dilini', ref: 'promo-dilini', clicks: 2180, sales: 313 }];

export const INVOICES = [
  { number: 'INV-027', billTo: 'Island Catering Co.', description: 'Catering and bar stock', amount: 640_000, issued: '2027-02-13', due: 'today', status: 'pending' },
  { number: 'INV-026', billTo: 'Colombo Sound Works', description: 'Sound and lighting hire', amount: 1_850_000, issued: '2027-02-06', due: '2027-02-20', status: 'pending' },
  { number: 'INV-025', billTo: 'Lotus Tower Management', description: 'Venue hire, grounds', amount: 2_400_000, issued: '2027-01-20', due: '2027-02-03', status: 'paid' },
] as const;

export const PAYOUTS = [
  { code: 'PB-2704', e: 1, amount: 1_340_000, date: '2027-02-28', status: 'awaiting approval' },
  { code: 'PB-2703', e: 3, amount: 2_010_000, date: '2027-02-28', status: 'awaiting approval' },
  { code: 'PB-2702', e: 0, amount: 7_920_000, date: '2027-02-28', status: 'awaiting approval' },
  { code: 'PB-2701', e: 0, amount: 4_380_000, date: '2027-02-14', status: 'paid', ref: 'COMB-88214' },
  { code: 'PB-2700', e: 0, amount: 3_250_000, date: '2027-01-31', status: 'paid', ref: 'COMB-87102' },
] as const;

export const AUDIT = [
  { at: '2027-02-19T09:12:00+05:30', who: 'Super admin', action: 'Approved payout', target: 'PB-2701', result: 'Paid' },
  { at: '2027-02-12T14:40:00+05:30', who: 'Nimal Perera', action: 'Published layout', target: 'VOID 2027 · v3', result: 'Awaiting review' },
  { at: '2027-02-08T10:01:00+05:30', who: 'System', action: 'Opened tier', target: 'VOID 2027 · Phase 3', result: 'On sale' },
  { at: '2027-01-20T16:22:00+05:30', who: 'Super admin', action: 'Approved event', target: 'South Coast Sundown', result: 'Live' },
];

/* Seed layout, in percent of an 80 m by 60 m plan. */
export const layoutObjects = () => {
  const L: { type: string; name: string; x: number; y: number; w: number; h: number; capacity?: number; tier?: string }[] = [
    { type: 'stage', name: 'Main stage', x: 38, y: 6, w: 24, h: 13 }, { type: 'zone', name: 'GA floor', x: 30, y: 24, w: 40, h: 46, capacity: 2400, tier: 'Phase 3' }, { type: 'gate', name: 'Entry gate', x: 6, y: 78, w: 8, h: 6 },
  ];
  for (let i = 0; i < 8; i++) {
    L.push({ type: 'table', name: 'G0' + (i + 1), x: 10 + (i % 2) * 8, y: 22 + Math.floor(i / 2) * 11, w: 5, h: 6.67, capacity: 6, tier: 'Gold' });
    L.push({ type: 'table', name: 'P0' + (i + 1), x: 77 + (i % 2) * 8, y: 22 + Math.floor(i / 2) * 11, w: 5, h: 6.67, capacity: 10, tier: 'Platinum' });
  }
  for (let i = 0; i < 6; i++) L.push({ type: 'stall', name: 'Food stall ' + (i + 1), x: 32 + i * 6.5, y: 82, w: 5, h: 6.67 });
  return L;
};

/* Lotus Tower grounds: the 18 main points of interest plus 8 stalls and 5 counters, from venue3d.js. */
const MAIN = [
  { id: 'stage', name: 'Main stage', dims: '18 m wide · DJ booth · 6 light rigs', desc: 'The centre of the night. Speaker stacks on both sides, a truss overhead and the floor ring right in front.', x: 0, z: -9, r: 7, view: [0, 34] },
  { id: 'backstage', name: 'Backstage', dims: 'Crew and artists only', desc: 'Green room, production, security, crew and artist rooms behind the stage wall. Not open to ticket holders.', x: 0, z: -24, r: 5 },
  { id: 'gold', name: 'VIP deck Gold', dims: '8 tables · LKR 100,000 each', desc: 'A raised deck on the west side with a clear view of the stage. Each table seats up to 6 and has its own VIP entrance.', x: -15, z: 0, r: 7, view: [0.9, 30] },
  { id: 'platinum', name: 'VIP deck Platinum', dims: '8 tables · LKR 180,000 each', desc: 'The lake-side deck beside the stage. Each table seats up to 10 and comes with a table host.', x: 15, z: 0, r: 7, view: [-0.9, 30] },
  { id: 'bar', name: '360 Bar', dims: 'Round bar · middle of the floor', desc: 'Order from any side. The glowing ring on top makes it easy to find from anywhere on the floor.', x: 0, z: 12, r: 5, view: [0.5, 24] },
  { id: 'desk', name: 'Sound desk', dims: 'Front of house', desc: 'Where the sound and lights are mixed. Fenced on four sides, and the best spot to hear the room.', x: 0, z: 22, r: 4 },
  { id: 'food', name: 'Food stalls', dims: '8 stalls · lakeside row', desc: 'Energy, juice, food, veggie, bar and water along the lake, with first aid and the help desk at the end.', x: 27, z: 4, r: 6, view: [-1.2, 32] },
  { id: 'aid', name: 'First aid and help desk', dims: 'Lakeside row, south end', desc: 'Trained first aiders all night, and a help desk for lost items, tickets and anything else.', x: 27, z: 19, r: 3.5 },
  { id: 'rest', name: 'Restrooms', dims: '2 blocks · M and W', desc: 'Two blocks at the south end of the grounds, a short walk from the bar.', x: 1, z: 41, r: 6, view: [0.2, 30] },
  { id: 'check', name: 'Ticket check', dims: '2 lanes', desc: 'Have your QR ready. One scan admits a whole party pass.', x: -27, z: 26, r: 3.5 },
  { id: 'walk', name: 'Entry walkway', dims: 'Gate 02 to ticket check', desc: 'A lit path from Lotus Road straight to the ticket check and the ENTRY arch.', x: -35, z: 26, r: 3.5, view: [1.3, 30] },
  { id: 'box', name: 'Box office and merch', dims: '5 counters', desc: 'Collect tickets, buy at the gate, get help, check in for VIP or pick up merch.', x: -28, z: 35, r: 5 },
  { id: 'gate1', name: 'Gate 01', dims: 'Lotus Road · north', desc: 'The north gate on Lotus Road, used for exit and for VIP drop-off.', x: -41, z: -6, r: 3.5 },
  { id: 'gate2', name: 'Gate 02', dims: 'Lotus Road · main entry', desc: 'The main way in. Gates open at 4 pm.', x: -41, z: 26, r: 3.5 },
  { id: 'amb', name: 'Ambulance bay', dims: '3 ambulances · covered', desc: 'Three ambulances on standby under cover for the whole event.', x: 22, z: 40, r: 5 },
  { id: 'fire', name: 'Fire tender', dims: 'North-west corner', desc: 'A fire tender and crew stationed on site.', x: -34, z: -24, r: 4 },
  { id: 'tower', name: 'Lotus Tower', dims: '350 m tall · Nelum Kuluna', desc: 'The tallest tower in South Asia, glowing just north of the stage.', x: 0, z: -40, r: 9, view: [0, 70] },
  { id: 'lake', name: 'Beira Lake', dims: 'East edge', desc: 'The lake runs along the east side, behind the food stalls and the Platinum deck.', x: 40, z: 6, r: 8 },
];
const STALLS = ['Energy', 'Juice', 'Food', 'Veggie', 'Bar', 'Water', 'First aid', 'Help desk'];
const COUNTERS = ['Collect', 'At gate', 'Help', 'VIP entry', 'Merch'];
export const LOTUS_POIS = [
  ...MAIN.map((p) => ({ ...p, small: false })),
  ...STALLS.map((n, i) => ({ id: 's' + i, name: n + (i < 6 ? ' stall' : ''), dims: 'Lakeside row', desc: `${n}, stall ${i + 1} of 8 on the lakeside row.`, x: 24.6, z: -10 + i * 4.2, r: 1.6, small: true })),
  ...COUNTERS.map((n, i) => ({ id: 'c' + i, name: n + ' counter', dims: 'Box office', desc: `${n} counter, ${i + 1} of 5 by the entry.`, x: -36 + i * 4, z: 32.4, r: 1.5, small: true })),
];

export const TRACKS = [{ title: 'Lotus Road', length: '6:12' }, { title: 'Beira After Dark', length: '5:48' }, { title: 'Gates at Four', length: '7:03' }];
export const DEMO_PASSWORD = 'Void-demo-2027';
