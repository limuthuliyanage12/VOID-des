/* Supplier invoices for one event. Numbers run INV-028 onwards. */
import { colomboDayKey, formatDate } from '@void/shared';
import { Invoice } from '../../db/models/index.js';
import { notFound } from '../../lib/errors.js';
import { audit, nextInvoiceNumber, type Actor } from '../../lib/platform.js';

const view = (i: { number: string; billTo: string; description: string; amountCents: number; issuedAt: Date; dueAt: Date; status: string }) => {
  const today = colomboDayKey(new Date()), due = colomboDayKey(i.dueAt);
  return { number: i.number, billTo: i.billTo, description: i.description, amountCents: i.amountCents, issuedAt: i.issuedAt, issued: formatDate(i.issuedAt), dueAt: i.dueAt, due: i.status !== 'paid' && due === today ? 'Due today' : formatDate(i.dueAt), dueToday: i.status !== 'paid' && due === today, overdue: i.status !== 'paid' && due < today, status: i.status };
};

export const listInvoices = async (eventId: string) => (await Invoice.find({ eventId }).sort({ issuedAt: -1 }).lean()).map(view);

export const createInvoice = async (eventId: string, b: { billTo: string; description: string; amount: number; dueAt: Date; status: 'draft' | 'pending' | 'paid' }, actor: Actor) => {
  const i = await Invoice.create({ eventId, number: await nextInvoiceNumber(), billTo: b.billTo, description: b.description, amountCents: b.amount * 100, issuedAt: new Date(), dueAt: b.dueAt, status: b.status });
  await audit(actor, 'Created invoice', i.number, { eventId, after: { billTo: b.billTo, amountCents: i.amountCents } });
  return view(i);
};

export const getInvoice = async (eventId: string, number: string) => {
  const i = await Invoice.findOne({ eventId, number: number.toUpperCase() }).lean();
  if (!i) throw notFound('Invoice');
  return view(i);
};
