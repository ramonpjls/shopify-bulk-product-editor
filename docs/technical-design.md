# Technical Design Document

## Bulk Product Editor App (Shopify Admin App)

### Author

Ramón Padilla

### Context

This document describes the technical approach, architecture, and design decisions for the **Bulk Product Editor App**, a custom Shopify Admin application that allows merchants to perform bulk updates on products using Shopify’s GraphQL Admin API and Bulk Operations.

The goal is to demonstrate correct platform usage, clear reasoning, and a maintainable, scalable solution rather than exhaustive feature coverage.

---

## 1. Problem Overview

Merchants often need to update large sets of products (prices, tags, status, etc.) efficiently. Performing these updates one product at a time is slow, error‑prone, and subject to Shopify API rate limits.

This app provides:

* Flexible product selection
* Safe preview of changes before execution
* Efficient bulk updates using Shopify Bulk Operations
* Operation history with undo capability

---

## 2. Scope Definition

### In‑Scope (Implemented / Designed)

* Embedded Shopify Admin app
* Product selection via filters (collection, tags, vendor, manual selection)
* Bulk operations using `bulkOperationRunMutation`
* Supported bulk actions:

  * Price adjustment (percentage / fixed)
  * Tag add / remove
  * Product status change (active / draft)
* Preview mode (simulated diff)
* Operation progress tracking
* Operation history
* Undo for supported operations

### Out‑of‑Scope (Documented Limitations)

* Complex find‑and‑replace across rich HTML descriptions
* Full product versioning snapshots
* Parallel execution of multiple bulk operations

These are intentionally excluded to keep the solution focused, reliable, and aligned with Shopify platform constraints.

---

## 3. High‑Level Architecture

### Components

1. **Admin UI (Frontend)**

   * Built with React and Shopify Polaris
   * Embedded inside Shopify Admin
   * Responsible for user interaction, previews, and progress feedback

2. **Application Backend**

   * Node.js + TypeScript
   * Handles authentication, business logic, and API communication
   * Acts as an orchestration layer for bulk operations

3. **Shopify Platform**

   * GraphQL Admin API
   * Bulk Operations engine

4. **Data Storage**

   * Lightweight persistence (SQLite / Postgres) for:

     * Operation metadata
     * Undo payloads
     * Execution status

---

## 4. Architecture Diagram (Logical)

[Shopify Admin]
       │
       ▼
[Polaris UI / React]
       │
       ▼
[Node.js Backend]
       │
       ├─ GraphQL Admin API
       │     ├─ Product queries
       │     └─ bulkOperationRunMutation
       │
       └─ Database (Operations / History)

---

## 5. Data Flow

### Bulk Operation Execution

1. Merchant selects products and an action
2. UI requests product data for preview
3. Backend simulates changes and returns diff
4. Merchant confirms execution
5. Backend submits `bulkOperationRunMutation`
6. Shopify processes operation asynchronously
7. Backend polls operation status
8. Results are stored and surfaced in UI

---

## 6. Bulk Operations Strategy

### Why Bulk Operations

* Shopify enforces strict API rate limits
* Bulk operations allow updating thousands of records efficiently
* Asynchronous execution avoids request bottlenecks

### Implementation Details

* Only **one bulk operation per shop** at a time
* Backend checks for active operations before starting a new one
* Results retrieved via JSONL output URL

---

## 7. Preview Strategy

Preview is implemented as a **simulation**, not a dry‑run mutation.

* Current product data is fetched via GraphQL
* Proposed changes are applied in memory
* Before/after values are compared
* Diffs are highlighted in the UI

This avoids unnecessary API usage and provides immediate feedback.

---

## 8. Undo Strategy

Undo is implemented using **inverse operations**, not full product snapshots.

Examples:

* Price +10% → Undo: −10%
* Add tag → Undo: remove tag
* Status active → Undo: draft

Undo actions are stored per operation and executed via a new bulk operation.

---

## 9. Rate Limit & Reliability Considerations

* GraphQL cost limits respected
* Bulk operations queued if another is in progress
* Retry logic with exponential backoff for transient failures
* Partial failures surfaced to the UI

---

## 10. Security & Authentication

* OAuth handled via Shopify CLI scaffolding
* Session tokens validated on every request
* API scopes limited to minimum required
* No secrets committed to repository

---

## 11. API Scopes (Justification)

* `read_products` – required for preview and selection
* `write_products` – required for bulk updates

No additional scopes are requested to minimize risk.

---

## 12. Testing Strategy

* Unit tests for transformation and undo logic
* Integration tests for GraphQL operations
* Manual testing on development store

---

## 13. Known Limitations

* Bulk operations are asynchronous and cannot be canceled mid‑execution
* Shopify allows only one active bulk operation per store
* Preview accuracy depends on data freshness

These limitations are inherent to the Shopify platform and are documented for transparency.

---

## 14. Conclusion

This design prioritizes:

* Correct Shopify platform usage
* Scalability and safety
* Clear user experience
* Maintainable and extensible architecture

The solution intentionally balances feature completeness with reliability and clarity, aligning with real‑world Shopify app development best practices.
