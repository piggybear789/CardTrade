// lib/instagram/botHandle.ts
//
// NoDitto's own Instagram account, the one members DM their claim code to.
//
// ONE place for it, because the DM claim paths must REFUSE it. The bot cannot prove it
// owns itself by messaging itself, and on 2026-10-22 a webhook event that named the
// bot as its own sender approved a member's claim of @no.ditto from a DM sent by a
// different account. Any event that resolves to the bot can only ever "prove" the
// bot's handle, so refusing that handle closes the hole whatever Meta sends. NoDitto's
// own handle, if it is ever wanted on a profile, is linked by staff, not by DM.

/** The bot's handle without `@`, lower-case. `@no.ditto` (with the dot); `@noditto` is someone else. */
export function instagramBotHandle(): string {
  return (process.env.NEXT_PUBLIC_INSTAGRAM_BOT_HANDLE || 'no.ditto')
    .trim()
    .replace(/^@/, '')
    .toLowerCase();
}

/** True when a normalised Instagram handle is the bot's own. */
export function isInstagramBotHandle(handleNorm: string): boolean {
  return handleNorm.trim().replace(/^@/, '').toLowerCase() === instagramBotHandle();
}
