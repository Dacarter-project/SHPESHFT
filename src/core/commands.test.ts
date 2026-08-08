import { describe, expect, it } from 'vitest';
import { AddObjectCommand, History, MovePathNodeCommand, TransformObjectCommand } from './commands';
import { createBezierPath, createDocument, createRectangle } from './document';
import { deserialize, serialize } from './serialize';

describe('document commands', () => {
  it('adds, undoes and redoes without cloning the whole history', () => {
    let doc = createDocument('2026-01-01T00:00:00.000Z');
    const rect = createRectangle(10, 20);
    const history = new History();
    doc = history.execute(doc, new AddObjectCommand(rect));
    expect(doc.order).toEqual([rect.id]);
    doc = history.undo(doc);
    expect(doc.order).toEqual([]);
    doc = history.redo(doc);
    expect(doc.objects[rect.id]).toEqual(rect);
  });

  it('coalesces a gesture into one reversible transform command', () => {
    const rect = createRectangle(10, 20);
    const history = new History();
    let doc = history.execute(createDocument(), new AddObjectCommand(rect));
    const after = { ...rect.transform, x: 400, y: 500 };
    doc = history.execute(doc, new TransformObjectCommand(rect.id, rect.transform, after));
    expect(doc.objects[rect.id].transform.x).toBe(400);
    doc = history.undo(doc);
    expect(doc.objects[rect.id].transform).toEqual(rect.transform);
  });

  it('round-trips the versioned project format', () => {
    const rect = createRectangle(10, 20);
    const doc = new AddObjectCommand(rect).apply(createDocument());
    expect(deserialize(serialize(doc))).toEqual(doc);
  });

  it('moves a bezier node as one reversible command', () => {
    const path = createBezierPath(10, 20);
    const history = new History();
    let doc = history.execute(createDocument(), new AddObjectCommand(path));
    if (path.geometry.kind !== 'path') throw new Error('Expected a path');
    const before = path.geometry.nodes[0];
    const after = { ...before, anchor: { x: 25, y: 90 } };
    doc = history.execute(doc, new MovePathNodeCommand(path.id, before.id, before, after));
    let geometry = doc.objects[path.id].geometry;
    if (geometry.kind !== 'path') throw new Error('Expected edited path');
    expect(geometry.nodes[0].anchor).toEqual({ x: 25, y: 90 });
    doc = history.undo(doc);
    geometry = doc.objects[path.id].geometry;
    if (geometry.kind !== 'path') throw new Error('Expected restored path');
    expect(geometry.nodes[0].anchor).toEqual(before.anchor);
  });
});
