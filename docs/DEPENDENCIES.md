# Dependency policy

SHPESHFT must operate, build and be self-hostable without subscriptions, hosted APIs or licence keys.

Allowed licences for direct runtime/build dependencies are currently: MIT, ISC, BSD-2-Clause, BSD-3-Clause and Apache-2.0. New dependencies require a recorded justification covering licence, size, maintenance, performance and replacement strategy.

| Package | Licence | Purpose | Lock-in boundary |
|---|---|---|---|
| Svelte | MIT | Accessible UI shell | Engine has no Svelte imports |
| Dexie core | Apache-2.0 | IndexedDB transactions | Storage module owns the adapter |
| Vite | MIT | Reproducible static build | Output is ordinary static files |
| Vitest | MIT | Unit tests | Development only |

Dexie Cloud, proprietary font services, analytics SDKs and remotely required CDNs are prohibited. Exact versions and the lockfile are committed. `pnpm license:report` produces the dependency licence report for release review.
