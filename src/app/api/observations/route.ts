import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateApiKey } from "@/lib/api-key";
import { getActiveBatchId } from "@/lib/active-batch";
import { railForZone } from "@/lib/rail-zones";

// Batch trait ingestion for the Pilot Basement lettuce/basil pipeline. One
// call per (rail, cycle) — up to ~132 records (site x view-angle, plus one
// FUSED record per site). Deliberately separate from the Photo-centric agent
// routes and the (photoId -> detection) inference-worker contract: neither
// of those can express "one row per (rail, cycleId, siteId, viewAngleDeg)"
// or serve the per-site time-series query this table exists for.
//
// Scope: only zoneIds present in RAIL_ZONE_MAP (Pilot Basement's two rail
// zones) are accepted — every mushroom/microgreen zone is rejected up front,
// so this route cannot affect any other farm's data.

const MAX_RECORDS_PER_REQUEST = 500;

type RawRecord = Record<string, unknown>;

type ParsedRecord = {
  rail: string;
  cycleId: string;
  siteId: string;
  globalRow: number;
  channel: number;
  stop: number;
  viewAngleDeg: number | null;
  isFused: boolean;
  isPrimaryView: boolean;
  nViewsFused: number | null;
  fusionGainPct: number | null;
  capturedAt: Date;
  plantPresent: boolean;
  rejectReason: string | null;
  areaPx: number | null;
  areaCm2: number | null;
  canopyVolumeCm3: number | null;
  heightMmMax: number | null;
  heightMmMean: number | null;
  heightProfileMm: unknown;
  widthMm: number | null;
  lengthMm: number | null;
  coverage: number | null;
  exgMean: number | null;
  exgStd: number | null;
  labAMean: number | null;
  deepGreenFrac: number | null;
  depthValidPct: number | null;
  clippedByRoi: boolean | null;
  channelPlaneMm: number | null;
  fx: number | null;
  calibrationVersion: string | null;
  schemaVersion: number;
  photoId: string | null;
};

class RecordError extends Error {}

function reqString(rec: RawRecord, key: string): string {
  const v = rec[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new RecordError(`"${key}" is required and must be a non-empty string`);
  }
  return v;
}

function reqInt(rec: RawRecord, key: string): number {
  const v = rec[key];
  if (typeof v !== "number" || !Number.isFinite(v) || !Number.isInteger(v)) {
    throw new RecordError(`"${key}" is required and must be an integer`);
  }
  return v;
}

function reqBool(rec: RawRecord, key: string): boolean {
  const v = rec[key];
  if (typeof v !== "boolean") {
    throw new RecordError(`"${key}" is required and must be a boolean`);
  }
  return v;
}

function optFloat(rec: RawRecord, key: string): number | null {
  const v = rec[key];
  if (v === null || v === undefined) return null;
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new RecordError(`"${key}" must be a number or null`);
  }
  return v;
}

function optInt(rec: RawRecord, key: string): number | null {
  const v = rec[key];
  if (v === null || v === undefined) return null;
  if (typeof v !== "number" || !Number.isFinite(v) || !Number.isInteger(v)) {
    throw new RecordError(`"${key}" must be an integer or null`);
  }
  return v;
}

function optString(rec: RawRecord, key: string): string | null {
  const v = rec[key];
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") {
    throw new RecordError(`"${key}" must be a string or null`);
  }
  return v;
}

function optBool(rec: RawRecord, key: string): boolean | null {
  const v = rec[key];
  if (v === null || v === undefined) return null;
  if (typeof v !== "boolean") {
    throw new RecordError(`"${key}" must be a boolean or null`);
  }
  return v;
}

// Producer format: "2026-07-16_12-27-24". Treated as UTC wall-clock (no
// timezone marker is sent) — confirm this matches the GPU box's clock before
// relying on capturedAt for cross-rail cycle alignment.
function parseCapturedAt(raw: string): Date {
  const m = /^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) {
    throw new RecordError(
      `"captured_at" must match "YYYY-MM-DD_HH-MM-SS", got ${JSON.stringify(raw)}`
    );
  }
  const [, datePart, hh, mm, ss] = m;
  const date = new Date(`${datePart}T${hh}:${mm}:${ss}Z`);
  if (Number.isNaN(date.getTime())) {
    throw new RecordError(`"captured_at" is not a valid date: ${JSON.stringify(raw)}`);
  }
  return date;
}

