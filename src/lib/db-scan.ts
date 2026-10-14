/**
 * Bounded, index-driven read helpers for the big tables (episodes 34K,
 * classifications / sentiment_scores 250K+, growing ~2K/day).
 *
 * Every shape that scans one of the big tables in id order with a deep join
 * has eventually failed on this database: OFFSET pages crossed the statement
 * timeout (the June-August 2026 snapshot freeze), a `!left` + `is.null`
 * anti-join and a created_at keyset without an index both timed out, and the
 * keyset-on-uuid deep join behind the home snapshot went from 70s to 145s with
 * intermittent timeouts the moment the Index window was refilled
 * (2026-10-14). What stays fast is a traversal that only ever touches small
 * id sets through existing indexes: episodes by published_at, then child rows
 * by episode_id, then grandchild rows by their unique FK, each in chunks.
 * These helpers are that traversal's building blocks; pipeline.ts's pending
 * lookups (v0.39.1) and aggregate.ts's score scan (v0.40.1) are built on the
 * same idea.
 */
import { createServiceClient } from "./db";
import { mapPool } from "./concurrency";

type Db = ReturnType<typeof createServiceClient>;

/** PostgREST caps any single response at this many rows (Supabase "Max
 *  Rows"); `.limit()` above it silently truncates. Chunked reads treat a full
 *  page as "possibly truncated" and split the chunk. */
export const POSTGREST_MAX_ROWS = 1000;
const DEFAULT_CONCURRENCY = 4;

export function chunked<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Episodes published since `sinceIso`, keyset-paginated on the PK with the
 * date window pushed into SQL (the published_at index drives it). Throws on
 * page overflow instead of returning a truncated window.
 */
export async function episodesSince<T extends { id: string }>(
  db: Db,
  sinceIso: string,
  select: string,
  what: string,
  maxPages = 100,
): Promise<T[]> {
  const rows: T[] = [];
  let lastId: string | null = null;
  for (let page = 0; ; page++) {
    if (page >= maxPages) {
      throw new Error(`${what}: exceeded ${maxPages} episode pages (${rows.length} rows)`);
    }
    let q = db
      .from("episodes")
      .select(select)
      .gte("published_at", sinceIso)
      .order("id", { ascending: true })
      .limit(POSTGREST_MAX_ROWS);
    if (lastId !== null) q = q.gt("id", lastId);
    const { data, error } = await q;
    if (error) throw new Error(`${what}: episodes: ${error.message}`);
    if (!data || data.length === 0) break;
    const page_ = data as unknown as T[];
    lastId = String(page_[page_.length - 1].id);
    rows.push(...page_);
  }
  return rows;
}

/**
 * Rows of `table` whose `keyColumn` is in `keys`, read in chunks through the
 * column's index with bounded concurrency. A chunk that comes back full may
 * have been truncated at POSTGREST_MAX_ROWS, so it is split and re-read; a
 * single key with a full page throws rather than silently dropping rows.
 */
export async function selectByKeys<T>(
  db: Db,
  table: string,
  select: string,
  keyColumn: string,
  keys: readonly string[],
  opts: { chunk: number; what: string; concurrency?: number },
): Promise<T[]> {
  const readChunk = async (chunk: string[]): Promise<T[]> => {
    const { data, error } = await db
      .from(table)
      .select(select)
      .in(keyColumn, chunk)
      .limit(POSTGREST_MAX_ROWS);
    if (error) throw new Error(`${opts.what}: ${table} by ${keyColumn}: ${error.message}`);
    const rows = (data || []) as unknown as T[];
    if (rows.length < POSTGREST_MAX_ROWS) return rows;
    if (chunk.length === 1) {
      throw new Error(
        `${opts.what}: ${table}.${keyColumn}=${chunk[0]} has >= ${POSTGREST_MAX_ROWS} rows`,
      );
    }
    const mid = Math.ceil(chunk.length / 2);
    const [a, b] = await Promise.all([readChunk(chunk.slice(0, mid)), readChunk(chunk.slice(mid))]);
    return [...a, ...b];
  };

  const chunks = chunked(keys, opts.chunk);
  const perChunk: T[][] = chunks.map(() => []);
  await mapPool(chunks, opts.concurrency ?? DEFAULT_CONCURRENCY, async (chunk, i) => {
    perChunk[i] = await readChunk(chunk);
  });
  return perChunk.flat();
}
