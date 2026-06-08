/**
 * Entitlement reads — DB-only (no Stripe SDK), so the MCP auth hot path can
 * import this without pulling Stripe. The Stripe webhook writes the
 * `subscriptions` row; this just reads it to gate access.
 */
import { createServiceClient } from "@/lib/db";

const ACTIVE_STATUSES = new Set(["active", "trialing"]);

/** Open-beta flag: while true, any authenticated OAuth user gets tool access
 *  (so demos/testers aren't locked out). Set MCP_OPEN_BETA=false to enforce
 *  paid-only — then only active subscribers (and static keys) get in. */
export function isOpenBeta(): boolean {
  return process.env.MCP_OPEN_BETA !== "false";
}

export interface Entitlement {
  status: string;
  active: boolean;
  currentPeriodEnd: string | null;
}

export async function getEntitlement(userId: string): Promise<Entitlement> {
  const db = createServiceClient();
  const { data } = await db
    .from("subscriptions")
    .select("status, current_period_end")
    .eq("user_id", userId)
    .maybeSingle();
  const status = data?.status ?? "inactive";
  return { status, active: ACTIVE_STATUSES.has(status), currentPeriodEnd: data?.current_period_end ?? null };
}

/** Whether this user may use the MCP tools right now (paid OR open beta). */
export async function hasToolAccess(userId: string): Promise<boolean> {
  if (isOpenBeta()) return true;
  return (await getEntitlement(userId)).active;
}
