import Dexie, { type EntityTable } from 'dexie';
import { normalizeDocument, type ShpeshftDocument } from '../core/document';

type StoredProject = { id: string; updatedAt: string; document: ShpeshftDocument };

const database = new Dexie('shpeshft') as Dexie & { projects: EntityTable<StoredProject, 'id'> };
database.version(1).stores({ projects: 'id, updatedAt' });

export async function saveProject(document: ShpeshftDocument): Promise<void> {
  await database.transaction('rw', database.projects, () => database.projects.put({ id: document.id, updatedAt: document.updatedAt, document }));
}

export async function loadLatestProject(): Promise<ShpeshftDocument | null> {
  const project = await database.projects.orderBy('updatedAt').last();
  return project?.document ? normalizeDocument(project.document) : null;
}
