/**
 * safeSelect — explicit-arity wrappers around Supabase query builders.
 *
 * Forbids the historical foot-gun `.single()` which throws PGRST116 (a flood
 * of which dominated the May 2026 triage queue) by giving callers three
 * clearly-named alternatives:
 *
 *   maybeOne()  — 0 or 1 row; returns `T | null`, never throws on absence.
 *   requireOne() — exactly 1 row; throws typed `NotFoundError` on absence.
 *   list()      — 0..N rows; returns `T[]`.
 *
 * The ESLint rule `no-supabase-single` enforces that `.single()` is only used
 * via these helpers (or with an explicit `// single-required: <reason>` opt-out
 * for callers that have already asserted existence via a separate constraint).
 */
import { NotFoundError, RpcError } from "@/lib/errors/AppError";

interface PostgrestLike<T> {
  maybeSingle(): Promise<{ data: T | null; error: { message: string; code?: string } | null }>;
  then<TResult1 = { data: T[] | null; error: { message: string; code?: string } | null }>(
    onfulfilled?: ((value: { data: T[] | null; error: { message: string; code?: string } | null }) => TResult1) | null,
  ): Promise<TResult1>;
}

export async function maybeOne<T>(
  builder: PostgrestLike<T>,
  source: string,
): Promise<T | null> {
  const { data, error } = await builder.maybeSingle();
  if (error) throw new RpcError(source, error.message, { pgCode: error.code });
  return data;
}

export async function requireOne<T>(
  builder: PostgrestLike<T>,
  resource: string,
  source: string,
): Promise<T> {
  const { data, error } = await builder.maybeSingle();
  if (error) throw new RpcError(source, error.message, { pgCode: error.code });
  if (!data) throw new NotFoundError(resource);
  return data;
}

export async function list<T>(
  builder: PostgrestLike<T>,
  source: string,
): Promise<T[]> {
  const { data, error } = await builder;
  if (error) throw new RpcError(source, error.message, { pgCode: error.code });
  return data ?? [];
}
