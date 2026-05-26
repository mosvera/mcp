// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from "vitest";
import { createValidator } from "@mosvera/runtime";
import { runValidateSchema } from "../src/tools/validate-schema.ts";

const v = createValidator();

describe("validate_schema", () => {
  it("returns valid:true for a well-formed template", () => {
    const doc = { $schema: "https://mosvera.io/schema/0.1/template", id: "t", medium: "photographic" };
    expect(runValidateSchema(v, { document: doc, kind: "template" })).toEqual({ valid: true, errors: [] });
  });

  it("returns valid:false with issues for a template missing id", () => {
    const res = runValidateSchema(v, { document: { $schema: "x", medium: "photographic" }, kind: "template" });
    expect(res.valid).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
  });

  it("accepts a YAML/JSON string document", () => {
    const res = runValidateSchema(v, { document: "id: t\nmedium: photographic", kind: "template" });
    expect(res.valid).toBe(true);
  });

  it("returns valid:false (not a throw) for unparseable input", () => {
    const res = runValidateSchema(v, { document: "::: not yaml :::", kind: "template" });
    expect(res.valid).toBe(false);
    expect(res.errors[0]!.message).toMatch(/parse/i);
  });
});
