# Online Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a same-origin `/admin/` writing backend for secure draft management and manual GitHub publication, without AI or QQ integration.

**Architecture:** Serve the admin UI as a static Astro page and expose same-origin Cloudflare Pages Functions under `/api/admin/*`. Store users, sessions, drafts, publish records, and audit events in D1. Keep GitHub credentials only in Worker secrets; publish only validated Markdown files under `src/content/posts/` through the GitHub Contents API.

**Tech Stack:** Astro, TypeScript, Cloudflare Pages Functions, Cloudflare D1, Web Crypto PBKDF2/HMAC, GitHub Contents API, Markdown.

---

### Task 1: Add the secure data model and deployment bindings

**Files:**
- Create: `functions/api/admin/_shared/types.ts`
- Create: `functions/api/admin/_shared/security.ts`
- Create: `functions/api/admin/_shared/db.ts`
- Create: `migrations/0001_admin.sql`
- Modify: `wrangler.jsonc`

- [ ] Define request/response types for sessions, drafts, audit events, and environment bindings.
- [ ] Implement PBKDF2 password hashing and constant-time verification with Web Crypto.
- [ ] Implement random session IDs, hashed session storage, expiry checks, and HMAC request helpers.
- [ ] Add parameterized D1 query helpers and schema tables with restrictive indexes.
- [ ] Add D1 binding and Pages compatibility settings without putting secrets in the repository.

### Task 2: Implement authentication and CSRF protection

**Files:**
- Create: `functions/api/admin/_shared/auth.ts`
- Create: `functions/api/admin/login.ts`
- Create: `functions/api/admin/logout.ts`
- Create: `functions/api/admin/session.ts`
- Create: `functions/api/admin/csrf.ts`

- [ ] Implement login with rate limits, account lockout, secure cookies, and audit events.
- [ ] Implement logout and session revocation.
- [ ] Require a same-origin CSRF token for state-changing browser requests.
- [ ] Keep the first administrator bootstrap behind a one-time environment secret; never expose password setup in the public UI.

### Task 3: Implement draft CRUD and strict content validation

**Files:**
- Create: `functions/api/admin/drafts/index.ts`
- Create: `functions/api/admin/drafts/[id].ts`
- Create: `functions/api/admin/_shared/validation.ts`
- Create: `functions/api/admin/_shared/markdown.ts`

- [ ] Add authenticated draft list, create, update, and delete endpoints.
- [ ] Validate title, slug, dates, tags, category, body length, image URLs, and frontmatter.
- [ ] Reject path traversal, unsafe protocols, scripts, event attributes, iframe/embed/object tags, and sensitive-token patterns.
- [ ] Store only draft data in D1; do not write arbitrary files.

### Task 4: Implement manual GitHub publication

**Files:**
- Create: `functions/api/admin/drafts/[id]/publish.ts`
- Create: `functions/api/admin/_shared/github.ts`
- Create: `functions/api/admin/_shared/audit.ts`
- Modify: `.github/workflows/cloudflare-pages.yml`

- [ ] Publish only after an authenticated confirmation request.
- [ ] Use GitHub App installation credentials or a repository-scoped secret on the server side.
- [ ] Restrict writes to `src/content/posts/<safe-slug>/index.md`.
- [ ] Prevent accidental overwrite unless the draft explicitly targets its existing GitHub path.
- [ ] Record publication result and commit SHA in D1.
- [ ] Keep QQ and AI absent from this phase.

### Task 5: Build the `/admin/` UI

**Files:**
- Create: `src/pages/admin/index.astro`
- Create: `src/pages/admin/login.astro`
- Create: `src/components/admin/AdminApp.svelte`
- Create: `src/components/admin/MarkdownEditor.svelte`
- Create: `src/styles/admin.css`

- [ ] Add login, session state, draft list, new/edit draft form, Markdown preview, save, delete, and publish confirmation.
- [ ] Avoid storing credentials or GitHub secrets in browser storage.
- [ ] Escape rendered preview output and use a restricted Markdown preview pipeline.
- [ ] Make all destructive actions explicit and show server errors without leaking internals.

### Task 6: Add deployment setup and operator documentation

**Files:**
- Create: `migrations/README.md`
- Modify: `.github/workflows/cloudflare-pages.yml`
- Modify: `wrangler.jsonc`

- [ ] Document D1 creation, migration, Pages Functions bindings, secrets, and first-admin bootstrap.
- [ ] Ensure production deploys run migrations separately from static build and never print secrets.
- [ ] Keep local development instructions clear and separate from production credentials.

### Task 7: Verify the complete implementation

- [ ] Run `pnpm check`.
- [ ] Run `pnpm type-check`.
- [ ] Run `pnpm build`.
- [ ] Verify `/admin/`, `/admin/login`, and public pages render.
- [ ] Verify unauthenticated API access is rejected, malformed paths are rejected, and the static build remains successful.
