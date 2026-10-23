import { describe, expect, it } from "vitest";
import { positionBetween, rebalance } from "@/lib/tracker/board";

describe("positionBetween", () => {
  it("primera tarjeta de una columna vacía", () => {
    expect(positionBetween(null, null)).toBe(0);
  });

  it("al principio de la columna", () => {
    const p = positionBetween(null, 100);
    expect(p).not.toBeNull();
    expect(p as number).toBeLessThan(100);
  });

  it("al final de la columna", () => {
    const p = positionBetween(100, null);
    expect(p).not.toBeNull();
    expect(p as number).toBeGreaterThan(100);
  });

  it("entre dos tarjetas, el punto medio", () => {
    expect(positionBetween(100, 200)).toBe(150);
  });

  it("puede subdividir muchas veces antes de perder precisión", () => {
    const before = 0;
    let after = 1024;
    for (let i = 0; i < 30; i++) {
      const mid = positionBetween(before, after);
      expect(mid).not.toBeNull();
      after = mid as number;
    }
  });

  it("devuelve null cuando el hueco ya es demasiado angosto para rebalancear", () => {
    expect(positionBetween(1, 1 + 1e-15)).toBeNull();
  });
});

describe("rebalance", () => {
  it("da una posición creciente por id, en el orden recibido", () => {
    const positions = rebalance(["a", "b", "c"]);
    expect(positions.get("a")).toBeLessThan(positions.get("b")!);
    expect(positions.get("b")).toBeLessThan(positions.get("c")!);
  });

  it("columna vacía no rompe nada", () => {
    expect(rebalance([]).size).toBe(0);
  });
});
