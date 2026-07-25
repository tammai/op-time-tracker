---
paths:
  - "src/renderer/**"
  - "src/preload/**"
---
# Frontend Conventions (Renderer)

## Naming
- Components: PascalCase (`WorkPackageCard.vue`)
- Composables: camelCase with `use` prefix (`useWorkPackages.ts`)
- Pinia stores: camelCase with `Store` suffix (`useOpenProjectStore.ts`)
- Types/interfaces: PascalCase

## State
- Global state: Pinia stores (`src/renderer/stores/`)
- Async data: Pinia Colada queries (`useQuery`, `useMutation`)
- Local UI state: composables or `ref` in the component

## Server State: Pinia Colada
- Server data → Colada query/mutation composables only. Client state (UI, filters, drafts) → Pinia stores. Never wrap `useQuery`/`useMutation` inside a Pinia store — Colada's cache already lives in Pinia; wrapping it duplicates state and breaks lifecycle tracking.
- One file per domain: `src/renderer/composables/queries/<domain>.ts`. Define query options via `defineQueryOptions()`, grouped in a per-domain object. Keys are defined once there — never hand-written inline in components. Format: `['<domain>', '<scope>', ...params]`.
- Mutations colocate with their domain as `use<Action><Domain>()`. Cache invalidation happens inside the mutation composable via `useQueryCache()` — never in components.
- Components consume query composables only — no direct `window.openproject.*` calls from components (call via composables so cache + invalidation is wired). Use `defineQuery()` when the same query is shared by multiple components on one view.
- Types come from Zod schemas exported by the main process (`src/main/schemas/`) — the query layer is the only place raw API types are imported in the renderer.

## Components
- No business logic in components — move to a composable or store.
- Props typed with `defineProps<{}>()`. Events with `defineEmits<{}>()`.

## Nuxt UI v4 (as a Vue library, not Nuxt)
- `@nuxt/ui` is installed as a Vue plugin (manual install via `app.use(...)`, not Nuxt auto-import). Tailwind is wired through the standard Tailwind layer, not Nuxt's Tailwind module.
- Prefer Nuxt UI components (`UButton`, `UTable`, `UCard`, `UModal`, etc.) over hand-rolled equivalents. Don't reinvent components the library already provides.
- Theming via `app.config.ts` (semantic `ui.colors`) + Tailwind `@theme` tokens in `src/renderer/assets/css/main.css` — same handoff flow as a Nuxt app, just without the Nuxt config pipeline.
- Plugin install order in `src/renderer/src/main.ts` is load-bearing: Pinia → PiniaColada → Nuxt UI (Colada's query cache lives inside Pinia).
- The `ui()` Vite plugin is passed `root: <repo root>` so generated `.nuxt-ui` theme templates land in the top-level `node_modules` where Tailwind scans them — with the renderer's own `root`, utility classes like `bg-default`/`ring-default` silently vanish. `router: false` because this is an SPA with no vue-router.
- `auto-imports.d.ts` / `components.d.ts` are generated and gitignored. If typecheck can't resolve component types on a fresh clone, run `pnpm dev` or `pnpm build` once to regenerate them.

## Renderer tree layout
App code lives under `src/renderer/src/` (`views/`, `composables/queries/`, `utils/`); `index.html`, `app.config.ts`, and `assets/css/main.css` sit at `src/renderer/`. The paths written above omit that inner `src/` — follow the tree on disk. There is no `stores/` yet and no vue-router: `App.vue` switches views with an `activeView` ref.

## Preload bridge
- `src/preload/index.ts` exposes a narrowly-typed `window.openproject.*` surface via `contextBridge.exposeInMainWorld`. Only typed methods — never a generic fetch, never the API key, never Node APIs.
- The renderer imports types from `src/preload/types.ts` (or `@opentracker/preload` alias), never reaching into `src/main/` directly.

## Formatting
ESLint only (flat config). Prettier disabled. Run `pnpm lint --fix` for whole-repo formatting; per-edit format-on-save is wired via `.opencode/plugins/lint-on-save.ts` once scaffolded.