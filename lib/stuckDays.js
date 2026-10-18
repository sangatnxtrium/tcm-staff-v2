/** Days a lot stays in the same stage before staff flag it as stuck.
 *  Inventory, Merchandise Pipeline, and Command Center all read this.
 *  A lot is stuck when whole days in the current stage are >= STUCK_DAYS
 *  (the labels say "7+ days").
 */
export const STUCK_DAYS = 7;

export function wholeDaysSince(iso, now = Date.now()) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((now - t) / 86400000));
}
