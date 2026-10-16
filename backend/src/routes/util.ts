import type { Request } from 'express';
import { z } from 'zod';
import { HttpError } from '../errors';

export function idParam(req: Request, name = 'id'): number {
  const n = Number(req.params[name]);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(404, 'Not found');
  return n;
}

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? 'Invalid input', 'VALIDATION');
  return r.data;
}
export const nowIso = () => new Date().toISOString();
