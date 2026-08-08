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

## Searching by title: local first, then `subjectOrId **`

The picker filters its preloaded priority list by subject substring, and only a
term matching **none** of it reaches the server — debounced 300ms (skipped when
the term's results are already cached), as
`filters=[{"subjectOrId":{"operator":"**","values":["…"]}}]`, no
assignee/status narrowing, `pageSize=50`, `sortBy=[["updatedAt","desc"]]`.

`**` is the quick-search operator: substring on the subject, **exact** on the
id. Three consequences, each of which has already bitten:

- **`#12345` must be normalized to `12345`** (`normalizeWorkPackageSearchTerm`)
  — it's how the app labels every option, and `**` would match the `#` form
  against nothing.
- **`sortBy` is not optional.** The default `id asc` means a capped page of a
  common term returns the *oldest* matches. The picker also surfaces `total`
  when it exceeds the page rather than implying it showed everything.
- **Exactness killed the id-*prefix* search** (`1234` finds #1234, never
  #12345). The fan-out that worked around it — `expandWorkPackageIdPrefix`,
  `searchWorkPackagesByIdPrefix`, one `GET /work_packages/{id}` per candidate —
  is deleted; a search is now an ordinary filtered collection, one round trip,
  nothing user-authored in a URL path. Still true if you revisit it: an `id` `=`
  filter over enumerated candidates 400s, because OpenProject validates those
  values against work packages that exist and are visible.

**A local hit hides the instance.** A term matching one of your own items never
loads the others — deliberate, but the first thing to revisit if users report a
work package they can't find. Merge the sources; don't drop the local pass.

## The work-package form endpoint

Two things the API docs imply but a real instance contradicts. Both were found
by probing `op.bigin.vn` before any schema was written, and both changed the
IPC signatures.

- **`POST /work_packages/{id}/form` requires `lockVersion` in the payload.** An
  empty `{}` body answers **HTTP 409**
  (`urn:openproject-org:api:v3:errors:UpdateConflict`), not 200 — so the usual
  "post an empty payload to read the schema" trick does not work here (it does
  for `time_entries/form`, which is why the two look different). The body is
  therefore exactly `{ lockVersion }` and nothing else, which keeps the security
  property intact: no renderer content is forwarded, so a read cannot become a
  write. Useful side effect — the query keys on the lock version, so a save
  rekeys it and a stale version surfaces as a conflict before the user types.
- **`GET /work_packages/{id}/available_assignees` does not exist — HTTP 404.**
  The assignee options are a **project** resource. The form's
  `assignee._links.allowedValues` is a single `{ href }` *object* (not an array,
  unlike `status`/`type`/`priority`) pointing at
  `/api/v3/projects/{projectId}/available_assignees`. So the renderer reads the
  project id off the work package's own `_links.project.href` and sends the
  number; that href is never followed, per the `shell.ts` rule of rebuilding
  every path in main. It also lets the form and assignee requests run in
  parallel, so one failing leaves the other's select working.

Also confirmed: `status`/`type`/`priority` each carry **both**
`_embedded.allowedValues` (full resources) and `_links.allowedValues`
(`{ href, title }[]`) — the same two-form pattern `extractActivitiesFromForm`
already handles. Every schema property carries `writable`, which is how a
work package scheduled automatically from its children reports that its dates
are derived and cannot be written. `subject` reports `maxLength: 255`; that
number is **hardcoded** in the input schema rather than read from the response,
because a server-reported limit cannot be a security boundary. Assignees may be
`Group` or `PlaceholderUser`, so the schema accepts any `_type` — but the editor
offers users only, since the PATCH builds `/api/v3/users/{id}` from a bare
number and cannot express a group href.

## Creating a work package

Probed the same way, and again three things the docs imply that the instance contradicts.

- **`GET /api/v3/projects` is the wrong list for a create form.** It answers with every project the key can *read*, which included one carrying no `_links.createWorkPackage` — visible, not creatable. The create form's own `project._links.allowedValues` points at **`GET /api/v3/work_packages/available_projects`**, which returns exactly the creatable subset in an identical `Collection` shape. `listProjects` reads that path, rebuilt in main from a constant rather than followed off the response.
- **`POST /projects/{id}/work_packages/form` needs no `lockVersion`** — an empty `{}` body answers 200, unlike the *edit* form, which 409s. So the create-form body is empty until a type is chosen, and one rebuilt href after.
- **`_embedded.payload._links` carries OpenProject's defaults** — type, status and priority. Prefilling from them is what leaves only project/type/subject genuinely required, and `schema.status.hasDefault` is `true` while `schema.type.hasDefault` is `false` even though the payload names a type.

Also verified: **a type the project disallows answers 200**, with the objection buried in `_embedded.validationErrors.type`, and the allowed-value lists *unchanged*. So a stale type after a project change produces a form that looks fine and a create that fails — which is why the reset is eager and lives in `resetProjectScopedFields` (named by what it keeps, so a new draft field is reset by default). Allowed values did not vary with the type sent on this instance, so the renderer keys the create form on the project alone.

**`description` is a Formattable, `format: "markdown"`, and the server does not police the format**: a payload with `format: "custom"` and an `html` of `<script>alert(1)</script>` validated **clean**. The format is therefore a main-process constant (`WORK_PACKAGE_DESCRIPTION_FORMAT`) on both the create and the update path, and `html` is never sent. Length is bounded in main too — OpenProject imposes no limit worth trusting.

The form endpoint doubles as a **validator**: POST a complete payload and it answers with `validationErrors` and a `_links.commit` pointing at the real `POST /api/v3/work_packages`, without persisting anything. That is how the create body was verified without creating a work package.

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
