// Single source of truth for energy-chart device colors. Every energy chart /
// card imports from here so a given device is the SAME color everywhere it
// appears. Colors are drawn from the app palette (globals.css design tokens +
// the raw-hex convention used by EnvironmentChart et al.) and chosen to stay
// distinct on the dark dashboard theme.
//
// Semantics: the two grow-light circuits share the green family (lettuce/basil),
// the utilities are cool (cyan = air, blue = water) — so a glance separates
// "lights" from "fan/pump".
//
// A deviceName NOT listed here renders in ENERGY_DEVICE_COLOR_FALLBACK (neutral
// grey), so a newly-added device still shows up — just uncolored until mapped.
export const ENERGY_DEVICE_COLORS: Record<string, string> = {
  // ── pi4-003 GGS rack (Shelly channels) ──
  "floor1-lights": "#4abe7b", // green  (--color-green) — Floor 1 lettuce lights
  "floor2-lights": "#a3e635", // lime — Floor 2 basil lights, distinct from Floor 1
  "ggs-fan": "#22d3ee", //        cyan — GGS air / exhaust fan
  "ggs-pump": "#3b82f6", //       blue  (--color-blue) — water pump

  // ── legacy / other farms (kept verbatim so their charts don't regress) ──
  humidifier: "#3b82f6",
  fan: "#22c55e",
  light: "#eab308",
  "Main Humidifier": "#3b82f6",
  "Exhaust Fan": "#22c55e",
  "Grow Light": "#eab308",
};

// Neutral grey for any unmapped device — same default the chart used before.
export const ENERGY_DEVICE_COLOR_FALLBACK = "#6b7280";

/** Resolve a deviceName to its chart color, falling back to neutral grey. */
export function energyDeviceColor(deviceName: string): string {
  return ENERGY_DEVICE_COLORS[deviceName] ?? ENERGY_DEVICE_COLOR_FALLBACK;
}
