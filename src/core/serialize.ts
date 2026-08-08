import { assertDocument, type ShpeshftDocument } from './document';

export function serialize(document: ShpeshftDocument): string {
  return JSON.stringify(document);
}

export function deserialize(source: string): ShpeshftDocument {
  const value: unknown = JSON.parse(source);
  assertDocument(value);
  for (const id of value.order) if (!value.objects[id]) throw new Error(`Project references missing object ${id}`);
  return value;
}
