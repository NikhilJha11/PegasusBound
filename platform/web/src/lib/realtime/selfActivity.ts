// Tracks entities the CURRENT user just mutated, so collaborative editors never
// mistake the user's own change for a teammate's. The bug this fixes: an editor
// detects "the record changed on the server" purely from a data diff and a
// per-component save window, so any change the same user makes ELSEWHERE (a
// list-row toggle, another tab, another device's action that round-trips back)
// looks like a teammate edited it.
//
// Every audited mutation broadcasts an AUDIT_CREATED realtime event carrying the
// acting `user_id`. When that actor is us, we stamp a short-lived marker keyed
// by `${entityType}:${entityId}`. Any editor for that entity can then ask
// `isSelfMutation(...)` before showing a "changed by a teammate" notice.
//
// Module-level (not React state) on purpose: it is an ephemeral cross-cutting
// cache read synchronously inside effects, and must not trigger re-renders.

const SELF_TTL_MS = 12_000

const recent = new Map<string, number>()

const key = (entityType: string, entityId: string) => `${entityType}:${entityId}`

function prune(now: number) {
  for (const [k, expiresAt] of recent) {
    if (expiresAt <= now) recent.delete(k)
  }
}

// Record that the current user just mutated this entity. No-op for blanks.
export function markSelfMutation(entityType: string, entityId: string, now = Date.now()) {
  if (!entityType || !entityId) return
  prune(now)
  recent.set(key(entityType, entityId), now + SELF_TTL_MS)
}

// True if the current user mutated this entity within the recent window.
export function isSelfMutation(entityType: string, entityId: string, now = Date.now()): boolean {
  const expiresAt = recent.get(key(entityType, entityId))
  if (expiresAt == null) return false
  if (expiresAt <= now) {
    recent.delete(key(entityType, entityId))
    return false
  }
  return true
}
