export const DOCUMENT_FORMAT = 'org.dacarter.shpeshft.document';
export const DOCUMENT_VERSION = 1;

export type Point = Readonly<{ x: number; y: number }>;
export type Transform = Readonly<{ x: number; y: number; scaleX: number; scaleY: number; rotation: number }>;
export type Style = Readonly<{
  fillEnabled: boolean; fill: string; fillOpacity: number;
  strokeEnabled: boolean; strokeColor: string; strokeWidth: number; strokeOpacity: number;
  strokeDashArray: readonly number[]; strokeLineCap: 'butt' | 'round' | 'square'; strokeLineJoin: 'round' | 'miter' | 'bevel'; strokeMiterLimit: number;
  opacity: number;
}>;

export type RectGeometry = Readonly<{ kind: 'rect'; width: number; height: number; radius: number }>;
export type EllipseGeometry = Readonly<{ kind: 'ellipse'; rx: number; ry: number }>;
export type PathNode = Readonly<{ id: string; anchor: Point; in: Point | null; out: Point | null; kind: 'corner' | 'smooth' | 'symmetric' | 'independent' }>;
export type PathGeometry = Readonly<{ kind: 'path'; closed: boolean; nodes: readonly PathNode[]; subpaths?: readonly (readonly PathNode[])[] }>;
export type Geometry = RectGeometry | EllipseGeometry | PathGeometry;

export type VectorObject = Readonly<{
  id: string;
  name: string;
  geometry: Geometry;
  transform: Transform;
  style: Style;
  visible: boolean;
  locked: boolean;
  parentId: string | null;
}>;

export type ShpeshftDocument = Readonly<{
  format: typeof DOCUMENT_FORMAT;
  version: typeof DOCUMENT_VERSION;
  id: string;
  title: string;
  workspace: Readonly<{ width: number; height: number; background: string }>;
  objects: Readonly<Record<string, VectorObject>>;
  order: readonly string[];
  createdAt: string;
  updatedAt: string;
}>;

const id = (): string => crypto.randomUUID();
export const identityTransform = (): Transform => ({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 });
export const defaultStyle = (fill = '#ff5a36'): Style => ({ fillEnabled: true, fill, fillOpacity: 1, strokeEnabled: false, strokeColor: '#111111', strokeWidth: 2, strokeOpacity: 1, strokeDashArray: [], strokeLineCap: 'butt', strokeLineJoin: 'round', strokeMiterLimit: 4, opacity: 1 });

export function normalizeStyle(value: Partial<Style> & { stroke?: string | null }): Style {
  const defaults = defaultStyle(typeof value.fill === 'string' ? value.fill : '#ff5a36');
  return { ...defaults, ...value, fillEnabled: value.fillEnabled ?? true, fillOpacity: value.fillOpacity ?? 1, strokeEnabled: value.strokeEnabled ?? Boolean(value.stroke), strokeColor: value.strokeColor ?? value.stroke ?? defaults.strokeColor, strokeDashArray: value.strokeDashArray ?? [], strokeLineCap: value.strokeLineCap ?? 'butt', strokeLineJoin: value.strokeLineJoin ?? 'round', strokeMiterLimit: value.strokeMiterLimit ?? 4, strokeOpacity: value.strokeOpacity ?? 1 };
}

export function normalizeDocument(document: ShpeshftDocument): ShpeshftDocument {
  return { ...document, objects: Object.fromEntries(Object.entries(document.objects).map(([id, object]) => [id, { ...object, locked: object.locked ?? false, style: normalizeStyle(object.style as Partial<Style> & { stroke?: string | null }) }])) };
}

export function createDocument(now = new Date().toISOString()): ShpeshftDocument {
  return {
    format: DOCUMENT_FORMAT,
    version: DOCUMENT_VERSION,
    id: id(),
    title: 'Untitled workspace',
    workspace: { width: 1080, height: 1080, background: '#ffffff' },
    objects: {},
    order: [],
    createdAt: now,
    updatedAt: now
  };
}

export function createRectangle(x: number, y: number, fill = '#ff5a36'): VectorObject {
  return {
    id: id(), name: 'Rectangle', geometry: { kind: 'rect', width: 180, height: 140, radius: 0 },
    transform: { ...identityTransform(), x, y }, style: defaultStyle(fill), visible: true, locked: false, parentId: null
  };
}

export function createEllipse(x: number, y: number, fill = '#ffc928'): VectorObject {
  return {
    id: id(), name: 'Ellipse', geometry: { kind: 'ellipse', rx: 90, ry: 90 },
    transform: { ...identityTransform(), x, y }, style: defaultStyle(fill), visible: true, locked: false, parentId: null
  };
}

export function createBezierPath(x: number, y: number, fill = '#2457ff'): VectorObject {
  const node = (anchor: Point, incoming: Point, outgoing: Point): PathNode => ({
    id: id(), anchor, in: incoming, out: outgoing, kind: 'smooth'
  });
  return {
    id: id(), name: 'Bezier path',
    geometry: {
      kind: 'path', closed: true, nodes: [
        node({ x: 0, y: 70 }, { x: 0, y: 38 }, { x: 0, y: -38 }),
        node({ x: 90, y: 0 }, { x: -46, y: 0 }, { x: 46, y: 0 }),
        node({ x: 180, y: 70 }, { x: 0, y: -38 }, { x: 0, y: 38 }),
        node({ x: 90, y: 150 }, { x: 46, y: 0 }, { x: -46, y: 0 })
      ]
    },
    transform: { ...identityTransform(), x, y }, style: defaultStyle(fill), visible: true, locked: false, parentId: null
  };
}

export function createTriangle(x: number, y: number, fill = '#ff5a36'): VectorObject {
  const node = (anchor: Point): PathNode => ({ id: id(), anchor, in: null, out: null, kind: 'corner' });
  return {
    id: id(), name: 'Triangle', geometry: { kind: 'path', closed: true, nodes: [node({ x: 90, y: 0 }), node({ x: 180, y: 160 }), node({ x: 0, y: 160 })] },
    transform: { ...identityTransform(), x, y }, style: defaultStyle(fill), visible: true, locked: false, parentId: null
  };
}

export function assertDocument(value: unknown): asserts value is ShpeshftDocument {
  if (!value || typeof value !== 'object') throw new Error('Project is not an object');
  const doc = value as Partial<ShpeshftDocument>;
  if (doc.format !== DOCUMENT_FORMAT) throw new Error('Not a SHPESHFT project');
  if (doc.version !== DOCUMENT_VERSION) throw new Error(`Unsupported project version: ${String(doc.version)}`);
  if (!doc.objects || !Array.isArray(doc.order) || !doc.workspace) throw new Error('Project is incomplete');
}
