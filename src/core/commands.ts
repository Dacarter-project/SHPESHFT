import type { ShpeshftDocument, Transform, VectorObject } from './document';

export interface Command {
  readonly label: string;
  apply(document: ShpeshftDocument): ShpeshftDocument;
  revert(document: ShpeshftDocument): ShpeshftDocument;
}

const touch = (document: ShpeshftDocument): ShpeshftDocument => ({ ...document, updatedAt: new Date().toISOString() });

export class AddObjectCommand implements Command {
  readonly label = 'Add object';
  constructor(readonly object: VectorObject) {}
  apply(document: ShpeshftDocument): ShpeshftDocument {
    return touch({ ...document, objects: { ...document.objects, [this.object.id]: this.object }, order: [...document.order, this.object.id] });
  }
  revert(document: ShpeshftDocument): ShpeshftDocument {
    const objects = { ...document.objects };
    delete objects[this.object.id];
    return touch({ ...document, objects, order: document.order.filter((id) => id !== this.object.id) });
  }
}

export class TransformObjectCommand implements Command {
  readonly label = 'Transform object';
  constructor(readonly objectId: string, readonly before: Transform, readonly after: Transform) {}
  apply(document: ShpeshftDocument): ShpeshftDocument { return this.set(document, this.after); }
  revert(document: ShpeshftDocument): ShpeshftDocument { return this.set(document, this.before); }
  private set(document: ShpeshftDocument, transform: Transform): ShpeshftDocument {
    const object = document.objects[this.objectId];
    if (!object) return document;
    return touch({ ...document, objects: { ...document.objects, [this.objectId]: { ...object, transform } } });
  }
}

export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  execute(document: ShpeshftDocument, command: Command): ShpeshftDocument {
    this.undoStack.push(command); this.redoStack = []; return command.apply(document);
  }
  undo(document: ShpeshftDocument): ShpeshftDocument {
    const command = this.undoStack.pop(); if (!command) return document;
    this.redoStack.push(command); return command.revert(document);
  }
  redo(document: ShpeshftDocument): ShpeshftDocument {
    const command = this.redoStack.pop(); if (!command) return document;
    this.undoStack.push(command); return command.apply(document);
  }
  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
}
