import { RULES } from '@void/shared';
export { RULES };
/** One SMS is 160 GSM characters. The API refuses longer bodies, so this is always 1. */
export const smsTextLength = (s: string) => Math.max(1, Math.ceil(s.length / RULES.smsMaxChars));
