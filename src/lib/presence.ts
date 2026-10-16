/** who is looking at which market right now: in-memory, per web instance, forgotten after TTL without a heartbeat */
const TTL_MS = 45_000;
const rooms = new Map<string, Map<string, number>>();

export function touch(coin: string, id: string) {
  let r = rooms.get(coin);
  if (!r) rooms.set(coin, (r = new Map()));
  r.set(id, Date.now());
  return count(coin);
}

export function count(coin: string): number {
  const r = rooms.get(coin);
  if (!r) return 0;
  const cut = Date.now() - TTL_MS;
  for (const [id, t] of r) if (t < cut) r.delete(id);
  if (!r.size) rooms.delete(coin);
  return r.size;
}
