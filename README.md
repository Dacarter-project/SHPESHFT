# SHPESHFT

**Taking AI out of design.**

SHPESHFT is an open-source, touch-first, local-first vector design application. It is designed as a tool: no accounts, no cloud dependency, no generative AI, and no marketplace.

## Status

The repository currently contains the engine foundation and interaction prototype. It proves a versioned document model, delta-based undo/redo, local IndexedDB persistence, canvas rendering, touch pan/zoom, object insertion and movement, and synthetic 500/2,500/5,000-object test documents.

This is not V1 and the project format is not yet stable.

## Development

Requires Node.js 22 or newer.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm check
pnpm build
```

## Product constraints

- The document is the source of truth; UI and renderer state are disposable.
- Interaction work stays on the main thread; committed heavy geometry belongs in workers.
- SVG is an import/export format, not the live document model.
- Browser-local storage is not a backup. Portable project export is required before V1.
- Dependencies must use approved open-source licences and must never require a paid service.

## Licence

The project owner will select the project licence before the first public release. All current direct dependencies use permissive open-source licences. Project format documentation and user-created artwork will not be restricted by the application licence.
