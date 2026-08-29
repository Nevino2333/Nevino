# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Firefly is a feature-rich blog built on **Astro 7** with **Svelte 5** for interactive components. It's a fork of [Fuwari](https://github.com/saicaca/fuwari) extended with extensive features, including a self-hosted online admin backend. Primary language is Chinese (Simplified) with i18n for en, zh_TW, ja, ru.

## Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Dev server at `localhost:4321` |
| `pnpm build` | Production build (icons → LQIPs → Astro build → font subsets → Pagefind indexing) |
| `pnpm preview` | Preview production build |
| `pnpm check` | `astro check` for type/error checking |
| `pnpm type-check` | `tsc --noEmit --isolatedDeclarations` |
| `pnpm lint` / `pnpm format` | Biome lint + auto-fix / format `src` |
| `pnpm test:admin` | Admin backend unit tests (`tests/admin/*.test.ts`, node:test) |
| `pnpm new-post <filename>` | Scaffold a new blog post |
| `pnpm post-studio` | Local web studio for editing post frontmatter (port 4323) |
| `pnpm admin:db:local` | Apply D1 migrations to the local admin database |
| `pnpm admin:dev` | Serve `dist` through `wrangler pages dev` with local D1/R2 bindings on port 8788 |

Package manager is **pnpm** (enforced). Node.js >= 22 required.

## Architecture

### Astro + Svelte Hybrid

- `.astro` components for static content and layouts
- `.svelte` components for interactive UI (search, settings, pagination, archive) — mounted with `client:load` or `client:visible`
- Swup.js handles SPA-like page transitions with multiple container targets

### Configuration-Driven

All features are toggled/configured via TypeScript files in `src/config/`, exported through the barrel at `src/config/index.ts`. Key configs:

- `siteConfig.ts` — core site settings, theme, pagination, page toggles
- `sidebarConfig.ts` — sidebar layout (left/right/both, widget ordering)
- `commentConfig.ts`, `analyticsConfig.ts`, `fontConfig.ts`, etc.

### Content Collections

Defined in `src/content.config.ts`:
- `posts` — blog posts (`.md`/`.mdx`) with frontmatter: title, published, tags, category, draft, pinned, password, comment, etc.
- `spec` — special pages (about, friends, guestbook)

### Admin Backend (Cloudflare Pages Functions + D1 + R2)

The site has a self-hosted admin at `/admin/` for managing content without touching code:

- **API**: `functions/api/admin/**` — session/CSRF auth, drafts lifecycle (publish/withdraw/rename/rollback/history/import), media (R2), publish tasks, content operations, staged site settings & spec pages (published as whitelisted GitHub commits), audit, sessions, overview. Shared layer in `functions/api/admin/_shared/` (repositories, services, GitHub gateway, markdown policy/validation).
- **Data ownership**: GitHub is the source of truth for published content and config files; D1 (`nevino-admin`, schema in `migrations/*.sql`) holds drafts, revisions, publish tasks, sessions, audit and staged changesets; R2 (`firefly-media`) holds media objects. Partial external failures land in `reconciliation_required` with recoverable evidence.
- **UI**: `src/components/admin/**` (Svelte 5), mounted from `src/pages/admin/`.
- **Deployment callback**: `.github/workflows/cloudflare-pages.yml` builds and deploys, then reports the commit outcome to `functions/api/admin/deployment-callback.ts` so publish tasks and content operations converge.
- **Tests**: `tests/admin/*.test.ts` — service-level tests with in-memory fakes for D1/GitHub/R2 (`pnpm test:admin`).

### Key Directories

- `src/components/` — organized by domain: `admin/`, `analytics/`, `comment/`, `common/`, `controls/`, `features/`, `layout/`, `misc/`, `pages/`, `widget/`
- `src/plugins/` — custom remark/rehype plugins (Mermaid, PlantUML, KaTeX, GitHub cards, reading time, etc.)
- `src/i18n/` — translation keys in `i18nKey.ts`, language files in `languages/*.ts`, lookup via `translation.ts`
- `src/utils/` — content sorting, crypto (encrypted posts), date formatting, image processing/LQIP, TOC generation, friends feed
- `src/pages/` — Astro file-based routing
- `functions/` — Cloudflare Pages Functions (admin API, `/media/*` R2 serving, `/api/stats/visit`)
- `scripts/` — build-time utilities (`generate-icons.js`, `generate-lqips.ts`, `subset-fonts.ts`, `new-post.js`, `post-studio.js`)

### Path Aliases (tsconfig.json)

`@components/*`, `@assets/*`, `@constants/*`, `@utils/*`, `@i18n/*`, `@layouts/*` → `./src/<dir>/*`; `@/*` → `./src/*`

## Code Style

- **Biome** enforces: tab indentation, double quotes, recommended lint rules
- Relaxed rules for `.svelte`/`.astro` files (useConst off, noUnusedVariables off)
- Commit convention: **Conventional Commits** (`feat:`, `fix:`, `chore:`, etc.)

## Build Pipeline

Multi-step: `scripts/generate-icons.js` → `scripts/generate-lqips.ts` → `astro build` → `scripts/subset-fonts.ts` → `pagefind --site dist`

Icons/LQIP data are generated into `src/constants/` and committed. Regenerate with `pnpm icons` or `pnpm lqips`.

## Deployment

- **Cloudflare Pages** (active): push to `master` → GitHub Actions builds the site and runs `wrangler pages deploy dist`, then posts a deployment callback to the admin API.
- `vercel.json` and `.github/workflows/deploy.yml` are legacy fallbacks, not part of the active flow.
