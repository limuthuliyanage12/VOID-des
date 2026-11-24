/*
 * Jobs run on BullMQ when REDIS_URL is set (the worker app processes them), or in-process otherwise.
 * Delayed jobs give exact timing; a sweep every minute is the safety net if a process restarts and loses a timer.
 * Every handler must be safe to run twice.
 */
import { nextColomboTime } from '@void/shared';
import { env } from '../config/env.js';
import { log } from './log.js';

export type JobHandler = (data: Record<string, unknown>) => Promise<unknown>;
export type Schedule = { name: string; every: number } | { name: string; dailyAt: [number, number] };
export interface AddOpts { delay?: number; jobId?: string }

const handlers = new Map<string, JobHandler>();
export const defineJob = (name: string, fn: JobHandler) => { handlers.set(name, fn); };
export const jobNames = () => [...handlers.keys()];

const run = async (name: string, data: Record<string, unknown>) => {
  const fn = handlers.get(name);
  if (!fn) throw new Error(`No handler for job ${name}`);
  return fn(data);
};

interface Driver {
  add(name: string, data: Record<string, unknown>, o?: AddOpts): Promise<void>;
  remove(jobId: string): Promise<void>;
  schedule(s: Schedule[]): Promise<void>;
  close(): Promise<void>;
}

/* ---------- In-process ---------- */
class InlineDriver implements Driver {
  timers = new Map<string, NodeJS.Timeout>();
  repeats: NodeJS.Timeout[] = [];
  pending = new Set<Promise<void>>();
  private exec(name: string, data: Record<string, unknown>, attempt = 1) {
    const p: Promise<void> = run(name, data).then(() => undefined, (e) => {
      log.error('job failed', { job: name, attempt, error: e });
      if (attempt < 3 && !env.isTest) { const t = setTimeout(() => this.exec(name, data, attempt + 1), attempt * 2000); t.unref(); }
    }).finally(() => { this.pending.delete(p); });
    this.pending.add(p);
  }
  async add(name: string, data: Record<string, unknown>, o: AddOpts = {}) {
    if (o.jobId) await this.remove(o.jobId);
    const delay = Math.max(0, o.delay ?? 0);
    if (delay === 0) { setImmediate(() => this.exec(name, data)); return; }
    const t = setTimeout(() => { if (o.jobId) this.timers.delete(o.jobId); this.exec(name, data); }, Math.min(delay, 2 ** 31 - 1));
    t.unref();
    if (o.jobId) this.timers.set(o.jobId, t);
  }
  async remove(jobId: string) { const t = this.timers.get(jobId); if (t) { clearTimeout(t); this.timers.delete(jobId); } }
  async schedule(list: Schedule[]) {
    for (const s of list) {
      if ('every' in s) { const t = setInterval(() => this.exec(s.name, {}), s.every); t.unref(); this.repeats.push(t); continue; }
      const arm = () => {
        const at = nextColomboTime(s.dailyAt[0], s.dailyAt[1]);
        const t = setTimeout(() => { this.exec(s.name, {}); arm(); }, at.getTime() - Date.now());
        t.unref(); this.repeats.push(t);
      };
      arm();
    }
  }
  async flush() {
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setImmediate(r));
      if (!this.pending.size) { await new Promise((r) => setImmediate(r)); if (!this.pending.size) return; }
      await Promise.allSettled([...this.pending]);
    }
  }
  async close() { this.timers.forEach(clearTimeout); this.timers.clear(); this.repeats.forEach((t) => clearTimeout(t)); this.repeats = []; await this.flush(); }
}

/* ---------- BullMQ ---------- */
class BullDriver implements Driver {
  private queue: import('bullmq').Queue | null = null;
  private worker: import('bullmq').Worker | null = null;
  private async q() {
    if (this.queue) return this.queue;
    const { Queue } = await import('bullmq');
    this.queue = new Queue('void', { connection: { url: env.redisUrl }, defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 1000, removeOnFail: 5000 } });
    return this.queue;
  }
  async add(name: string, data: Record<string, unknown>, o: AddOpts = {}) {
    const q = await this.q();
    if (o.jobId) await this.remove(o.jobId);
    await q.add(name, data, { delay: o.delay, jobId: o.jobId });
  }
  async remove(jobId: string) { const job = await (await this.q()).getJob(jobId); await job?.remove().catch(() => undefined); }
  async schedule(list: Schedule[]) {
    const q = await this.q();
    for (const s of list) {
      const repeat = 'every' in s ? { every: s.every } : { pattern: `${s.dailyAt[1]} ${s.dailyAt[0]} * * *`, tz: 'Asia/Colombo' };
      await q.upsertJobScheduler(s.name, repeat, { name: s.name, data: {} });
    }
  }
  async startWorker(concurrency = 8) {
    const { Worker } = await import('bullmq');
    this.worker = new Worker('void', async (job) => run(job.name, job.data), { connection: { url: env.redisUrl }, concurrency });
    this.worker.on('failed', (job, e) => log.error('job failed', { job: job?.name, id: job?.id, attempts: job?.attemptsMade, error: e }));
    log.info('bullmq worker started', { concurrency });
  }
  async close() { await this.worker?.close(); await this.queue?.close(); }
}

export const usingRedis = () => !!env.redisUrl && !env.isTest;
const driver: Driver = usingRedis() ? new BullDriver() : new InlineDriver();

export const jobs = {
  add: (name: string, data: Record<string, unknown> = {}, o?: AddOpts) => driver.add(name, data, o),
  /** Runs at a given time. Re-adding the same jobId replaces the earlier one. */
  at: (name: string, when: Date, data: Record<string, unknown>, jobId: string) => driver.add(name, data, { delay: when.getTime() - Date.now(), jobId }),
  remove: (jobId: string) => driver.remove(jobId),
  schedule: (s: Schedule[]) => driver.schedule(s),
  close: () => driver.close(),
  /** Runs a job now and waits for it. Tests and the dev tools use this. */
  runNow: (name: string, data: Record<string, unknown> = {}) => run(name, data),
  /** Waits for in-process jobs to finish. A no-op on BullMQ. */
  flush: async () => { if (driver instanceof InlineDriver) await driver.flush(); },
  startWorker: async (concurrency?: number) => { if (driver instanceof BullDriver) await driver.startWorker(concurrency); },
  inline: () => driver instanceof InlineDriver,
};
