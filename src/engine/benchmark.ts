import { createBezierPath, createDocument, createRectangle, type ShpeshftDocument } from '../core/document';

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
