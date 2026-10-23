import { describe, expect, it } from "vitest";
import { isPrivateAddress } from "@/lib/tracker/safe-fetch";

describe("isPrivateAddress", () => {
  it("marca como privadas las direcciones que un SSRF apuntaría", () => {
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("10.0.0.5")).toBe(true);
    expect(isPrivateAddress("172.16.0.1")).toBe(true);
    expect(isPrivateAddress("172.31.255.255")).toBe(true);
    expect(isPrivateAddress("192.168.1.1")).toBe(true);
    expect(isPrivateAddress("169.254.169.254")).toBe(true); // metadata service de la nube
    expect(isPrivateAddress("100.64.0.1")).toBe(true); // CGNAT
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("fe80::1")).toBe(true);
    expect(isPrivateAddress("fd00::1")).toBe(true);
    expect(isPrivateAddress("::ffff:127.0.0.1")).toBe(true);
  });

  it("no marca como privadas direcciones públicas normales", () => {
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(isPrivateAddress("1.1.1.1")).toBe(false);
    expect(isPrivateAddress("2606:4700:4700::1111")).toBe(false);
  });

  it("un string que no es una IP válida se trata como no confiable", () => {
    expect(isPrivateAddress("no-es-una-ip")).toBe(true);
    expect(isPrivateAddress("999.999.999.999")).toBe(true);
  });

  it("el límite exacto entre rangos 172.16-31 privado vs 172.32 público", () => {
    expect(isPrivateAddress("172.15.255.255")).toBe(false);
    expect(isPrivateAddress("172.32.0.0")).toBe(false);
  });
});
