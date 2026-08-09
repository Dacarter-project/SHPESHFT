import { describe, expect, it } from 'vitest';
import { createEllipse, createRectangle, createTriangle } from '../core/document';
import { booleanRectangles, booleanShapes, unionRectangles } from './boolean';
import { createDocument } from '../core/document';
import { History, ReplaceObjectsCommand } from '../core/commands';

describe('rectangle union', () => {
  it('commits overlapping rectangles to one editable outline', () => {
    const left = createRectangle(0, 0), right = createRectangle(100, 60);
    const result = unionRectangles([left, right]);
    expect(result?.geometry.kind).toBe('path');
    if (result?.geometry.kind !== 'path') throw new Error('Expected path');
    expect(result.geometry.nodes.length).toBeGreaterThanOrEqual(8);
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
  it('combines different geometry types into editable paths',async()=>{const triangle=createTriangle(0,0),ellipse=createEllipse(90,80),results=await booleanShapes([triangle,ellipse],'union');expect(results.length).toBeGreaterThan(0);expect(results.every((result)=>result.geometry.kind==='path')).toBe(true);});
  it('intersects rotated artwork without checking its original primitive type',async()=>{const rectangle=createRectangle(0,0),ellipse=createEllipse(100,70),rotated={...rectangle,transform:{...rectangle.transform,rotation:Math.PI/8}},results=await booleanShapes([rotated,ellipse],'intersect');expect(results.length).toBeGreaterThan(0);expect(results[0].geometry.kind).toBe('path');});
  it('preserves cubic curves instead of persisting renderer samples',async()=>{const a=createEllipse(100,100),b=createEllipse(210,100),result=(await booleanShapes([a,b],'union'))[0];expect(result.geometry.kind).toBe('path');if(result.geometry.kind!=='path')return;expect(result.geometry.nodes.length).toBeLessThanOrEqual(12);expect(result.geometry.nodes.some((node)=>node.in||node.out)).toBe(true);});
  it('keeps an untouched cubic anchor and handles numerically identical',async()=>{const a=createEllipse(100,100),b=createEllipse(210,100),result=(await booleanShapes([a,b],'union'))[0];expect(result.geometry.kind).toBe('path');if(result.geometry.kind!=='path')return;const farLeft=result.geometry.nodes.find((node)=>Math.abs(node.anchor.x-10)<1e-6&&Math.abs(node.anchor.y-100)<1e-6);expect(farLeft).toBeDefined();expect(Math.abs(farLeft?.in?.y??0)).toBeCloseTo(.5522847498307936*90,8);expect(Math.abs(farLeft?.out?.y??0)).toBeCloseTo(.5522847498307936*90,8);expect(farLeft?.in?.x??0).toBeCloseTo(0,8);expect(farLeft?.out?.x??0).toBeCloseTo(0,8);});
  it('keeps compound holes as authoring subpaths',async()=>{const outer=createEllipse(200,200),inner={...createEllipse(200,200),geometry:{kind:'ellipse' as const,rx:40,ry:40}},result=(await booleanShapes([outer,inner],'difference'))[0];expect(result.geometry.kind).toBe('path');if(result.geometry.kind!=='path')return;expect(result.geometry.subpaths?.length).toBe(1);expect(result.geometry.nodes.length+(result.geometry.subpaths?.[0].length??0)).toBeLessThanOrEqual(12);});
  it('keeps repeated Boolean authoring geometry bounded',async()=>{let result=(await booleanShapes([createEllipse(100,100),createEllipse(210,100)],'union'))[0];result=(await booleanShapes([result,{...createEllipse(160,100),geometry:{kind:'ellipse' as const,rx:35,ry:35}}],'difference'))[0];result=(await booleanShapes([result,createRectangle(40,20)],'intersect'))[0];expect(result.geometry.kind).toBe('path');if(result.geometry.kind!=='path')return;const count=result.geometry.nodes.length+(result.geometry.subpaths??[]).reduce((sum,path)=>sum+path.length,0);expect(count).toBeLessThan(40);});
  it('undo restores exact original authoring objects and redo restores the result',async()=>{const a=createEllipse(100,100),b=createEllipse(210,100),result=(await booleanShapes([a,b],'union'))[0],base=createDocument(),original={...base,objects:{[a.id]:a,[b.id]:b},order:[a.id,b.id]},history=new History(),command=new ReplaceObjectsCommand({[a.id]:a,[b.id]:b},{[a.id]:null,[b.id]:null,[result.id]:result},original.order,[result.id]);let document=history.execute(original,command);expect(document.objects[result.id]).toEqual(result);document=history.undo(document);expect(document.objects[a.id]).toEqual(a);expect(document.objects[b.id]).toEqual(b);document=history.redo(document);expect(document.objects[result.id]).toEqual(result);});
});
