// Supabase Realtime reuses RealtimeChannel instances by topic string. Calling
// `.on()` on a channel that is already subscribed throws. Topics must be unique
// across concurrent mounts (React Strict Mode, two chat UIs on one conversation)
// and across reconnect attempts — a per-effect counter is not enough.

/** Topic that will not collide with any other live channel on this client. */
export function uniqueRealtimeTopic(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}
