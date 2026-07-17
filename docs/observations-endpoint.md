# POST /api/observations — lettuce/basil trait ingestion

Batch ingestion endpoint for the Pilot Basement camera-rail trait pipeline
(two RealSense D435 rails: Floor 1 = lettuce = `rail1`, Floor 2 = basil =
`rail2`). An off-platform GPU box analyses each rail's scan cycle locally —
images stay there; only trait records (and, occasionally, a representative
photo already uploaded via `/api/agent/photo`) travel to the platform.

This is a new, additive route. It does not touch `Photo`, `/api/agent/photo`,
`/api/analysis/pending`, or `/api/analysis/results` — those remain exactly as
they are for mushroom/microgreen farms. Any `zoneId` other than Pilot
Basement's two rail zones is rejected before anything is written.

## Auth

Bearer API key, identical mechanism to every other agent/analysis route:

```
Authorization: Bearer agv_...
```

The key must belong to the organization that owns `zoneId` (and, if the key
is farm-scoped, to that farm). Use the same Pilot Basement API key already
issued per zone by `scripts/20260705_create_pilot_basement.ts`.

## Request

`POST /api/observations`

```json
{
  "zoneId": "cmr83i8mv0005apc9ftndmn3n",
  "records": [
    {
      "rail": "rail1",
      "cycle_id": "2026-07-16_12-27-24",
      "site_id": "row06_ch2",
      "global_row": 6,
      "channel": 2,
      "stop": 6,
      "view_angle_deg": 0.0,
      "is_primary_view": true,
      "captured_at": "2026-07-16_12-27-24",
      "plant_present": false,
      "reject_reason": "no_green",
      "area_px": 0,
      "area_cm2": null,
      "canopy_volume_cm3": null,
      "height_mm_max": null,
      "height_mm_mean": null,
      "height_profile_mm": null,
      "coverage": 0.0,
      "exg_mean": null,
      "deep_green_frac": null,
      "depth_valid_pct": null,
      "clipped_by_roi": null,
      "channel_plane_mm": 411.0,
      "fx": 619.28,
      "schema": 2
    }
  ]
}
```

- `zoneId` — one of Pilot Basement's two rail zones. `records[].rail` must
  match the rail that zone is configured for (`rail1` for Floor 1, `rail2`
  for Floor 2) — a mismatched `rail` fails just that record, not the batch.
- `records` — up to 500 per call. One rail's full cycle (~132 records: up to
  4 per site — 3 view angles + 1 FUSED) fits in a single POST.
- Keys are **snake_case**, matching the Python producer's native naming — the
  route converts to the platform's camelCase columns. Nothing on the Python
  side needs to know about that convention.
- Fused records: send `"view_angle_deg": "fused"` (or `"is_fused": true`
  explicitly) plus `n_views_fused`, `fusion_gain_pct`, and the `fused_*`
  trait values in the same field names as the per-view record (e.g. send the
  fused canopy volume as `canopy_volume_cm3`, not a separately-named field).
- `captured_at` — format `YYYY-MM-DD_HH-MM-SS`, treated as **UTC**. If your
  GPU box's clock is local time (Europe/Stockholm), convert before sending —
  the platform does not currently apply a timezone offset here.
- `photo_id` — optional, only for the few representative images per cycle.
  Must already exist (uploaded separately via `/api/agent/photo`) and belong
  to the same zone, or that record is rejected.
- Traits not yet computed/calibrated (currently: fresh weight) should be
  omitted or sent `null` — the endpoint forces `freshWeightGEst` to `null`
  server-side regardless of what's sent, since no calibration pass exists
  yet.

## Response

`201` if every record succeeded, `207` (multi-status) if some failed —
the batch always processes every record; one bad row never sinks the rest.

```json
{
  "zoneId": "cmr83i8mv0005apc9ftndmn3n",
  "rail": "rail1",
  "batchId": null,
  "received": 132,
  "ok": 131,
  "failed": 1,
  "results": [
    { "index": 0, "siteId": "row06_ch2", "cycleId": "2026-07-16_12-27-24", "viewAngleDeg": 0.0, "status": "ok", "id": "cm..." },
    { "index": 47, "status": "error", "error": "rail mismatch: zone is configured for \"rail1\", record has rail=\"rail2\"" }
  ]
}
```

`batchId` is resolved server-side from the zone's active batch (same helper
`/api/agent/photo` uses) — `null` is normal until a `LEAFY_GREEN` batch is
planted in that zone.

## Idempotency

Re-posting the same cycle is safe. Records are keyed on
`(rail, cycleId, siteId, viewAngleDeg, isFused)` — a repeat post updates the
existing row in place rather than duplicating it. Useful for retries after a
network error on the GPU box's side.

## Gotchas

**The FUSED row's uniqueness depends on a constraint that doesn't live in
`schema.prisma`.** The FUSED record (`view_angle_deg: "fused"`) is stored with
`viewAngleDeg = NULL`. Ordinary Postgres `UNIQUE` treats every `NULL` as
distinct from every other `NULL`, so a plain unique constraint on
`(rail, cycleId, siteId, viewAngleDeg, isFused)` would **not** dedupe fused
rows — every repost of a cycle would silently insert a new duplicate fused
row (the one carrying the best data — the 3-view 3D reconstruction).

The real fix is `NULLS NOT DISTINCT` (Postgres 15+; this DB is 17.10), added
by hand in
`prisma/migrations/20260717115014_add_site_observation_and_leafy_green/migration.sql`.
It is **not** expressible in Prisma's schema DSL as of Prisma 7.5
(`@@unique(..., nullsNotDistinct: true)` fails validation), so
`schema.prisma`'s `@@unique` for `SiteObservation` is a plain-UNIQUE
stand-in — present only so Prisma Client has a typed key to `upsert` against.
It does **not** describe the real constraint.

**Why this is fragile:** `prisma migrate dev`'s shadow-DB diffing is
currently broken in this repo (the baseline migration,
`20260712190829_baseline`, has a corrupted first line — a stray `dotenv`
console log instead of SQL). If that's ever fixed and someone regenerates
migrations from `schema.prisma` again, Prisma will see the plain-UNIQUE
stand-in and propose "fixing" the real index back to a plain `UNIQUE` —
silently reintroducing fused-row duplication, with no error anywhere.

**The guard:** `src/app/api/observations/route.test.ts` posts a fused record
twice and asserts exactly one row exists. If that test starts failing after
a migration regeneration, this is why — check the live index:

```sql
SELECT pg_get_indexdef(indexrelid) FROM pg_index
WHERE indrelid = '"SiteObservation"'::regclass;
```

and confirm `NULLS NOT DISTINCT` is still present. If a regenerated
migration dropped it, hand-add it back to the `CREATE UNIQUE INDEX`
statement before applying.

## Example curl

```bash
curl -X POST https://your-app.vercel.app/api/observations \
  -H "Authorization: Bearer $WORKER_API_KEY" \
  -H "Content-Type: application/json" \
  -d @cycle_2026-07-16_12-27-24_rail1.json
```

where the file is `{"zoneId": "...", "records": [...]}`.

## The query this exists to serve

```sql
SELECT "capturedAt", "canopyVolumeCm3"
FROM "SiteObservation"
WHERE "siteId" = 'row06_ch2' AND "capturedAt" > now() - interval '8 weeks'
ORDER BY "capturedAt";
```

Indexed via `@@index([siteId, capturedAt])` — a per-plant time series
without scanning JSON.
