/* Seed check: asserts the sums the frontend shows, the way the prototype's console-data.js does. */
import { Campaign, Event, Layout, PresaleCode, SplitGroup, SplitShare, Table, Tier } from '../db/models/index.js';
import { leftOf } from '../modules/tiers/inventory.js';
import { CHANNELS, WEEKLY } from './data.js';

export interface Check { name: string; ok: boolean; got: unknown; want: unknown }

export const seedCheck = async (): Promise<Check[]> => {
  const out: Check[] = [];
  const is = (name: string, got: unknown, want: unknown) => out.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
  const flag = await Event.findOne({ slug: 'void-2027' }).lean();
  if (!flag) return [{ name: 'flagship exists', ok: false, got: null, want: 'VOID 2027' }];
  const tiers = await Tier.find({ eventId: flag._id }).sort({ order: 1 }).lean();
  const all = await Event.find().lean();

  is('8 events', all.length, 8);
  is('flagship tickets sold', flag.stats.sold, 1842);
  is('flagship gross LKR', flag.stats.grossCents / 100, 16_578_000);
  is('flagship gross = sold × 9,000', flag.stats.sold * 9000, flag.stats.grossCents / 100);
  is('flagship orders', flag.stats.orders, 962);
  is('tier sold adds up to 1,842', tiers.reduce((n, t) => n + t.sold, 0), 1842);
  is('tier ladder', tiers.map((t) => [t.name, t.priceCents / 100, t.total, t.state]), [['Early Bird', 3500, 300, 'sold out'], ['Phase 1', 5000, 500, 'sold out'], ['Phase 2', 7000, 800, 'sold out'], ['Phase 3', 9000, 400, 'on sale'], ['Gate', 12000, 200, 'up next']]);
  is('Phase 3 left', leftOf(tiers[3]), 158);
  is('weekly tickets total 1,842', WEEKLY.reduce((n, w) => n + w[1], 0), 1842);
  is('channels total 1,842', CHANNELS.reduce((n, c) => n + c[1], 0), 1842);
  is('baseline weekly stored', flag.baseline.weekly.reduce((n, w) => n + (w.tickets ?? 0), 0), 1842);
  is('platform gross LKR', all.reduce((n, e) => n + e.stats.grossCents, 0) / 100, 27_238_000);
  const p = await PresaleCode.findOne({ eventId: flag._id, code: 'VOIDFRIENDS' }).lean();
  is('presale VOIDFRIENDS', p && [p.priceCents / 100, p.used, p.limit], [7500, 32, 100]);
  const tables = await Table.find({ eventId: flag._id }).lean();
  const by = (s: string) => tables.filter((t) => t.status === s).map((t) => t.code).sort();
  is('16 tables', tables.length, 16);
  is('reserved tables', by('reserved'), ['G03', 'P02', 'P06']);
  is('held tables', by('held'), ['G06', 'P05']);
  is('Gold free of 8', tables.filter((t) => t.tier === 'gold' && t.status === 'available').length, 6);
  is('Platinum free of 8', tables.filter((t) => t.tier === 'platinum' && t.status === 'available').length, 5);
  is('one live layout', await Layout.countDocuments({ eventId: flag._id, live: true }), 1);
  const groups = await SplitGroup.find().sort({ code: 1 }).lean();
  const paid = await Promise.all(groups.map((g) => SplitShare.countDocuments({ groupId: g._id, status: 'paid' })));
  is('split groups', groups.map((g, i) => [g.code, g.size, paid[i], g.shareCents / 100]), [['SP-036', 3, 1, 9450], ['SP-037', 6, 4, 17500], ['SP-038', 4, 2, 9450]]);
  is('campaign clicks', (await Campaign.find().sort({ clicks: -1 }).lean()).map((c) => [c.ref, c.clicks, c.sales]), [['ig-launch', 8420, 792], ['wa-community', 5120, 534], ['promo-dilini', 2180, 313]]);
  return out;
};