function parseRecord(rec: RawRecord): ParsedRecord {
  const rail = reqString(rec, "rail");
  const rawViewAngle = rec["view_angle_deg"];
  const isFusedExplicit = rec["is_fused"];
  const isFused =
    typeof isFusedExplicit === "boolean" ? isFusedExplicit : rawViewAngle === "fused";

  let viewAngleDeg: number | null;
  if (isFused) {
    viewAngleDeg = null;
  } else {
    if (typeof rawViewAngle !== "number" || !Number.isFinite(rawViewAngle)) {
      throw new RecordError(
        `"view_angle_deg" must be a number (or "fused" with is_fused=true), got ${JSON.stringify(rawViewAngle)}`
      );
    }
    viewAngleDeg = rawViewAngle;
  }

  return {
    rail,
    cycleId: reqString(rec, "cycle_id"),
    siteId: reqString(rec, "site_id"),
    globalRow: reqInt(rec, "global_row"),
    channel: reqInt(rec, "channel"),
    stop: reqInt(rec, "stop"),
    viewAngleDeg,
    isFused,
    isPrimaryView: reqBool(rec, "is_primary_view"),
    nViewsFused: optInt(rec, "n_views_fused"),
    fusionGainPct: optFloat(rec, "fusion_gain_pct"),
    capturedAt: parseCapturedAt(reqString(rec, "captured_at")),
    plantPresent: reqBool(rec, "plant_present"),
    rejectReason: optString(rec, "reject_reason"),
    areaPx: optInt(rec, "area_px"),
    areaCm2: optFloat(rec, "area_cm2"),
    canopyVolumeCm3: optFloat(rec, "canopy_volume_cm3"),
    heightMmMax: optFloat(rec, "height_mm_max"),
    heightMmMean: optFloat(rec, "height_mm_mean"),
    heightProfileMm: rec["height_profile_mm"] ?? null,
    widthMm: optFloat(rec, "width_mm"),
    lengthMm: optFloat(rec, "length_mm"),
    coverage: optFloat(rec, "coverage"),
    exgMean: optFloat(rec, "exg_mean"),
    exgStd: optFloat(rec, "exg_std"),
    labAMean: optFloat(rec, "lab_a_mean"),
    deepGreenFrac: optFloat(rec, "deep_green_frac"),
    depthValidPct: optFloat(rec, "depth_valid_pct"),
    clippedByRoi: optBool(rec, "clipped_by_roi"),
    channelPlaneMm: optFloat(rec, "channel_plane_mm"),
    fx: optFloat(rec, "fx"),
    calibrationVersion: optString(rec, "calibration_version"),
    schemaVersion: reqInt(rec, "schema"),
    photoId: optString(rec, "photo_id"),
  };
}

