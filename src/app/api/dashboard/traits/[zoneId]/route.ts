import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

// Daily rollup of camera-rail trait data (SiteObservation) for one zone.
// READ-ONLY, computed live on each request — no materialized table, no writes.
// Traits read from the URL (floor) zone directly (SiteObservation.zoneId is
// stored per row); this route deliberately does NOT follow Zone.climateZoneId.
//
// MEASURED traits only. freshWeightGEst / any mass estimate is never surfaced —
// the volume->mass law isn't fitted for basil/seedlings yet.

// COVERAGE UNITS: `SiteObservation.coverage` has no documented unit. We assume
// a 0–1 fraction and render it as a percentage (×100). If a value sanity-check
// shows it's already 0–100, flip this single constant to false.
const COVERAGE_IS_FRACTION = true;

const RANGE_MS: Record<string, number> = {
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
};

// date_trunc('day', "capturedAt") groups by UTC calendar day WITHOUT an
// `AT TIME ZONE` shift: capturedAt is stored as a naive timestamp holding UTC
// wall-clock (the ingest route parses "YYYY-MM-DD_HH-MM-SS" as ...Z), so a
// plain truncation already yields the UTC day. Adding AT TIME ZONE would
// double-shift it.

type DailyRow = {
  day: Date;
  plant_count: number;
  vol_median: number | null;
  vol_p90: number | null;
  height_mean_median_mm: number | null;
  height_max_mean_mm: number | null;
  coverage_mean: number | null;
};

type SiteRow = {
  site_id: string;
  day: Date;
  vol: number | null;
  h_mean: number | null;
  h_max: number | null;
  cov: number | null;
  plant_present: boolean;
};

