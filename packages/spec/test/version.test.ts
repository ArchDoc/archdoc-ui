import { describe, expect, it } from "vitest";
import { SPEC_VERSION } from "../src/index.js";

describe("spec", () => {
  it("declares spec version 2.0", () => {
    expect(SPEC_VERSION).toBe("2.0");
  });
});
