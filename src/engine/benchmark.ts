import { createBezierPath, createDocument, createRectangle, defaultStyle, identityTransform, type PathNode, type ShpeshftDocument, type VectorObject } from '../core/document';

export function createBenchmarkDocument(count: number): ShpeshftDocument {
  const doc = createDocument();
  const objects = Object.fromEntries(Array.from({ length: count }, (_, index) => {
    const object = createRectangle((index % 50) * 24, Math.floor(index / 50) * 24, index % 2 ? '#ff5a36' : '#ffc928');
    return [object.id, { ...object, geometry: { ...object.geometry, width: 18, height: 18 } }];
  }));
  return { ...doc, objects, order: Object.keys(objects), title: `Benchmark — ${count} objects` };
}

export function createPathBenchmarkDocument(count: number): ShpeshftDocument {
  const doc = createDocument();
  const objects = Object.fromEntries(Array.from({ length: count }, (_, index) => {
    const object = createBezierPath((index % 25) * 44, Math.floor(index / 25) * 44, index % 2 ? '#2457ff' : '#ff5a36');
    return [object.id, { ...object, transform: { ...object.transform, scaleX: .2, scaleY: .2 } }];
  }));
  return { ...doc, objects, order: Object.keys(objects), title: `Curve benchmark — ${count} paths` };
}

export function createNodeBenchmarkDocument(count: number): ShpeshftDocument {
  const doc = createDocument(); const radius = 390;
  const nodes: PathNode[] = Array.from({ length: count }, (_, index) => {
    const angle = index / count * Math.PI * 2; const tangent = radius * Math.PI * 2 / count / 3;
    return { id: crypto.randomUUID(), anchor: { x: 540 + Math.cos(angle) * radius, y: 540 + Math.sin(angle) * radius }, in: { x: Math.sin(angle) * tangent, y: -Math.cos(angle) * tangent }, out: { x: -Math.sin(angle) * tangent, y: Math.cos(angle) * tangent }, kind: 'smooth' };
  });
  const object: VectorObject = { id: crypto.randomUUID(), name: `${count}-node path`, geometry: { kind: 'path', closed: true, nodes }, transform: identityTransform(), style: defaultStyle('#2457ff'), visible: true, locked: false, parentId: null };
  return { ...doc, objects: { [object.id]: object }, order: [object.id], title: `Benchmark — ${count} node path` };
}
