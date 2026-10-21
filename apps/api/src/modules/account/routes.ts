import { Hono } from "hono";
import { ACCOUNT_QUOTA_BYTES, sessionUserId } from "../../config.js";
import { requireAuth, type AuthVariables } from "../auth/middleware.js";
import { getOwnerUsage } from "../documents/quota.js";

const accountRoutes = new Hono<{ Variables: AuthVariables }>();

/**
 * Storage used by the signed-in account, for the dashboard quota panel.
 * Values come from the same aggregation the upload enforcement uses.
 * `quotaBytes: 0` means unlimited.
 */
accountRoutes.get("/account/storage", requireAuth, async (c) => {
  const user = c.get("user");
  const usage = await getOwnerUsage(sessionUserId((user as { id: string }).id));
  c.header("cache-control", "no-store");
  return c.json({
    usedBytes: usage.usedBytes,
    quotaBytes: ACCOUNT_QUOTA_BYTES,
    documentsBytes: usage.documentsBytes,
    attachmentsBytes: usage.attachmentsBytes,
  });
});

export { accountRoutes };
