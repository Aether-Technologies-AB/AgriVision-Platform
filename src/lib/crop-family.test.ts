import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BatchPhase, CropFamily } from "@prisma/client";
import {
  FIRST_ACTIVE_PHASE,
  PHASES_BY_FAMILY,
  TERMINAL_OR_PENDING_PHASES,
  familyFromCropType,
  isPhaseValidForFamily,
  resolveCropFamily,
} from "./crop-family";

describe("isPhaseValidForFamily — family/phase pairing invariant", () => {
  it("rejects mushroom-only phases on a MICROGREEN batch", () => {
    for (const phase of [
      BatchPhase.COLONIZATION,
      BatchPhase.FRUITING,
      BatchPhase.READY_TO_HARVEST,
    ]) {
      assert.equal(
        isPhaseValidForFamily(CropFamily.MICROGREEN, phase),
        false,
        `MICROGREEN + ${phase} must be rejected`
      );
    }
  });

  it("rejects microgreen-only phases on a MUSHROOM batch", () => {
    for (const phase of [
      BatchPhase.GERMINATION,
      BatchPhase.POST_GERMINATION,
      BatchPhase.ACTIVE_GROWING,
      BatchPhase.PRE_HARVEST,
    ]) {
      assert.equal(
        isPhaseValidForFamily(CropFamily.MUSHROOM, phase),
        false,
        `MUSHROOM + ${phase} must be rejected`
      );
    }
  });

  it("accepts the family's own phases", () => {
    for (const phase of PHASES_BY_FAMILY[CropFamily.MUSHROOM]) {
      assert.equal(isPhaseValidForFamily(CropFamily.MUSHROOM, phase), true);
    }
    for (const phase of PHASES_BY_FAMILY[CropFamily.MICROGREEN]) {
      assert.equal(isPhaseValidForFamily(CropFamily.MICROGREEN, phase), true);
    }
  });

  it("accepts the shared meta phases (PLANNED / HARVESTED / CANCELLED) for both families", () => {
    for (const phase of TERMINAL_OR_PENDING_PHASES) {
      assert.equal(isPhaseValidForFamily(CropFamily.MUSHROOM, phase), true);
      assert.equal(isPhaseValidForFamily(CropFamily.MICROGREEN, phase), true);
    }
  });

  it("FIRST_ACTIVE_PHASE for each family is itself a legal phase for that family", () => {
    assert.equal(
      isPhaseValidForFamily(CropFamily.MUSHROOM, FIRST_ACTIVE_PHASE[CropFamily.MUSHROOM]),
      true
    );
    assert.equal(
      isPhaseValidForFamily(
        CropFamily.MICROGREEN,
        FIRST_ACTIVE_PHASE[CropFamily.MICROGREEN]
      ),
      true
    );
  });
});

describe("familyFromCropType — variety → family lookup", () => {
  it("maps known mushroom varieties to MUSHROOM", () => {
    for (const v of ["oyster_blue", "lions_mane", "shiitake"]) {
      assert.equal(familyFromCropType(v), CropFamily.MUSHROOM);
    }
  });

  it("maps known microgreen varieties to MICROGREEN", () => {
    for (const v of ["microgreens", "sakura-radish", "sunflower"]) {
      assert.equal(familyFromCropType(v), CropFamily.MICROGREEN);
    }
  });

  it("is case-insensitive", () => {
    assert.equal(familyFromCropType("Oyster_Blue"), CropFamily.MUSHROOM);
    assert.equal(familyFromCropType("SAKURA-RADISH"), CropFamily.MICROGREEN);
  });

  it("returns null for unknown varieties — never guesses", () => {
    // "Sakura" (bare) is the actual live case that triggered this whole PR;
    // guarding it here so a regression to silent-MUSHROOM would fail the suite.
    assert.equal(familyFromCropType("Sakura"), null);
    assert.equal(familyFromCropType(""), null);
    assert.equal(familyFromCropType("gibberish-plant"), null);
  });
});

describe("resolveCropFamily — server-side resolution chain", () => {
  it("prefers an explicit value", () => {
    assert.equal(
      resolveCropFamily({ explicit: "MUSHROOM", cropType: "sakura-radish" }),
      CropFamily.MUSHROOM
    );
    assert.equal(
      resolveCropFamily({ explicit: CropFamily.MICROGREEN, cropType: "oyster_blue" }),
      CropFamily.MICROGREEN
    );
  });

  it("falls back to cropType lookup when explicit is missing", () => {
    assert.equal(
      resolveCropFamily({ cropType: "oyster_blue" }),
      CropFamily.MUSHROOM
    );
    assert.equal(
      resolveCropFamily({ cropType: "microgreens" }),
      CropFamily.MICROGREEN
    );
  });

  it("falls back to zoneDefault when cropType is unknown", () => {
    assert.equal(
      resolveCropFamily({
        cropType: "Sakura",
        zoneDefault: CropFamily.MICROGREEN,
      }),
      CropFamily.MICROGREEN
    );
  });

  it("returns null when nothing resolves — never silently defaults to MUSHROOM", () => {
    assert.equal(resolveCropFamily({ cropType: "Sakura" }), null);
    assert.equal(resolveCropFamily({}), null);
  });

  it("ignores an invalid explicit value and continues down the chain", () => {
    assert.equal(
      resolveCropFamily({
        explicit: "SEAWEED",
        cropType: "oyster_blue",
      }),
      CropFamily.MUSHROOM
    );
  });
});
