import { describe, expect, it } from 'vitest';
import { fitWorkspace, zoomAt, zoomFromAnchor } from './viewport';

describe('viewport', () => {
  it('centres the Workspace with pasteboard on every side', () => {
    expect(fitWorkspace(1200, 800, 1000, 600, 50)).toEqual({ x: 100, y: 100, scale: 1 });
  });

  it('keeps the world position beneath the zoom point fixed', () => {
    const before = { x: 100, y: 80, scale: .5 }; const point = { x: 350, y: 280 };
    const after = zoomAt(before, point, 1);
    expect((point.x - after.x) / after.scale).toBe((point.x - before.x) / before.scale);
    expect((point.y - after.y) / after.scale).toBe((point.y - before.y) / before.scale);
  });

  it('keeps a pinch world anchor beneath the moving midpoint', () => {
    expect(zoomFromAnchor({ x: 200, y: 300 }, { x: 250, y: 350 }, 2)).toEqual({ x: -150, y: -250, scale: 2 });
  });
});
