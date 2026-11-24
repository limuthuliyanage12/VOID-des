/* Every job the API and the worker know, and the repeating schedule from the build spec. */
import { defineJob, jobs, type Schedule } from '../lib/jobs.js';
import { Order, type OrderDoc } from '../db/models/index.js';
import { emitInventory, expireHold, sweepHolds } from '../modules/holds/service.js';
import { sendTicketEmail } from '../modules/orders/service.js';
import { chargeback, completePayment } from '../modules/payments/service.js';
import { expireSplit, splitReminder, sweepSplits } from '../modules/split/service.js';
import { notifyRelease } from '../modules/tiers/service.js';
import { preparePayouts, releaseReserve } from '../modules/finance/service.js';
import { alertNewOrder, dailyDigest, kokoSync, scrubPersonalData } from '../modules/users/service.js';
import { Tier } from '../db/models/index.js';
import { tx } from '../db/connect.js';
import { advanceIfFull } from '../modules/tiers/inventory.js';

let done = false;
export const registerJobs = () => {
  if (done) return; done = true;
  defineJob('expireHold', (d) => expireHold(d as { holdId: string }));
  defineJob('expireSplit', (d) => expireSplit(d as { groupId: string }));
  defineJob('splitReminder', (d) => splitReminder(d as { groupId: string; hours: number }));
  defineJob('completePayment', (d) => completePayment(d as { paymentId: string }));
  defineJob('chargeback', (d) => chargeback(d as { paymentId: string }));
  defineJob('notifyRelease', (d) => notifyRelease(d as { eventId: string }));
  defineJob('orderPaid', async (d) => {
    const o = await Order.findById(d.orderId).lean<OrderDoc>();
    if (!o) return;
    await sendTicketEmail(o._id);
    if (o.payMethod !== 'comp') await alertNewOrder(o);
    void emitInventory(o.eventId);
  });
  /* The minute sweep is the safety net for lost timers. */
  defineJob('sweep', async () => ({ holds: await sweepHolds(), splits: await sweepSplits() }));
  /* tierAdvance: opens the next tier if one filled up without a sale passing through advanceIfFull. */
  defineJob('tierAdvance', async () => {
    const full = await Tier.find({ state: 'on sale', $expr: { $gte: ['$sold', '$total'] } }, { _id: 1 }).lean();
    for (const t of full) await tx((s) => advanceIfFull(t._id, s));
  });
  defineJob('kokoSync', () => kokoSync());
  defineJob('dailyDigest', () => dailyDigest());
  defineJob('preparePayouts', () => preparePayouts());
  defineJob('releaseReserve', () => releaseReserve());
  defineJob('scrubPersonalData', () => scrubPersonalData());
};

export const SCHEDULE: Schedule[] = [
  { name: 'sweep', every: 60_000 },
  { name: 'tierAdvance', every: 5 * 60_000 },
  { name: 'kokoSync', every: 60 * 60_000 },
  { name: 'dailyDigest', dailyAt: [8, 0] },
  { name: 'preparePayouts', dailyAt: [9, 0] },
  { name: 'releaseReserve', dailyAt: [9, 30] },
  { name: 'scrubPersonalData', dailyAt: [3, 0] },
];

export const startSchedule = () => jobs.schedule(SCHEDULE);
