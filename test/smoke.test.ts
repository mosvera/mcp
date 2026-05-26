// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from "vitest";
import { deriveStrategies, createValidator } from "@mosvera/runtime";

describe("workspace wiring", () => {
  it("can import the runtime from @mosvera/mcp", () => {
    expect(typeof deriveStrategies).toBe("function");
    expect(typeof createValidator).toBe("function");
  });
});
