import { describe, expect, it } from 'vitest';
import { createEllipse, createRectangle, createTriangle } from '../core/document';
import { booleanRectangles, booleanShapes, unionRectangles } from './boolean';

describe('rectangle union', () => {
  it('commits overlapping rectangles to one editable outline', () => {
    const left = createRectangle(0, 0), right = createRectangle(100, 60);
    const result = unionRectangles([left, right]);
    expect(result?.geometry.kind).toBe('path');
    if (result?.geometry.kind !== 'path') throw new Error('Expected path');
    expect(result.geometry.nodes.length).toBe(8);
    expect(result.geometry.nodes.every((node) => node.kind === 'corner')).toBe(true);
  });
  it('creates editable rectangle intersection and difference outlines', () => {
    const left = createRectangle(0, 0), right = createRectangle(100, 60);
    const intersection = booleanRectangles([left, right], 'intersect');
    const difference = booleanRectangles([left, right], 'difference');
    expect(intersection?.geometry.kind).toBe('path');
    expect(difference?.geometry.kind).toBe('path');
    if (intersection?.geometry.kind !== 'path' || difference?.geometry.kind !== 'path') throw new Error('Expected paths');
    expect(intersection.geometry.nodes).toHaveLength(4);
    expect(difference.geometry.nodes.length).toBeGreaterThanOrEqual(4);
  });
});

describe('shape-independent Boolean operations',()=>{
  it('combines different geometry types into editable paths',()=>{const triangle=createTriangle(0,0),ellipse=createEllipse(90,80),results=booleanShapes([triangle,ellipse],'union');expect(results.length).toBeGreaterThan(0);expect(results.every((result)=>result.geometry.kind==='path')).toBe(true);});
  it('intersects rotated artwork without checking its original primitive type',()=>{const rectangle=createRectangle(0,0),ellipse=createEllipse(100,70),rotated={...rectangle,transform:{...rectangle.transform,rotation:Math.PI/8}},results=booleanShapes([rotated,ellipse],'intersect');expect(results.length).toBeGreaterThan(0);expect(results[0].geometry.kind).toBe('path');});
});