export async function POST(request: NextRequest) {
  const { error, apiKey } = await validateApiKey(request);
  if (error) return error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }
  const { zoneId, records } = body as { zoneId?: unknown; records?: unknown };

  if (typeof zoneId !== "string" || zoneId.length === 0) {
    return NextResponse.json({ error: "zoneId is required" }, { status: 400 });
  }
  if (!Array.isArray(records) || records.length === 0) {
    return NextResponse.json({ error: "records must be a non-empty array" }, { status: 400 });
  }
  if (records.length > MAX_RECORDS_PER_REQUEST) {
    return NextResponse.json(
      { error: `records exceeds max batch size of ${MAX_RECORDS_PER_REQUEST}` },
      { status: 400 }
    );
  }

  // Tenancy: zone must belong to the key's org (and farm, if the key is
  // farm-scoped) — same boundary every other agent/analysis route enforces.
  const zone = await prisma.zone.findUnique({
    where: { id: zoneId },
    include: { farm: true },
  });
  if (
    !zone ||
    zone.farm.organizationId !== apiKey!.organizationId ||
    (apiKey!.farmId && zone.farmId !== apiKey!.farmId)
  ) {
    return NextResponse.json({ error: "Zone not found or access denied" }, { status: 403 });
  }

  // Feature scope: only Pilot Basement's two rail zones are configured.
  // Any other zone (all mushroom/microgreen zones) is rejected here —
  // nothing past this point can touch their data.
  const expectedRail = railForZone(zoneId);
  if (!expectedRail) {
    return NextResponse.json(
      { error: "zoneId is not configured for trait ingestion" },
      { status: 400 }
    );
  }

  // Resolved once per request (single zone) via the same helper
  // /api/agent/photo uses — null is acceptable if no batch is active yet.
  let batchId: string | null = null;
  try {
    batchId = await getActiveBatchId(zoneId);
  } catch (err) {
    console.error("getActiveBatchId failed, writing observations unstamped:", err);
  }

  // Pre-validate any referenced photoIds belong to this zone, in one query.
  const requestedPhotoIds = Array.from(
    new Set(
      (records as RawRecord[])
        .map((r) => (typeof r?.["photo_id"] === "string" ? (r["photo_id"] as string) : null))
        .filter((v): v is string => v !== null)
    )
  );
  const validPhotoIds = requestedPhotoIds.length
    ? new Set(
        (
          await prisma.photo.findMany({
            where: { id: { in: requestedPhotoIds }, zoneId },
            select: { id: true },
          })
        ).map((p) => p.id)
      )
    : new Set<string>();

  const results: Array<{
    index: number;
    siteId?: string;
    cycleId?: string;
    viewAngleDeg?: number | null;
    status: "ok" | "error";
    id?: string;
    error?: string;
  }> = [];

  for (let index = 0; index < records.length; index++) {
    const raw = records[index];
    try {
      if (typeof raw !== "object" || raw === null) {
        throw new RecordError("record must be a JSON object");
      }
      const parsed = parseRecord(raw as RawRecord);

      if (parsed.rail !== expectedRail) {
        throw new RecordError(
          `rail mismatch: zone is configured for "${expectedRail}", record has rail="${parsed.rail}"`
        );
      }

      if (parsed.photoId && !validPhotoIds.has(parsed.photoId)) {
        throw new RecordError(`photo_id "${parsed.photoId}" not found in this zone`);
      }

      // Idempotency. The real Postgres index behind this unique constraint
      // is declared NULLS NOT DISTINCT (see the migration SQL — Prisma's
      // schema DSL can't express that keyword, so the @@unique in
      // schema.prisma is a plain UNIQUE for typing purposes only), so the DB
      // itself correctly treats the FUSED row's null viewAngleDeg as
      // participating in uniqueness.
      //
      // That DB guarantee is NOT reachable through Prisma's typed upsert()
      // for the FUSED row, though — verified empirically (this is not a
      // guess): Prisma's client rejects a compound-unique `where` with a
      // null member at RUNTIME ("Argument `viewAngleDeg` must not be null"),
      // before any SQL is even sent, regardless of the underlying index.
      // Non-fused rows (numeric viewAngleDeg) go through upsert() normally;
      // the FUSED row (viewAngleDeg null) takes the findFirst+create/update
      // branch below instead — plain `where` filters DO accept null,
      // unlike the compound-unique input. Not atomic under truly concurrent
      // duplicate posts of the exact same fused record, which this
      // single-producer, sequential pipeline never does.
      const data = {
        zoneId,
        batchId,
        photoId: parsed.photoId,
        rail: parsed.rail,
        cycleId: parsed.cycleId,
        siteId: parsed.siteId,
        globalRow: parsed.globalRow,
        channel: parsed.channel,
        stop: parsed.stop,
        viewAngleDeg: parsed.viewAngleDeg,
        isFused: parsed.isFused,
        isPrimaryView: parsed.isPrimaryView,
        nViewsFused: parsed.nViewsFused,
        fusionGainPct: parsed.fusionGainPct,
        capturedAt: parsed.capturedAt,
        plantPresent: parsed.plantPresent,
        rejectReason: parsed.rejectReason,
        areaPx: parsed.areaPx,
        areaCm2: parsed.areaCm2,
        canopyVolumeCm3: parsed.canopyVolumeCm3,
        heightMmMax: parsed.heightMmMax,
        heightMmMean: parsed.heightMmMean,
        heightProfileMm: parsed.heightProfileMm as never,
        widthMm: parsed.widthMm,
        lengthMm: parsed.lengthMm,
        coverage: parsed.coverage,
        exgMean: parsed.exgMean,
        exgStd: parsed.exgStd,
        labAMean: parsed.labAMean,
        deepGreenFrac: parsed.deepGreenFrac,
        depthValidPct: parsed.depthValidPct,
        clippedByRoi: parsed.clippedByRoi,
        channelPlaneMm: parsed.channelPlaneMm,
        fx: parsed.fx,
        // Not calibrated yet — forced null regardless of what a producer
        // sends, so an uncalibrated estimate can never land in this column.
        freshWeightGEst: null,
        calibrationVersion: parsed.calibrationVersion,
        schemaVersion: parsed.schemaVersion,
      };

      let row;
      if (parsed.viewAngleDeg === null) {
        // FUSED row — see the comment above. Ordinary findFirst (unlike the
        // compound-unique upsert input) accepts a null filter value fine.
        const existing = await prisma.siteObservation.findFirst({
          where: {
            rail: parsed.rail,
            cycleId: parsed.cycleId,
            siteId: parsed.siteId,
            viewAngleDeg: null,
            isFused: parsed.isFused,
          },
          select: { id: true },
        });
        row = existing
          ? await prisma.siteObservation.update({ where: { id: existing.id }, data })
          : await prisma.siteObservation.create({ data });
      } else {
        row = await prisma.siteObservation.upsert({
          where: {
            rail_cycleId_siteId_viewAngleDeg_isFused: {
              rail: parsed.rail,
              cycleId: parsed.cycleId,
              siteId: parsed.siteId,
              viewAngleDeg: parsed.viewAngleDeg,
              isFused: parsed.isFused,
            },
          },
          create: data,
          update: data,
        });
      }

      results.push({
        index,
        siteId: parsed.siteId,
        cycleId: parsed.cycleId,
        viewAngleDeg: parsed.viewAngleDeg,
        status: "ok",
        id: row.id,
      });
    } catch (err) {
      const message = err instanceof RecordError ? err.message : "Internal error processing record";
      if (!(err instanceof RecordError)) {
        console.error(`Observation ingest error at index ${index}:`, err);
      }
      results.push({ index, status: "error", error: message });
    }
  }

  const ok = results.filter((r) => r.status === "ok").length;
  const failed = results.length - ok;

  return NextResponse.json(
    { zoneId, rail: expectedRail, batchId, received: records.length, ok, failed, results },
    { status: failed === 0 ? 201 : 207 }
  );
}
