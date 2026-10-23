import { describe, expect, it } from "vitest";
import { GHOSTING_DAYS } from "@/lib/tracker/ghosting";

describe("GHOSTING_DAYS", () => {
  it("es 21, el umbral que especifica el requerimiento", () => {
    expect(GHOSTING_DAYS).toBe(21);
  });
});
