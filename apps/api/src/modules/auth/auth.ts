import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import {
  BETTER_AUTH_SECRET,
  BETTER_AUTH_URL,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  PLATFORM_ORIGINS,
} from "../../config.js";
import { prisma } from "../../utils/prisma.js";

/**
 * Better Auth instance.
 *
 * Sign-in methods:
 * - email + password (always on; no external setup needed for local dev)
 * - Google OAuth (only registered when GOOGLE_CLIENT_ID/SECRET are set)
 *
 * Sessions are cookie-based (httpOnly, SameSite=Lax); the platform talks to
 * the gateway cross-origin but same-site, so the cookie rides along with
 * `credentials: "include"`.
 *
 * NOTE: BRD §12.6 specified Google-only. Email/password is added so local dev
 * and testing need no OAuth callback. Password reset is intentionally not
 * wired yet (would need an email sender).
 */
const googleEnabled = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);

export const auth = betterAuth({
  baseURL: BETTER_AUTH_URL,
  basePath: "/api/auth",
  secret: BETTER_AUTH_SECRET || undefined,
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
  socialProviders: googleEnabled
    ? {
        google: {
          clientId: GOOGLE_CLIENT_ID,
          clientSecret: GOOGLE_CLIENT_SECRET,
        },
      }
    : {},
  trustedOrigins: PLATFORM_ORIGINS,
});

/** Whether Google OAuth is configured; the UI hides the button when false. */
export const isGoogleAuthEnabled = googleEnabled;
