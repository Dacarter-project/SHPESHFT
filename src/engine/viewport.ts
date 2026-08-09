export type View = Readonly<{ x: number; y: number; scale: number }>;
export type ScreenPoint = Readonly<{ x: number; y: number }>;

export function fitWorkspace(viewportWidth: number, viewportHeight: number, workspaceWidth: number, workspaceHeight: number, padding = 48): View {
  const availableWidth = Math.max(1, viewportWidth - padding * 2);
  const availableHeight = Math.max(1, viewportHeight - padding * 2);
  const scale = Math.max(.12, Math.min(1, availableWidth / workspaceWidth, availableHeight / workspaceHeight));
  return { x: (viewportWidth - workspaceWidth * scale) / 2, y: (viewportHeight - workspaceHeight * scale) / 2, scale };
}

export function zoomAt(view: View, point: ScreenPoint, nextScale: number): View {
  const scale = Math.max(.12, Math.min(5, nextScale));
  const worldX = (point.x - view.x) / view.scale;
  const worldY = (point.y - view.y) / view.scale;
  return { x: point.x - worldX * scale, y: point.y - worldY * scale, scale };
}

export function zoomFromAnchor(anchor: ScreenPoint, midpoint: ScreenPoint, scale: number): View {
  const boundedScale = Math.max(.12, Math.min(5, scale));
  return { x: midpoint.x - anchor.x * boundedScale, y: midpoint.y - anchor.y * boundedScale, scale: boundedScale };
}
