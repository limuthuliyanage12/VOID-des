/* Structured JSON logs, one line each. Quiet under tests unless LOG_LEVEL asks for more. */
type Level = 'debug' | 'info' | 'warn' | 'error';
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const min = order[(process.env.LOG_LEVEL as Level) || (process.env.VITEST ? 'error' : 'info')] ?? 20;

const write = (level: Level, msg: string, fields?: Record<string, unknown>) => {
  if (order[level] < min) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields }, (_k, v) => (v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v));
  (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(line + '\n');
};

export const log = {
  debug: (m: string, f?: Record<string, unknown>) => write('debug', m, f),
  info: (m: string, f?: Record<string, unknown>) => write('info', m, f),
  warn: (m: string, f?: Record<string, unknown>) => write('warn', m, f),
  error: (m: string, f?: Record<string, unknown>) => write('error', m, f),
};