function toCoveragePct(raw: number | null): number | null {
  if (raw === null) return null;
  return COVERAGE_IS_FRACTION ? raw * 100 : raw;
}
function mmToCm(raw: number | null): number | null {
  return raw === null ? null : raw / 10;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ zoneId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { zoneId } = await params;
    const range = request.nextUrl.searchParams.get("range") || "30d";

    // Verify zone belongs to user's org — same tenancy boundary as the other
    // dashboard routes. Traits use the URL zone (no climate-link resolution).
    const zone = await prisma.zone.findUnique({
      where: { id: zoneId },
      include: { farm: true },
    });
    if (!zone || zone.farm.organizationId !== session.user.organizationId) {
      return NextResponse.json({ error: "Zone not found" }, { status: 404 });
    }

    const since = new Date(Date.now() - (RANGE_MS[range] || RANGE_MS["30d"]));

    // One REPRESENTATIVE row per (day, site), then aggregate across sites per
    // day: the NADIR view only (isFused = false, |viewAngleDeg| < 5).
    //
    // This used to prefer the fused row, falling back to the least-oblique
    // view. That was a fix for an earlier bug (filtering isFused = true alone
    // discarded ~96% of rows) but it overshot in two ways, both measured on
    // 2026-09-06:
    //
    //   1. It counted plants that do not exist. Fused rows are emitted even
    //      for `nViewsFused = 1` — a single oblique view relabelled, not a
    //      fusion — including for `row00_*` / `row12_*`, which are not in the
    //      nadir site map at all (they sit beyond the rail ends and are only
    //      ever seen at -19.3 deg / +16.7 deg). Floor 1 reported 39-42 plants
    //      against `plantCount = 34`. Nadir-only reports exactly 34, every day.
    //   2. Fused geometry is inflated ~2x by a known world-registration error
    //      (fused area 35.4 cm2 vs 17.2 nadir on the same plants, same hour),
    //      so the chart was showing the least trustworthy geometry available.
    //
    // Master file 7.6 already prescribes nadir for lettuce, and
    // CANONICAL_GROWTH_QUERY in src/lib/fusion-traits.ts is this same
    // selection. Upright crops (basil) may eventually want fused volume, but
    // not before the registration fix — and then it must gate on
    // `nViewsFused = 3`, never on `isFused` alone.
    //
    // Ordering within the day: prefer a row that detected a plant, then the
    // latest capture. Every candidate row is already nadir, so there is no
    // angle tiebreak left to make.
    const dailyP = prisma.$queryRaw<DailyRow[]>`
      WITH rep AS (
        SELECT DISTINCT ON (date_trunc('day', "capturedAt"), "siteId")
          date_trunc('day', "capturedAt") AS day,
          "plantPresent" AS plant_present,
          "canopyVolumeCm3" AS vol,
          "heightMmMean"    AS h_mean,
          "heightMmMax"     AS h_max,
          "coverage"        AS cov
        FROM "SiteObservation"
        WHERE "zoneId" = ${zoneId} AND "capturedAt" >= ${since}
          AND "isFused" = false AND abs("viewAngleDeg") < 5
        ORDER BY date_trunc('day', "capturedAt"), "siteId",
                 "plantPresent" DESC, "capturedAt" DESC
      )
      SELECT
        day,
        COUNT(*) FILTER (WHERE plant_present)::int AS plant_count,
        (percentile_cont(0.5) WITHIN GROUP (ORDER BY vol) FILTER (WHERE plant_present))::float AS vol_median,
        -- p90, not MAX. Both of these aggregate ACROSS sites, so a single bad
        -- record defines the whole day: one 2026-09-05 rail2 record read
        -- 4742 cm2 off 12% valid depth and moved its cycle mean from a median
        -- of 24.6 to 144. MAX(vol) was visibly non-monotonic on Floor 1
        -- (85 -> 127 -> 168 -> 141 -> 132 -> 237 -> 476) while p90 rose
        -- smoothly (39.9 -> 350.4). MAX(h_max) was worse still: 21-23 cm for
        -- two-week-old lettuce whose median plant is 3-5 cm.
        (percentile_cont(0.9) WITHIN GROUP (ORDER BY vol) FILTER (WHERE plant_present))::float AS vol_p90,
        (percentile_cont(0.5) WITHIN GROUP (ORDER BY h_mean) FILTER (WHERE plant_present))::float AS height_mean_median_mm,
        (AVG(h_max) FILTER (WHERE plant_present))::float AS height_max_mean_mm,
        (AVG(cov) FILTER (WHERE plant_present))::float AS coverage_mean
      FROM rep
      GROUP BY day
      ORDER BY day ASC
    `;

    // The separate "nadir volume" query that used to live here has been
    // removed: the rollup above IS nadir now, so it computed the same number
    // from the same rows. Keeping a second query called "nadir" beside a
    // nadir rollup invited exactly the confusion it was meant to resolve.

    // Per-site daily series for drill-down. Same nadir-only selection as the
    // rollup, so the table and the chart cannot disagree — previously this
    // was fused-preferred while the chart aggregated fused rows too, and both
    // silently showed ~2x-inflated fused geometry.
    const sitesP = prisma.$queryRaw<SiteRow[]>`
      SELECT DISTINCT ON (date_trunc('day', "capturedAt"), "siteId")
        "siteId" AS site_id,
        date_trunc('day', "capturedAt") AS day,
        "canopyVolumeCm3"::float AS vol,
        "heightMmMean"::float    AS h_mean,
        "heightMmMax"::float     AS h_max,
        "coverage"::float        AS cov,
        "plantPresent"           AS plant_present
      FROM "SiteObservation"
      WHERE "zoneId" = ${zoneId} AND "capturedAt" >= ${since}
        AND "isFused" = false AND abs("viewAngleDeg") < 5
      ORDER BY date_trunc('day', "capturedAt"), "siteId",
               "plantPresent" DESC, "capturedAt" DESC
    `;

    const [dailyRows, siteRows] = await Promise.all([dailyP, sitesP]);

    const days = dailyRows.map((r) => ({
      day: new Date(r.day).toISOString(),
      plantCount: r.plant_count,
      volMedianCm3: r.vol_median,
      volP90Cm3: r.vol_p90,
      heightMeanMedianCm: mmToCm(r.height_mean_median_mm),
      heightMaxMeanCm: mmToCm(r.height_max_mean_mm),
      coveragePct: toCoveragePct(r.coverage_mean),
    }));

    // Group per-site rows into series + a latest-point summary with a simple
    // trend (latest vs previous point that has a volume).
    type SitePoint = {
      day: string;
      volumeCm3: number | null;
      heightCm: number | null;
      heightMaxCm: number | null;
      coveragePct: number | null;
      plantPresent: boolean;
    };
    const bySite = new Map<string, SitePoint[]>();
    for (const r of siteRows) {
      const arr = bySite.get(r.site_id) ?? [];
      arr.push({
        day: new Date(r.day).toISOString(),
        volumeCm3: r.vol,
        heightCm: mmToCm(r.h_mean),
        heightMaxCm: mmToCm(r.h_max),
        coveragePct: toCoveragePct(r.cov),
        plantPresent: r.plant_present,
      });
      bySite.set(r.site_id, arr);
    }

    const sites = Array.from(bySite.entries())
      .map(([siteId, series]) => {
        series.sort((a, b) => +new Date(a.day) - +new Date(b.day));
        const withVol = series.filter((s) => s.volumeCm3 !== null);
        const latest = withVol[withVol.length - 1] ?? null;
        const prev = withVol[withVol.length - 2] ?? null;
        let trend: "up" | "down" | "flat" | null = null;
        if (
          latest &&
          prev &&
          latest.volumeCm3 !== null &&
          prev.volumeCm3 !== null
        ) {
          const delta = latest.volumeCm3 - prev.volumeCm3;
          const rel = prev.volumeCm3 !== 0 ? delta / prev.volumeCm3 : 0;
          trend = Math.abs(rel) < 0.05 ? "flat" : delta > 0 ? "up" : "down";
        }
        return { siteId, latest, trend, series };
      })
      .sort((a, b) => a.siteId.localeCompare(b.siteId));

    return NextResponse.json({ zoneId, range, days, sites });
  } catch (err) {
    console.error("Dashboard traits error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
