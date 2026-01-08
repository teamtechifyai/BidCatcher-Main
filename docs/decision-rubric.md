# Go/No-Go Decision Rubric

## Overview

The Go/No-Go decision system evaluates bid opportunities using deterministic, explainable rules. This document describes how scoring works and how to configure client-specific criteria.

## Scoring Process

```
┌─────────────────┐
│ Extracted Fields │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Apply Criteria  │ ◄── Each criterion has rules
│    Rules        │     that evaluate signals
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Calculate       │ ◄── score × weight for each
│ Weighted Scores │     criterion
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Compute Total   │ ◄── sum(weighted scores) /
│ Percentage      │     sum(max weighted scores)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Apply           │
│ Thresholds      │
└────────┬────────┘
         │
    ┌────┴────┬────────────┐
    ▼         ▼            ▼
┌──────┐  ┌─────────┐  ┌───────┐
│  GO  │  │ NEEDS   │  │ NO-GO │
│      │  │ REVIEW  │  │       │
└──────┘  └─────────┘  └───────┘
   ▲                       ▲
   │                       │
≥ 75%                   ≤ 25%
(configurable)     (configurable)
```

## Decision Outcomes

| Outcome | Threshold | Description |
|---------|-----------|-------------|
| `go` | ≥ autoQualifyThreshold | Automatically qualified for pursuit |
| `no_go` | ≤ autoDisqualifyThreshold | Automatically disqualified |
| `needs_review` | Between thresholds | Requires human review |

Default thresholds:
- Auto-qualify: 75%
- Auto-disqualify: 25%

## Criterion Types

### Boolean Criterion

Yes/No evaluation. Awards full points or zero.

```typescript
{
  criterionId: "bond_required",
  name: "Bonding Capacity Available",
  type: "boolean",
  weight: 2.0,
  maxPoints: 25,
  dependsOnSignals: ["bond_required", "bond_amount"],
  rules: [
    {
      signal: "bond_required",
      condition: "equals",
      value: "no",
      points: 25  // Full points if no bond required
    },
    {
      signal: "bond_amount",
      condition: "lte",
      value: 5000000,
      points: 25  // Full points if under $5M
    }
  ]
}
```

### Range Criterion

Graduated scoring based on value ranges.

```typescript
{
  criterionId: "project_size_fit",
  name: "Project Size Fit",
  type: "range",
  weight: 1.0,
  maxPoints: 20,
  dependsOnSignals: ["project_value_estimate"],
  rules: [
    { signal: "project_value_estimate", condition: "gte", value: 500000, points: 5 },
    { signal: "project_value_estimate", condition: "gte", value: 1000000, points: 10 },
    { signal: "project_value_estimate", condition: "gte", value: 2000000, points: 15 },
    { signal: "project_value_estimate", condition: "lte", value: 10000000, points: 5 }
  ]
}
```

## Rule Conditions

| Condition | Description | Example |
|-----------|-------------|---------|
| `equals` | Exact match (case-insensitive) | `"yes"`, `"Texas"` |
| `not_equals` | Not equal to value | `"no"` |
| `contains` | String contains substring | `"commercial"` |
| `not_contains` | String doesn't contain | `"residential"` |
| `gt` | Greater than (numeric) | `1000000` |
| `lt` | Less than (numeric) | `5000000` |
| `gte` | Greater than or equal | `500000` |
| `lte` | Less than or equal | `10000000` |
| `exists` | Value is not null/empty | - |
| `not_exists` | Value is null/empty | - |

## Weight System

Weights multiply the criterion's score contribution:

- Weight 0.5: Half importance
- Weight 1.0: Normal importance (default)
- Weight 2.0: Double importance
- Weight 5.0: Maximum importance

**Example calculation:**

| Criterion | Score | Max | Weight | Weighted Score | Weighted Max |
|-----------|-------|-----|--------|----------------|--------------|
| Service Area | 20 | 20 | 2.0 | 40 | 40 |
| Timeline | 15 | 15 | 1.5 | 22.5 | 22.5 |
| Project Size | 10 | 20 | 1.0 | 10 | 20 |
| Bonding | 0 | 25 | 2.0 | 0 | 50 |
| Relationship | 15 | 20 | 1.0 | 15 | 20 |
| **TOTAL** | | | | **87.5** | **152.5** |

**Score Percentage:** 87.5 / 152.5 = **57.4%** → `needs_review`

## Default Scoring Criteria

Every client starts with these baseline criteria:

| Criterion | Type | Weight | Max Points | Signals Used |
|-----------|------|--------|------------|--------------|
| Project in Service Area | boolean | 2.0 | 20 | project_location |
| Timeline Feasible | boolean | 1.5 | 15 | bid_due_date, start_date |
| Project Size Fit | range | 1.0 | 20 | project_value_estimate |
| Bonding Capacity | boolean | 2.0 | 25 | bond_required, bond_amount |
| GC/Owner Relationship | range | 1.0 | 20 | general_contractor, owner_name |

## Configuring Client Criteria

### Adding a New Criterion

```typescript
{
  criterionId: "trade_alignment",
  name: "Trade Packages Align",
  description: "Project includes our core trades",
  type: "boolean",
  weight: 1.5,
  maxPoints: 20,
  dependsOnSignals: ["trade_packages"],
  rules: [
    {
      signal: "trade_packages",
      condition: "contains",
      value: "concrete",
      points: 10
    },
    {
      signal: "trade_packages",
      condition: "contains",
      value: "structural steel",
      points: 10
    }
  ]
}
```

### Adjusting Thresholds

```typescript
scoring: {
  criteria: [...],
  autoQualifyThreshold: 80,   // Stricter qualification
  autoDisqualifyThreshold: 30, // More lenient disqualification
  alwaysRequireReview: false   // Or true to always require human review
}
```

## Human Override Process

When a human overrides an automated decision:

1. Original decision is preserved
2. Override record is created with:
   - Original outcome
   - New outcome
   - Who made the override
   - **Required** reason/explanation
   - Optional metadata
3. Bid status is updated

### Override Reasons (Examples)

- "GC is long-standing customer, relationship overrides score"
- "Project location actually within service area, geocoding error"
- "Bonding already secured for this project"
- "Timeline confirmed feasible after discussion with PM"
- "Project type not aligned with current strategic focus"

## Audit Trail

Every scoring decision maintains full traceability:

1. **Extraction records** - What was extracted, from which document, confidence level
2. **Decision records** - Full score breakdown, thresholds used, config version
3. **Override records** - Who, when, why, what changed

This enables:
- Compliance auditing
- Score calibration over time
- Debugging extraction/scoring issues
- Training new estimators

## Future Enhancements

Planned improvements (post-MVP):

1. **Historical calibration** - Adjust weights based on win/loss outcomes
2. **Signal correlation** - Identify which signals best predict success
3. **Team workload** - Factor current bid volume into scoring
4. **Competitor analysis** - Adjust based on known competition
5. **Seasonal patterns** - Time-based threshold adjustments


