# ADR 0001: Engine foundation

Status: Accepted for prototype; renderer and geometry choices remain behind benchmark gates.

## Decisions

1. The versioned TypeScript document model is independent of Svelte, Canvas, SVG and storage.
2. Persistent document state, session state and transient gesture previews are separate.
3. One user gesture commits one reversible command.
4. Canvas2D is the initial reference renderer. PixiJS/WebGL will be introduced only in an isolated renderer package and retained only if measured mobile workloads justify it.
5. IndexedDB is accessed through the open-source Dexie core only. Dexie Cloud is prohibited.
6. Path boolean operations will be tested through an isolated worker adapter before a geometry dependency is accepted.
7. The application is a static, self-contained PWA and requires no runtime server.

## Irreversible boundaries

- Stable object and node identifiers
- Explicit document versioning and migration
- Exact cubic Bézier control data as canonical geometry
- Renderer-independent transforms and styles
- Self-contained project exports

## Prototype exit gates

- Real-device pan, zoom, selection and transform measurements at 500–5,000 objects
- 100–1,000-node path editing corpus
- Crash/reload recovery tests
- Renderer comparison on agreed iPhone and Android reference devices
- Boolean correctness and memory tests before PathKit acceptance
