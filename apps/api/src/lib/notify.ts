/*
 * Email and SMS behind one interface. Drivers: 'log' (development: prints and keeps an outbox you can read at /api/v1/dev/outbox),
 * Resend for email, Notify.lk for SMS. SMS always stays under 160 characters.
 */
import { formatDate, formatLKR, formatTime, RULES } from '@void/shared';
import { env } from '../config/env.js';
import { log } from './log.js';

export interface Mail { to: string; subject: string; text: string; html?: string; attachments?: { filename: string; content: Buffer; contentType: string }[]; tag?: string }
export interface Sms { to: string; body: string; tag?: string }
export interface OutboxItem { channel: 'email' | 'sms'; to: string; subject?: string; text: string; tag?: string; at: string; attachments?: string[] }

const outbox: OutboxItem[] = [];
export const readOutbox = (limit = 50) => outbox.slice(-limit).reverse();
export const clearOutbox = () => { outbox.length = 0; };

const keep = (item: OutboxItem) => { outbox.push(item); if (outbox.length > 500) outbox.shift(); };

export const sendEmail = async (m: Mail): Promise<{ ok: boolean; id?: string }> => {
  keep({ channel: 'email', to: m.to, subject: m.subject, text: m.text, tag: m.tag, at: new Date().toISOString(), attachments: m.attachments?.map((a) => a.filename) });
  if (env.mail.driver !== 'resend' || !env.mail.resendKey) { log.info('email (log driver)', { to: m.to, subject: m.subject, tag: m.tag }); return { ok: true, id: 'log' }; }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST', signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${env.mail.resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.mail.from, to: [m.to], subject: m.subject, text: m.text, html: m.html, attachments: m.attachments?.map((a) => ({ filename: a.filename, content: a.content.toString('base64') })) }),
    });
    const out = (await res.json()) as { id?: string };
    return { ok: res.ok, id: out.id };
  } catch (e) { log.error('email failed', { to: m.to, error: e }); return { ok: false }; }
};

export const smsText = (s: string) => (s.length <= RULES.smsMaxChars ? s : s.slice(0, RULES.smsMaxChars - 1) + '…');

export const sendSms = async (s: Sms): Promise<{ ok: boolean }> => {
  const body = smsText(s.body);
  keep({ channel: 'sms', to: s.to, text: body, tag: s.tag, at: new Date().toISOString() });
  if (env.sms.driver !== 'notifylk' || !env.sms.notifyApiKey) { log.info('sms (log driver)', { to: s.to, tag: s.tag }); return { ok: true }; }
  const to = s.to.replace(/\D/g, '').replace(/^0/, '94');
  try {
    const q = new URLSearchParams({ user_id: env.sms.notifyUserId, api_key: env.sms.notifyApiKey, sender_id: env.sms.senderId, to, message: body });
    const res = await fetch(`https://app.notify.lk/api/v1/send?${q}`, { signal: AbortSignal.timeout(10_000) });
    return { ok: res.ok };
  } catch (e) { log.error('sms failed', { error: e }); return { ok: false }; }
};

/* ---------- Templates. Plain, warm British English, LKR with no decimals. ---------- */
const web = (p: string) => `${env.webOrigin}/${p.replace(/^\//, '')}`;
const foot = '\n\nVOID · Events by the Void\nhello@eventsbythevoid.lk · Monday to Friday, 9 am to 5 pm, Asia/Colombo';

export const templates = {
  ticket: (o: { name: string; event: string; startsAt: Date; gatesAt: Date; venue: string; line: string; code: string; totalCents: number; viewUrl: string }) => ({
    subject: `Your tickets for ${o.event}`,
    text: `Hi ${o.name.split(' ')[0]},\n\nYou're on the list. See you out of the dark.\n\n${o.event}\n${formatDate(o.startsAt, true)} · Gates ${formatTime(o.gatesAt)}\n${o.venue}\n${o.line}\nOrder ${o.code} · ${formatLKR(o.totalCents)}\n\nYour ticket is attached as a PDF and waits in My Tickets: ${o.viewUrl}${foot}`,
    sms: `VOID: You're in for ${o.event}, ${formatDate(o.startsAt)}. Order ${o.code}. Your QR is in My Tickets.`,
  }),
  splitInvite: (o: { lead: string; event: string; startsAt: Date; shareCents: number; link: string; expiresAt: Date | null }) => ({
    subject: `${o.lead} split the bill for ${o.event}`,
    text: `${o.lead} booked ${o.event} on ${formatDate(o.startsAt)} and split the bill with you.\n\nYour share is ${formatLKR(o.shareCents)}. Pay it here: ${o.link}\n\n${o.expiresAt ? `The group has until ${formatDate(o.expiresAt)}, ${formatTime(o.expiresAt)} Colombo time. ` : ''}If everyone hasn't paid within 48 hours, the booking is released and paid shares are refunded.${foot}`,
  }),
  splitReminder: (o: { event: string; shareCents: number; link: string; hoursLeft: number }) => ({
    subject: `${o.hoursLeft} hours left to pay your share for ${o.event}`,
    text: `There are about ${o.hoursLeft} hours left to pay your share of ${formatLKR(o.shareCents)} for ${o.event}.\n\nPay here: ${o.link}\n\nIf the group doesn't finish in time, the booking is released and paid shares are refunded.${foot}`,
  }),
  splitReleased: (o: { event: string; refundedCents: number }) => ({
    subject: `Your group booking for ${o.event} was released`,
    text: `Not everyone in the group paid within the time limit, so the booking for ${o.event} has been released.${o.refundedCents ? ` Your share of ${formatLKR(o.refundedCents)} is on its way back to the way you paid.` : ''}${foot}`,
  }),
  refund: (o: { event: string; amountCents: number; code: string }) => ({
    subject: `Refund for ${o.event}`,
    text: `We have refunded ${formatLKR(o.amountCents)} for order ${o.code} to the way you paid. The refunded tickets no longer work at the gate.${foot}`,
  }),
  transfer: (o: { from: string; to: string; event: string; link: string }) => ({
    subject: `${o.from} sent you a ticket for ${o.event}`,
    text: `Hi ${o.to.split(' ')[0]},\n\n${o.from} has transferred a ticket for ${o.event} to you. Accept it here: ${o.link}\n\nOnce you accept, the ticket is in your name and the old QR stops working.${foot}`,
  }),
  notifyRelease: (o: { event: string; link: string }) => ({
    subject: `${o.event}: tickets are open`,
    text: `You asked us to tell you once about ${o.event}. Tickets are open now: ${o.link}\n\nWe won't email you about this event again.${foot}`,
  }),
  organizerAlert: (o: { event: string; line: string }) => ({ subject: `${o.event}: ${o.line}`, text: `${o.line}\n\nOpen the organizer console: ${web('admin.html')}${foot}` }),
  digest: (o: { event: string; sold: number; capacity: number; ordersYesterday: number; grossCents: number; splitsExpiring: number }) => ({
    subject: `${o.event} · daily digest`,
    text: `Good morning.\n\n${o.sold.toLocaleString('en-US')} of ${o.capacity.toLocaleString('en-US')} sold. ${o.ordersYesterday} orders yesterday. Gross ${formatLKR(o.grossCents)}.\n${o.splitsExpiring} split groups expire in the next 6 hours.\n\n${web('admin.html')}${foot}`,
  }),
  campaign: (o: { subject: string; body: string; unsubscribeUrl: string }) => ({ subject: o.subject, text: `${o.body}\n\nUnsubscribe: ${o.unsubscribeUrl}${foot}` }),
};
