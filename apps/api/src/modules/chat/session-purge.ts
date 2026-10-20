import { prisma } from "../../utils/prisma.js";

/**
 * Chips are snapshot rows without FK, so deleting the chat memory does not
 * cascade. Purge them explicitly when a session is cleared.
 */
export async function purgeSessionChips(
  ownerId: string | undefined,
  sessionId: string,
): Promise<void> {
  try {
    await prisma.chatMessageMention.deleteMany({ where: { sessionId } });
    if (ownerId) {
      await prisma.chatAttachment.deleteMany({ where: { ownerId, sessionId } });
    }
  } catch (err) {
    console.warn("[chat:history] chip cleanup failed", err);
  }
}
