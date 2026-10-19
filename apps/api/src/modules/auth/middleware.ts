import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { auth } from "./auth.js";

type SessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

export type AuthUser = NonNullable<SessionResult>["user"];
export type AuthSession = NonNullable<SessionResult>["session"];

export type AuthVariables = {
  user: AuthUser | null;
  session: AuthSession | null;
};

/**
 * Resolve the session once and expose it on the Hono context. Never rejects —
 * guest routes use this to tell "logged in" from "anonymous".
 */
export const loadSession = createMiddleware<{ Variables: AuthVariables }>(
  async (c, next) => {
    const result = await auth.api.getSession({ headers: c.req.raw.headers });
    c.set("user", result?.user ?? null);
    c.set("session", result?.session ?? null);
    await next();
  },
);

/** Reject unauthenticated requests with 401. For login-only routes. */
export const requireAuth = createMiddleware<{ Variables: AuthVariables }>(
  async (c, next) => {
    const result = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!result?.user) {
      throw new HTTPException(401, { message: "Authentication required." });
    }
    c.set("user", result.user);
    c.set("session", result.session);
    await next();
  },
);
