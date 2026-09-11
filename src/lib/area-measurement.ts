export const AREA_METHOD = "seg-area-v2";
export const AREA_MODEL_SHA256 = "4c62c1364482f0bb518db6c8628375700856327b0f01d5e61f8e5eebc3da551f";
const FLAGS = ["near_frame_edge", "low_depth_support", "insufficient_depth", "ambiguous_match"];

export type AreaMetadata = {
  algorithm_version: string;
  implementation_revision: string;
  vegetation_model_sha256: string;
  runtime_model_sha256: string;
  vegetation_threshold: number;
  ownership_rule: string;
  raw_polygon_px: number;
  background_removed_px: number;
  ownership_removed_px: number;
  raw_polygon_area_cm2: number | null;
  median_depth_mm: number | null;
  valid_depth_px: number;
  depth_valid_pct: number;
  frame_edge_distances_px: { left: number; right: number; top: number; bottom: number };
  quality_flags: string[];
  presence_source: string;
};

/** Bounded, versioned metadata; fail closed for a v2 row without provenance. */
export function parseAreaMetadata(value: unknown, record: Record<string, unknown>): AreaMetadata | null {
  if (record.method !== AREA_METHOD) {
    if (value != null) throw new Error("measurement_meta is only supported for seg-area-v2");
    return null;
  }
  const fail = (): never => { throw new Error("Invalid seg-area-v2 measurement_meta or area contract"); };
  if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(value).length > 4096) return fail();
  const m = value as AreaMetadata;
  const nonnegative = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
  const integer = (n: unknown): n is number => nonnegative(n) && Number.isInteger(n);
  if (m.algorithm_version !== AREA_METHOD || m.vegetation_model_sha256 !== AREA_MODEL_SHA256 ||
      m.implementation_revision !== "numpy-rf-1" ||
      m.runtime_model_sha256 !== "f44b1798deddfe0c6b9d6154fca8cbc8d86ff68375f0ce87cdf68f2a909eb008" ||
      m.vegetation_threshold !== 0.5 || m.presence_source !== "seg-v1" ||
      m.ownership_rule !== "nearest-claimant-row-desc-channel-asc-v1" ||
      ![m.raw_polygon_px, m.background_removed_px, m.ownership_removed_px, m.valid_depth_px].every(integer) ||
      !nonnegative(m.depth_valid_pct) || m.depth_valid_pct > 100 ||
      !(m.raw_polygon_area_cm2 === null || nonnegative(m.raw_polygon_area_cm2)) ||
      !(m.median_depth_mm === null || (nonnegative(m.median_depth_mm) && m.median_depth_mm > 0 && m.median_depth_mm < 60000)) ||
      !m.frame_edge_distances_px || !["left", "right", "top", "bottom"].every(k => integer(m.frame_edge_distances_px[k as keyof typeof m.frame_edge_distances_px])) ||
      !Array.isArray(m.quality_flags) || m.quality_flags.length > FLAGS.length ||
      m.quality_flags.some(f => !FLAGS.includes(f)) || new Set(m.quality_flags).size !== m.quality_flags.length) return fail();
  const px = record.area_px;
  if (!integer(px) || m.raw_polygon_px - m.background_removed_px - m.ownership_removed_px !== px ||
      m.valid_depth_px > px || Math.abs(m.depth_valid_pct - 100 * m.valid_depth_px / Math.max(1, px)) > 0.011 ||
      record.depth_valid_pct !== m.depth_valid_pct || record.rail !== "rail1" || record.is_fused !== false ||
      record.clipped_by_roi != null || !nonnegative(record.fx) || record.fx <= 0) return fail();
  const expectedFlags = {
    near_frame_edge: Math.min(...Object.values(m.frame_edge_distances_px)) <= 5,
    low_depth_support: 100 * m.valid_depth_px / Math.max(1, px) < 80,
    insufficient_depth: m.valid_depth_px < 20,
  };
  if (Object.entries(expectedFlags).some(([flag, expected]) => m.quality_flags.includes(flag) !== expected)) return fail();
  if (m.valid_depth_px < 20) {
    if (m.median_depth_mm !== null || record.area_cm2 !== null) return fail();
  } else if (m.median_depth_mm === null || !nonnegative(record.area_cm2) ||
      Math.abs(record.area_cm2 - px * (m.median_depth_mm / record.fx) ** 2 / 100) > 0.051) return fail();
  // This release measures area only; old geometry must retain its old method.
  if (["height_mm_max", "height_mm_mean", "height_profile_mm", "canopy_volume_cm3", "width_mm", "length_mm", "coverage", "exg_mean", "exg_std", "lab_a_mean", "deep_green_frac"].some(k => record[k] != null)) return fail();
  // Pick only the defined fields, rather than persisting arbitrary nested input.
  return {
    algorithm_version: m.algorithm_version, implementation_revision: m.implementation_revision,
    vegetation_model_sha256: m.vegetation_model_sha256, runtime_model_sha256: m.runtime_model_sha256,
    vegetation_threshold: m.vegetation_threshold, ownership_rule: m.ownership_rule,
    raw_polygon_px: m.raw_polygon_px, background_removed_px: m.background_removed_px,
    ownership_removed_px: m.ownership_removed_px, raw_polygon_area_cm2: m.raw_polygon_area_cm2,
    median_depth_mm: m.median_depth_mm, valid_depth_px: m.valid_depth_px, depth_valid_pct: m.depth_valid_pct,
    frame_edge_distances_px: { left: m.frame_edge_distances_px.left, right: m.frame_edge_distances_px.right,
      top: m.frame_edge_distances_px.top, bottom: m.frame_edge_distances_px.bottom },
    quality_flags: m.quality_flags, presence_source: m.presence_source,
  };
}

export type AreaPoint = {
  siteId: string; day: string; capturedAt: string; areaCm2: number | null;
  plantPresent: boolean; qualityFlags: string[]; eligible: boolean;
};

export function summarizeArea(points: AreaPoint[]) {
  const days = new Map<string, AreaPoint[]>();
  for (const p of points) days.set(p.day, [...(days.get(p.day) ?? []), p]);
  return Array.from(days, ([day, rows]) => {
    const values = rows.filter(r => r.eligible && r.areaCm2 !== null).map(r => r.areaCm2!).sort((a,b) => a-b);
    const mid = Math.floor(values.length / 2);
    return { day, medianCm2: values.length ? (values.length % 2 ? values[mid] : (values[mid-1]+values[mid])/2) : null,
      includedSites: values.length, reviewSites: rows.filter(r => !r.eligible).length };
  }).sort((a,b) => a.day.localeCompare(b.day));
}
