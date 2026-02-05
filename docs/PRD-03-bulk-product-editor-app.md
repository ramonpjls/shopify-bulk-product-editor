# Bulk Product Editor App

**Category:** Custom App Development
**Complexity:** Medium (4-5 days)
**Role:** Shopify Engineer

---

## Objective

Build an admin app for bulk editing product data via GraphQL.

### Requirements
- GraphQL Admin API for reading/updating products
- Bulk operations via `bulkOperationRunMutation`
- Supported edits: title/description (find-replace), price adjustments, tag management, metafield updates, status changes
- Operation history with before/after; preview mode; undo capability

### Frontend (Polaris)
- Product selection by collection, tags, type, vendor, or manual
- Edit action selector with appropriate forms
- Preview table with highlighted diffs; progress indicator
- History with undo; use IndexTable, Filters, Modal, ProgressBar

### Evaluation Criteria

| Area | What We Look For |
|------|-----------------|
| Bulk Operations | Correct use of Shopify bulk API |
| GraphQL | Efficient queries, pagination, batching |
| Preview/Undo | Reliable preview and undo |
| Rate Limits | Proper handling with queuing |
| UX | Clear workflow with progress/error feedback |

---

## General Expectations

### Thinking Process

- **Before writing any code**, provide:
  - Technical design document with approach, Shopify APIs to be used, and data flow
  - Architecture diagram showing app components, API interactions, and data storage
  - Documentation of Shopify API limitations or rate limit considerations
- For theme projects: component hierarchy and section schema design
- For integration projects: sequence diagram showing data flow between systems
- For migration projects: migration plan with data mapping, risk assessment, and rollback strategy

### Code Quality

**App Development:**
- Follow Shopify app development best practices
- Use Polaris components for embedded admin UI
- Proper session management and OAuth authentication
- Handle Shopify API rate limits with retry logic
- Use GraphQL Admin API (preferred over REST)
- Webhook verification (HMAC validation) for all handlers
- Error handling via Polaris Banner/Toast

**Theme Development:**
- Online Store 2.0 architecture (JSON templates, sections everywhere)
- Semantic, accessible Liquid code
- Proper section schema with settings types, defaults, and labels
- CSS custom properties for theme editor integration
- Progressive enhancement JavaScript; no render-blocking scripts

**Integration/Migration:**
- Idempotent webhook handlers
- Retry logic and data validation
- Rate limit awareness with queuing for bulk operations

**General:**
- ESLint/Prettier configured; no hardcoded secrets
- TypeScript types for Shopify API responses
- Unit tests for business logic; integration tests for API interactions

### Repository Standards

- Git with conventional commits
- Appropriate structure for project type (app/theme/integration)
- Include: README.md, .gitignore, .env.example, shopify.app.toml (for apps)
- No secrets or shop-specific data committed

### Deployment

- Apps: via Shopify CLI or hosting provider
- Themes: via Shopify CLI
- Integrations: cloud provider deployment
- Dev store setup guide; API scopes documented with justification

### Documentation

- Architecture/component diagram
- API scopes with justification
- Setup instructions with Shopify CLI commands
- Screenshots or screen recording
- Known limitations and Shopify API constraints

---

## Candidate Evaluation Rubric

| Dimension | Weight | Description |
|-----------|--------|-------------|
| **Shopify Platform Knowledge** | 25% | Correct API usage, platform conventions, ecosystem understanding |
| **Code Quality** | 20% | Clean, well-structured code following best practices |
| **Functionality** | 20% | All requirements met; edge cases handled |
| **Architecture & Design** | 15% | Thoughtful design; separation of concerns; scalability |
| **Testing & Reliability** | 10% | Unit/integration tests; error handling; webhook idempotency |
| **Documentation** | 10% | README; setup instructions; API scope justification |

### Scoring Scale

| Score | Level | Description |
|-------|-------|-------------|
| 5 | Exceptional | Production-ready; demonstrates expert platform knowledge |
| 4 | Strong | Meets all requirements; clean code; minor improvements possible |
| 3 | Satisfactory | Core requirements met; some best practices missed |
| 2 | Below Expectations | Incomplete features or incorrect API usage |
| 1 | Unsatisfactory | Major gaps; does not demonstrate competency |

---

## Submission Instructions

1. Push all code to a **private Git repository** and share access with reviewers
2. Include README.md with: architecture diagram, screenshots, setup instructions, API scopes with justification, known limitations
3. Be prepared for a **45-minute review session** covering: technical design walkthrough, live demo on dev store, Shopify-specific decisions, code review, scalability discussion
