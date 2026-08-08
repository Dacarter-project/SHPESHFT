import { createDocument, createRectangle, type ShpeshftDocument } from '../core/document';

export function createBenchmarkDocument(count: number): ShpeshftDocument {
  const doc = createDocument();
  const objects = Object.fromEntries(Array.from({ length: count }, (_, index) => {
    const object = createRectangle((index % 50) * 24, Math.floor(index / 50) * 24, index % 2 ? '#ff5a36' : '#ffc928');
    return [object.id, { ...object, geometry: { ...object.geometry, width: 18, height: 18 } }];
  }));
  return { ...doc, objects, order: Object.keys(objects), title: `Benchmark — ${count} objects` };
}
