# Windsurf Development Guide

## Shopify Bulk Product Editor App

> **Purpose**: This document is designed to be **Windsurf-friendly**. It provides full context, constraints, and step-by-step guidance so an AI coding assistant can help implement the solution **without re‑asking high-level questions**, while staying aligned with Shopify best practices and the evaluation rubric.

---

## 1. Project Context

This is a **technical assessment** for a **Shopify Engineer** role.

The goal is NOT to build a fully production‑ready app, but to:

* Demonstrate **correct Shopify platform usage**
* Show **strong architectural thinking**
* Use **Bulk Operations properly**
* Communicate constraints, tradeoffs, and decisions clearly

The reviewers explicitly evaluate:

* Thinking process
* Git history and commit quality
* Time management
* Platform knowledge (Shopify‑specific)

---

## 2. Hard Constraints (DO NOT VIOLATE)

These constraints come directly from Shopify or the assessment and must be respected:

1. **Bulk updates MUST use Shopify Bulk Operations**

   * Do NOT update products one by one
   * Use `bulkOperationRunMutation`

2. **Only one bulk operation can run per store at a time**

   * App must check for an existing active bulk operation

3. **Bulk operations are asynchronous**

   * Must poll status
   * Results are returned as a JSONL file

4. **Preview is a simulation, NOT a dry‑run mutation**

   * Shopify does not support mutation previews

5. **Undo is implemented via inverse operations**

   * NOT full product snapshots

6. **Scope is intentionally limited**

   * Do not expand beyond what is explicitly listed

---

## 3. Scope Definition (FINAL)

### In Scope (Must Be Implemented)

#### Core

* Embedded Shopify Admin app
* Node.js + TypeScript backend
* React + Polaris frontend
* SQLite database for operation history

#### Product Selection

* IndexTable with checkbox selection
* Basic filters:

  * Product status
  * Product tags

#### Bulk Operations

* **Bulk price adjustment** (CORE FEATURE)

  * Percentage increase/decrease
  * Executed via `bulkOperationRunMutation`

#### Preview

* Simulated preview (before / after)
* Highlighted diffs for price

#### Progress & Status

* Poll bulk operation state
* Display progress and final status

#### History

* Store executed operations
* Display past operations

#### Undo (Limited)

* Undo only for price adjustment
* Implemented as inverse bulk operation

---

### Explicitly Out of Scope

These must NOT be implemented (but should be documented):

* Full product versioning
* HTML description find‑and‑replace
* Metafield editing beyond basic design
* Parallel bulk operations
* Canceling an in‑progress bulk job
* Advanced search or collections logic

---

## 4. Tech Stack (Locked)

* Shopify Admin App (embedded)
* Shopify CLI
* Node.js + TypeScript
* React
* Shopify Polaris
* GraphQL Admin API
* SQLite

---

## 5. Architecture Overview

### Logical Flow

```
Admin (Shopify)
   ↓
Polaris UI (React)
   ↓
Node.js Backend
   ↓
Shopify GraphQL Admin API
   ↓
Bulk Operations Engine
   ↓
JSONL Result File
```

### Responsibilities

#### Frontend (Polaris)

* User input and validation
* Preview rendering
* Progress display
* Error and success feedback

#### Backend

* Authentication and session validation
* GraphQL queries and mutations
* Bulk operation orchestration
* Polling and status tracking
* Persistence (SQLite)

---

## 6. Data Model (SQLite – Minimal)

### Table: operations

Fields:

* id
* shop
* type (price_adjustment)
* payload (JSON)
* inverse_payload (JSON)
* status
* created_at

> Do NOT over‑engineer the schema.

---

## 7. Bulk Price Adjustment – Core Logic

### High-Level Steps

1. Fetch selected products (id + price)
2. Simulate new prices in memory
3. Return preview data to UI
4. On confirmation:

   * Build `bulkOperationRunMutation`
   * Submit bulk job
5. Poll job status
6. Persist operation metadata

### Notes for Implementation

* Use **GraphQL cost‑efficient queries**
* Never execute multiple bulk jobs simultaneously
* Store inverse mutation payload for undo

---

## 8. Preview Strategy (Important)

Preview must:

* Be fast
* Avoid API mutations
* Clearly show what will change

Implementation approach:

* Fetch current product prices
* Apply transformation in memory
* Compare before / after
* Highlight changed values

---

## 9. Undo Strategy

Undo is performed by:

* Executing a **new bulk operation**
* Using the inverse of the original transformation

Examples:

* +10% → −10%
* −5% → +5%

Never attempt full rollback or snapshot restore.

---

## 10. Rate Limits & Reliability

* Respect GraphQL cost limits
* Use polling with delay
* Handle partial failures
* Surface errors clearly to the UI

---

## 11. UX Expectations (Admin)

* Clarity > aesthetics
* Explicit confirmation before execution
* Clear indication when a job is running
* No silent failures

Use Polaris components:

* Page
* Card
* IndexTable
* Banner
* ProgressBar

---

## 12. Git & Development Rules

* Use **conventional commits**
* Small, focused commits
* No secrets committed
* `.env.example` required

Example commits:

* `docs: add technical design document`
* `feat: execute bulk price adjustment using bulk operations`

---

## 13. README Expectations (Final)

Final README must include:

* Objective
* Scope (in / out)
* Architecture overview
* Shopify API usage
* Setup instructions
* Known limitations

README is part of the evaluation.

---

## 14. What Reviewers Care About Most

In order of importance:

1. Correct Shopify bulk API usage
2. Architecture and reasoning
3. Code clarity and maintainability
4. Honest documentation
5. UX clarity

Completeness is secondary to correctness.

---

## 15. Guiding Principle

> This solution should look like something a senior Shopify engineer would confidently submit after time‑boxing a real‑world task.

When in doubt:

* Prefer clarity over cleverness
* Prefer platform‑aligned solutions
* Document tradeoffs explicitly

---

## End of Windsurf Guide
