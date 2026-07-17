// Static rail <-> zone mapping for the Pilot Basement lettuce/basil
// trait-ingestion pipeline (SiteObservation).
//
// Deliberately NOT a database column: the migration for this feature is
// scoped to "new table + new enum value only" (see the SiteObservation
// migration) — no column was added to Zone. Two rails, two zones, known
// ahead of time — a static map is simpler and equally correct.
//
// This map is also what scopes /api/observations to Pilot Basement only:
// any zoneId not listed here (i.e. every mushroom/microgreen zone) is
// rejected before a single SiteObservation row is written.
export const RAIL_ZONE_MAP: Record<string, { zoneId: string; label: string }> = {
  rail1: { zoneId: "cmr83i8mv0005apc9ftndmn3n", label: "Floor 1 (lettuce)" },
  rail2: { zoneId: "cmr83i8sa0007apc9wziy3cir", label: "Floor 2 (basil)" },
};

// Reverse lookup: which rail (if any) is this zone configured for?
export function railForZone(zoneId: string): string | null {
  for (const [rail, cfg] of Object.entries(RAIL_ZONE_MAP)) {
    if (cfg.zoneId === zoneId) return rail;
  }
  return null;
}
