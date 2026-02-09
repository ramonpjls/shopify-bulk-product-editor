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

[Technical Design Document](docs/technical-design.md)

---

## Architecture Overview

### Components

1. **Frontend (React + Polaris)**
   - Embedded Shopify Admin UI
   - Product selection with filters
   - Preview and confirmation flows
   - Progress tracking and history

2. **Backend (Node.js + TypeScript)**
   - Shopify session management
   - GraphQL API communication
   - Bulk operation orchestration
   - SQLite persistence

3. **Database (SQLite)**
   - Operation metadata and history
   - Undo payloads
   - Status tracking

### Data Flow

```text
User Selection → Preview → Confirmation → Bulk Operation → Polling → Results → History
```

---

## Shopify API Usage

### Required Scopes

- `write_products` - Required for bulk product updates

### Key GraphQL Operations

- `bulkOperationRunMutation` - Execute bulk operations
- `productVariantsBulkUpdate` - Update variant prices
- Product queries with filters and pagination

### Bulk Operations Strategy

- **One operation per store** - Shopify platform constraint
- **Asynchronous execution** - Polling for status updates
- **JSONL file upload** - Efficient data transfer
- **Result processing** - Parse success/failure from JSONL

---

## Setup Instructions

### Prerequisites

- Node.js 20.19+ or 22.12+
- Shopify CLI
- Development store (for testing)

### Installation

1. **Clone and install dependencies**

   ```bash
   git clone <repository>
   cd bulk-product-editor
   npm install
   ```

2. **Configure environment**

   ```bash
   cp .env.example .env
   # Edit .env with your Shopify credentials
   ```

3. **Setup database**
   ```bash
   npm run setup
   ```

4. **Start development server**

   ```bash
   npm run dev
   ```

5. **Install app on development store**
   - Follow Shopify CLI prompts
   - Grant required permissions (`write_products`)

---

## Known Limitations

### Platform Constraints

- **One bulk operation at a time** per store (Shopify limitation)
- **Asynchronous execution** - operations cannot be cancelled once started
- **7-day result retention** - JSONL results expire after 7 days

### Implementation Scope

- **Price adjustments only** - Other bulk operations not implemented
- **Basic product filters** - Status and tags only
- **Undo for price adjustments** - Other operation types not supported

### Error Handling

- **Rate limits** - Respects Shopify API limits
- **Partial failures** - Individual product failures are tracked
- **Network resilience** - Retry logic with exponential backoff

---

## Development Notes

### Code Organization

- `/app/routes` - React Router pages and API endpoints
- `/app/services` - Business logic and Shopify API integration
- `/app/models` - Database operations (Prisma)
- `/docs` - Technical documentation

### Key Files

- `app/routes/app._index.tsx` - Main product selection and bulk operation UI
- `app/routes/app.history.tsx` - History and operation products tracking
- `app/services/bulk-operations.server.ts` - Shopify bulk operation handling
- `app/services/products.server.ts` - Product data and preview logic
- `app/models/operation.server.ts` - Database operations for history

### Testing Considerations

- Test with various product catalog sizes
- Verify bulk operation polling under different network conditions
- Validate undo operations create correct inverse payloads
- Ensure proper cleanup of expired operations

---

## Evaluation Criteria

This implementation demonstrates:

1. **Correct Shopify Platform Usage**
   - Proper bulk operation implementation
   - Respect for platform constraints
   - Efficient GraphQL queries

2. **Technical Architecture**
   - Clear separation of concerns
   - Scalable data model
   - Thoughtful error handling

3. **User Experience**
   - Clear preview before execution
   - Progress feedback during operations
   - Accessible history and undo

4. **Code Quality**
   - Type-safe TypeScript implementation
   - Comprehensive error handling
   - Maintainable code structure

5. **Honest Documentation**
   - Clear scope limitations
   - Known tradeoffs documented
   - Platform constraints acknowledged
