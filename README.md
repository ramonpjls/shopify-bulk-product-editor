# Bulk Product Editor App (Shopify Admin App)

## Overview

This project is a **custom Shopify Admin app** that allows merchants to safely perform **bulk updates on products** using Shopify’s **GraphQL Admin API and Bulk Operations**.

The app focuses on demonstrating:
- Correct usage of Shopify bulk operations
- Clear UX for admin workflows
- Thoughtful technical decision-making
- Proper handling of platform constraints (rate limits, async execution)

The implementation intentionally prioritizes **quality, reliability, and clarity** over exhaustive feature coverage.

---

## Objectives

- Enable merchants to select multiple products
- Apply bulk changes efficiently using Shopify Bulk Operations
- Provide a **preview** of changes before execution
- Track operation progress and results
- Allow **undo** for supported operations
- Demonstrate best practices for Shopify app development

---

## Implemented / Planned Features

### Product Selection
- Manual selection via table (IndexTable)
- Basic filters:
  - Product status
  - Product tags

### Bulk Operations
- Bulk price adjustment:
  - Percentage-based increase/decrease
  - Executed via `bulkOperationRunMutation`
- One active bulk operation per store (Shopify constraint)

### Preview Mode
- Simulated preview (no dry-run mutation)
- Before / after comparison for affected fields
- Highlighted differences for clarity

### Progress & Feedback
- Operation status tracking (CREATED, RUNNING, COMPLETED, FAILED)
- Visual progress indicator
- Clear success and error feedback

### Operation History
- List of executed bulk operations
- Metadata stored for auditing and undo

### Undo Support (Limited Scope)
- Undo implemented as **inverse operations**
- Currently supported for price adjustments only

---

## Out of Scope (By Design)

The following features are intentionally excluded to keep the solution focused and aligned with Shopify platform realities:

- Full product versioning or snapshots
- Complex find-and-replace for rich HTML descriptions
- Parallel execution of multiple bulk operations
- Canceling an in-progress bulk operation
- Advanced search or collection-based segmentation

These limitations are documented and discussed in the technical design.

---

## Technical Design

A detailed technical design document is available at:

