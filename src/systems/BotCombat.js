/**
 * Pure bot hitscan rules. BotSquad applies the result through the shared
 * takeDamage contract, keeping human and bot scoring on the same path.
 * The standing body is approximated by a cylinder (XZ radius + vertical band).
 */
function bodyEntry(from, dir, at, maxDistance) {
  const x = from.x - at.x, z = from.z - at.z;
  const a = dir.x * dir.x + dir.z * dir.z;
  const c = x * x + z * z - 0.45 * 0.45;
  let entry = 0, exit = maxDistance;
  if (a < 1e-12) {
    if (c > 0) return null;
  } else {
    const b = x * dir.x + z * dir.z;
    const discriminant = b * b - a * c;
    if (discriminant < 0) return null;
    const root = Math.sqrt(discriminant);
    entry = Math.max(entry, (-b - root) / a);
    exit = Math.min(exit, (-b + root) / a);
  }
  const low = at.y - 0.3, high = at.y + 1.7;
  if (Math.abs(dir.y) < 1e-12) {
    if (from.y < low || from.y > high) return null;
  } else {
    const first = (low - from.y) / dir.y, second = (high - from.y) / dir.y;
    entry = Math.max(entry, Math.min(first, second));
    exit = Math.min(exit, Math.max(first, second));
  }
  return entry <= exit ? entry : null;
}

/**
 * `dir` is normalized; `participants` excludes shooter and same-team actors.
 * `hit` is the physics world raycast, or null for an unobstructed shot.
 * Return the nearest body reached before the world, a world impact, or a miss.
 */
export function resolveBotShot({ from, dir, range, hit, participants, damage = 10 }) {
  const wall = hit ? (hit.distance ?? hit.timeOfImpact ?? Math.hypot(hit.point.x - from.x, hit.point.y - from.y, hit.point.z - from.z)) : range;
  let best = null, bestDistance = Math.min(wall, range);
  for (const participant of participants || []) {
    if (!participant.alive) continue;
    const entry = bodyEntry(from, dir, participant.position, bestDistance);
    if (entry !== null && (entry < bestDistance || (!hit && !best && entry === bestDistance))) {
      bestDistance = entry;
      best = participant;
    }
  }
  if (best) return { participant: best, amount: damage };
  return hit ? { world: hit } : {};
}
