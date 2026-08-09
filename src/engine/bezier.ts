import type { PathNode, Point } from '../core/document';

const mix = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const add = (a: Point, b: Point | null): Point => b ? { x: a.x + b.x, y: a.y + b.y } : a;
const relative = (point: Point, origin: Point): Point => ({ x: point.x - origin.x, y: point.y - origin.y });

export function cubicPoints(nodes: readonly PathNode[], segment: number) {
  const from = nodes[segment], to = nodes[(segment + 1) % nodes.length];
  return { p0: from.anchor, p1: add(from.anchor, from.out), p2: add(to.anchor, to.in), p3: to.anchor };
}

export function cubicPoint(nodes: readonly PathNode[], segment: number, t: number): Point {
  const { p0, p1, p2, p3 } = cubicPoints(nodes, segment), q0 = mix(p0, p1, t), q1 = mix(p1, p2, t), q2 = mix(p2, p3, t), r0 = mix(q0, q1, t), r1 = mix(q1, q2, t);
  return mix(r0, r1, t);
}

/** De Casteljau subdivision: inserts a node without changing the rendered curve. */
export function splitCubicSegment(nodes: readonly PathNode[], segment: number, t: number, id: string = crypto.randomUUID()): PathNode[] {
  const { p0, p1, p2, p3 } = cubicPoints(nodes, segment), q0 = mix(p0, p1, t), q1 = mix(p1, p2, t), q2 = mix(p2, p3, t), r0 = mix(q0, q1, t), r1 = mix(q1, q2, t), anchor = mix(r0, r1, t), nextIndex = (segment + 1) % nodes.length;
  const result = nodes.map((node) => ({ ...node }));
  result[segment] = { ...result[segment], out: relative(q0, p0) };
  result[nextIndex] = { ...result[nextIndex], in: relative(q2, p3) };
  const inserted: PathNode = { id, anchor, in: relative(r0, anchor), out: relative(r1, anchor), kind: 'smooth' };
  result.splice(segment + 1, 0, inserted); return result;
}

export function nearestCubicPoint(nodes: readonly PathNode[], segment: number, point: Point, samples = 32) {
  let best = { t: 0, distance: Infinity };
  for (let index = 0; index <= samples; index += 1) { const t = index / samples, candidate = cubicPoint(nodes, segment, t), distance = Math.hypot(candidate.x - point.x, candidate.y - point.y); if (distance < best.distance) best = { t, distance }; }
  return best;
}
