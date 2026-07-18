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
  vol_max: number | null;
  height_mean_median_mm: number | null;
  height_max_mm: number | null;
  coverage_mean: number | null;
};

type NadirRow = {
  day: Date;
  vol_nadir_median: number | null;
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
    // day. Selection order (matches the pipeline: fusion only happens when
    // multiple views exist; nadir is the primary single view):
    //   1. fused row if one exists  (isFused DESC)
    //   2. else the nadir view      (smallest |viewAngleDeg|; NULLS FIRST keeps
    //                                the fused row — null angle — ahead anyway)
    //   3. latest capture that day  (capturedAt DESC) as the final tiebreak
    // This collapses the ~4 rows/site/cycle (and multi-cycle days) to one value
    // per site/day and never drops a site that has only per-view rows — the
    // isFused=true filter used to discard ~96% of the data (29 fused vs 792
    // per-view). Fused preferred, nadir fallback.
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
        ORDER BY date_trunc('day', "capturedAt"), "siteId",
                 "isFused" DESC, abs("viewAngleDeg") ASC NULLS FIRST, "capturedAt" DESC
      )
      SELECT
        day,
        COUNT(*) FILTER (WHERE plant_present)::int AS plant_count,
        (percentile_cont(0.5) WITHIN GROUP (ORDER BY vol) FILTER (WHERE plant_present))::float AS vol_median,
        (MAX(vol) FILTER (WHERE plant_present))::float AS vol_max,
        (percentile_cont(0.5) WITHIN GROUP (ORDER BY h_mean) FILTER (WHERE plant_present))::float AS height_mean_median_mm,
        (MAX(h_max) FILTER (WHERE plant_present))::float AS height_max_mm,
        (AVG(cov) FILTER (WHERE plant_present))::float AS coverage_mean
      FROM rep
      GROUP BY day
      ORDER BY day ASC
    `;

    // Bonus (cheap): nadir volume = the non-fused row with the smallest
    // |viewAngleDeg| per site/day, median across sites. Merged into `days`.
    const nadirP = prisma.$queryRaw<NadirRow[]>`
      WITH nadir AS (
        SELECT DISTINCT ON (date_trunc('day', "capturedAt"), "siteId")
          date_trunc('day', "capturedAt") AS day,
          "plantPresent" AS plant_present,
          "canopyVolumeCm3" AS vol
        FROM "SiteObservation"
        WHERE "zoneId" = ${zoneId} AND "isFused" = false
          AND "viewAngleDeg" IS NOT NULL AND "capturedAt" >= ${since}
        ORDER BY date_trunc('day', "capturedAt"), "siteId", abs("viewAngleDeg") ASC, "capturedAt" DESC
      )
      SELECT day, (percentile_cont(0.5) WITHIN GROUP (ORDER BY vol) FILTER (WHERE plant_present))::float AS vol_nadir_median
      FROM nadir
      GROUP BY day
      ORDER BY day ASC
    `;

    // Per-site daily series (one representative row per site/day) for drill-
    // down — same fused-preferred / nadir-fallback selection as the rollup.
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
      ORDER BY date_trunc('day', "capturedAt"), "siteId",
               "isFused" DESC, abs("viewAngleDeg") ASC NULLS FIRST, "capturedAt" DESC
    `;

    const [dailyRows, nadirRows, siteRows] = await Promise.all([
      dailyP,
      nadirP,
      sitesP,
    ]);

    const nadirByDay = new Map<string, number | null>();
    for (const r of nadirRows) {
      nadirByDay.set(new Date(r.day).toISOString(), r.vol_nadir_median);
    }

    const days = dailyRows.map((r) => {
      const dayIso = new Date(r.day).toISOString();
      return {
        day: dayIso,
        plantCount: r.plant_count,
        volMedianCm3: r.vol_median,
        volMaxCm3: r.vol_max,
        volNadirMedianCm3: nadirByDay.get(dayIso) ?? null,
        heightMeanMedianCm: mmToCm(r.height_mean_median_mm),
        heightMaxCm: mmToCm(r.height_max_mm),
        coveragePct: toCoveragePct(r.coverage_mean),
      };
    });

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
