---
type: Domain
title: OpenProject Response Shapes
description: How OpenProject's HAL+JSON responses actually vary in practice, and why the Zod schemas are strict only on the fields the UI reads.
resource: https://www.openproject.org/docs/api/
tags: [openproject, hal, zod, schemas]
timestamp: 2026-07-25T00:00:00Z
---

# OpenProject Response Shapes

Every response is Zod-parsed in the main process before crossing IPC (see
[IPC Contract](/contracts/ipc-contract.md)). A collection parse is
**all-or-nothing**: one unexpected element fails the whole request with
`OPENPROJECT_SCHEMA_FAILED`, so over-declaring a field is not a harmless
extra check — it's a way to lose an entire month of time entries, or every
search result, over data nothing reads.

Hence the rule the schemas in `src/main/schemas/` follow: **strict on what the
UI consumes, lenient on the rest.** The renderer reads only `id`, `subject`,
and `_links.status.title` off a work package.

## Variations seen on real instances

- **An unset resource link is `{ "href": null }`, not an omitted key.** HAL
  models "no assignee" / "no category" / "no parent" as a present link object
  with a null `href` (and usually a null `title`). Declaring `href:
  z.string()` therefore rejects every unassigned work package. Found when the
  picker's id search started returning items outside the user's own list —
  the priority list had hidden it, because the user's own work packages are
  assigned by definition.
- **`spentHours` is an ISO-8601 duration string** (`"PT3H30M"`) on current
  versions, a number on others. Accepted as either; nothing reads it.
- **Collection `_type` varies** — `"Collection"` or `"WorkPackageCollection"`
  depending on the instance and endpoint. Accepted as any string.
- **Formattables can be an object, a bare string, or `null`** — see
  `TimeEntryCommentSchema`.
- **A link's `title` is the referenced resource's display name**, so a time
  entry already carries its work package's subject
  (`_links.workPackage.title`). The edit form labels its picker from that
  rather than fetching the work package — an entry's item is rarely in the
  loaded suggestions, and there is no `getWorkPackage` bridge method.

## Searching by id prefix: two dead ends, then direct fetches

Both obvious approaches fail, which is why the picker looks the way it does:

1. **`subjectOrId` with `**` matches an id exactly** (or the digits inside a
   subject). `1234` finds #1234 and never #12345 — useless for typeahead over a
   5-digit id space.
2. **An `id` `=` filter over the enumerated candidate ids returns HTTP 400.**
   OpenProject validates those values against work packages that exist and are
   visible, and a prefix necessarily includes ids that don't exist.

What works: fetch the candidates directly. `searchWorkPackagesByIdPrefix` issues
one `GET /api/v3/work_packages/{id}` per candidate id, treating 404 as "not a
hit" and letting every other status propagate.

Because each candidate costs a request, the search minimum
(`WORK_PACKAGE_SEARCH_MIN_DIGITS`) equals the id length: a search fires only on
a whole id and resolves in exactly one request.
`expandWorkPackageIdPrefix` therefore returns a single id today — it's kept
because it's what makes a shorter minimum viable, at 10× the requests per digit
dropped (a 4-digit minimum means 11 requests per search).

## Diagnosing the next one

`parseWithSchema` logs the failing field path, the Zod issue code, and the
expected type (never values — the body may hold subjects, comments, and user
names, which `.opencode/rules/security.md` forbids logging). The
renderer-visible message stays generic on purpose, so the main-process console
is where a shape mismatch is identified.

HTTP 400 forwards OpenProject's own `message` (schema-declared field only, same
treatment as 422): a 400 describes the *query we built*, so hiding the reason
only hides our own bug. `Invalid query filters: …` is what an unsupported
filter, operator, or value looks like.

# Citations

- OpenProject API v3 docs — <https://www.openproject.org/docs/api/>
- HAL draft, resource links — <https://datatracker.ietf.org/doc/html/draft-kelly-json-hal>
