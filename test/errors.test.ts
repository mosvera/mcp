// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from "vitest";
import { mapResolutionError } from "../src/errors.ts";
import { ResolutionError } from "@mosvera/runtime";

describe("mapResolutionError", () => {
  it("maps an inheritance cycle to its taxonomy code", () => {
    expect(mapResolutionError(new ResolutionError("inheritance_cycle"))).toEqual({
      error: "inheritance_cycle",
    });
  });

  it("maps multiple-inheritance rejection", () => {
    expect(mapResolutionError(new ResolutionError("multiple_inheritance_unsupported"))).toEqual({
      error: "multiple_inheritance_unsupported",
    });
  });
});
