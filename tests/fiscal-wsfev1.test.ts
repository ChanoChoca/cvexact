import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArcaError, fechaArca, solicitarCAE, ultimoAutorizado } from "@/lib/fiscal/wsfev1";
import type { FiscalConfig } from "@/lib/fiscal/config";
import type { Ticket } from "@/lib/fiscal/wsaa";

/**
 * Las reglas de Factura C a Consumidor Final que `solicitarCAE` tiene que
 * respetar están fijadas en el manual de FEv4.0 y no son negociables: ARCA
 * rechaza el comprobante entero si `ImpIVA` no es 0, o si se manda el array
 * `Iva`, o si `ImpTotal` no es `ImpNeto + ImpTrib`. Estos tests capturan el
 * cuerpo real del request — igual que `tests/rate-limit-db.test.ts` captura
 * SQL en vez de correrlo — para fijar esas reglas contra el texto que de
 * verdad sale, no contra una descripción de lo que el código debería hacer.
 */

const CONFIG: FiscalConfig = {
  cuit: "20123456789",
  ptoVta: 3,
  certPem: "",
  keyPem: "",
  environment: "homologacion",
};

const TICKET: Ticket = { token: "tok", sign: "sig", expirationTime: new Date() };

describe("fechaArca", () => {
  it("formatea AAAAMMDD", () => {
    expect(fechaArca(new Date("2026-08-29T15:00:00.000Z"))).toBe("20260829");
  });

  it("no agrega ceros de más en meses/días de un dígito", () => {
    expect(fechaArca(new Date("2026-01-05T00:00:00.000Z"))).toBe("20260105");
  });
});

describe("ultimoAutorizado", () => {
  let capturedBody = "";

  beforeEach(() => {
    capturedBody = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        capturedBody = String(init.body);
        return new Response(
          `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
            <soap:Body>
              <FECompUltimoAutorizadoResponse>
                <FECompUltimoAutorizadoResult>
                  <PtoVta>3</PtoVta>
                  <CbteTipo>11</CbteTipo>
                  <CbteNro>41</CbteNro>
                </FECompUltimoAutorizadoResult>
              </FECompUltimoAutorizadoResponse>
            </soap:Body>
          </soap:Envelope>`,
          { status: 200 },
        );
      }),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("devuelve el último número autorizado", async () => {
    expect(await ultimoAutorizado(TICKET, CONFIG)).toBe(41);
  });

  it("manda el punto de venta y el tipo de comprobante configurados", async () => {
    await ultimoAutorizado(TICKET, CONFIG);
    expect(capturedBody).toContain("<ar:PtoVta>3</ar:PtoVta>");
    expect(capturedBody).toContain("<ar:CbteTipo>11</ar:CbteTipo>");
    expect(capturedBody).toContain("<ar:Cuit>20123456789</ar:Cuit>");
  });

  it("0 cuando nunca se emitió nada", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            `<soap:Envelope><soap:Body><FECompUltimoAutorizadoResponse>
              <FECompUltimoAutorizadoResult><CbteNro>0</CbteNro></FECompUltimoAutorizadoResult>
            </FECompUltimoAutorizadoResponse></soap:Body></soap:Envelope>`,
            { status: 200 },
          ),
      ),
    );
    expect(await ultimoAutorizado(TICKET, CONFIG)).toBe(0);
  });

  it("un Errors en la respuesta se traduce a ArcaError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            `<soap:Envelope><soap:Body><FECompUltimoAutorizadoResponse>
              <FECompUltimoAutorizadoResult>
                <Errors><Err><Code>11002</Code><Msg>PtoVta no habilitado</Msg></Err></Errors>
              </FECompUltimoAutorizadoResult>
            </FECompUltimoAutorizadoResponse></soap:Body></soap:Envelope>`,
            { status: 200 },
          ),
      ),
    );
    await expect(ultimoAutorizado(TICKET, CONFIG)).rejects.toBeInstanceOf(ArcaError);
    await expect(ultimoAutorizado(TICKET, CONFIG)).rejects.toMatchObject({
      details: ["11002: PtoVta no habilitado"],
    });
  });
});

describe("solicitarCAE", () => {
  let capturedBody = "";

  function mockResponse(xml: string) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        capturedBody = String(init.body);
        return new Response(xml, { status: 200 });
      }),
    );
  }

  afterEach(() => vi.unstubAllGlobals());

  const APROBADA = `<soap:Envelope><soap:Body><FECAESolicitarResponse><FECAESolicitarResult>
    <FeCabResp><Resultado>A</Resultado></FeCabResp>
    <FeDetResp><FECAEDetResponse>
      <Resultado>A</Resultado>
      <CAE>75311234567890</CAE>
      <CAEFchVto>20260915</CAEFchVto>
    </FECAEDetResponse></FeDetResp>
  </FECAESolicitarResult></FECAESolicitarResponse></soap:Body></soap:Envelope>`;

  it("una respuesta aprobada trae CAE y su vencimiento", async () => {
    mockResponse(APROBADA);
    const result = await solicitarCAE(TICKET, CONFIG, {
      cbteNro: 42,
      importe: 6080,
      fecha: new Date("2026-08-29T12:00:00Z"),
    });

    expect(result.resultado).toBe("A");
    expect(result.cae).toBe("75311234567890");
    expect(result.caeVto?.toISOString().slice(0, 10)).toBe("2026-09-15");
    expect(result.observaciones).toEqual([]);
  });

  it("el request respeta las reglas de Factura C: ImpIVA/ImpOpEx/ImpTotConc en 0, sin array Iva", async () => {
    mockResponse(APROBADA);
    await solicitarCAE(TICKET, CONFIG, {
      cbteNro: 42,
      importe: 6080,
      fecha: new Date("2026-08-29T12:00:00Z"),
    });

    expect(capturedBody).toContain("<ar:ImpIVA>0.00</ar:ImpIVA>");
    expect(capturedBody).toContain("<ar:ImpOpEx>0.00</ar:ImpOpEx>");
    expect(capturedBody).toContain("<ar:ImpTotConc>0.00</ar:ImpTotConc>");
    expect(capturedBody).not.toContain("<ar:Iva>");
    // ImpTotal = ImpNeto + ImpTrib (0), para tipo C.
    expect(capturedBody).toContain("<ar:ImpTotal>6080.00</ar:ImpTotal>");
    expect(capturedBody).toContain("<ar:ImpNeto>6080.00</ar:ImpNeto>");
    expect(capturedBody).toContain("<ar:DocTipo>99</ar:DocTipo>");
    expect(capturedBody).toContain("<ar:DocNro>0</ar:DocNro>");
    expect(capturedBody).toContain("<ar:CbteTipo>11</ar:CbteTipo>");
  });

  it("Concepto=2 (servicios) manda las tres fechas obligatorias, iguales a la fecha del comprobante", async () => {
    mockResponse(APROBADA);
    await solicitarCAE(TICKET, CONFIG, {
      cbteNro: 42,
      importe: 6080,
      fecha: new Date("2026-08-29T12:00:00Z"),
    });

    expect(capturedBody).toContain("<ar:Concepto>2</ar:Concepto>");
    expect(capturedBody).toContain("<ar:FchServDesde>20260829</ar:FchServDesde>");
    expect(capturedBody).toContain("<ar:FchServHasta>20260829</ar:FchServHasta>");
    expect(capturedBody).toContain("<ar:FchVtoPago>20260829</ar:FchVtoPago>");
  });

  it("CbteDesde y CbteHasta son el mismo número: un comprobante por pedido", async () => {
    mockResponse(APROBADA);
    await solicitarCAE(TICKET, CONFIG, {
      cbteNro: 42,
      importe: 6080,
      fecha: new Date("2026-08-29T12:00:00Z"),
    });

    expect(capturedBody).toContain("<ar:CbteDesde>42</ar:CbteDesde>");
    expect(capturedBody).toContain("<ar:CbteHasta>42</ar:CbteHasta>");
  });

  it("un rechazo (Resultado: R) no trae CAE y expone las observaciones", async () => {
    mockResponse(`<soap:Envelope><soap:Body><FECAESolicitarResponse><FECAESolicitarResult>
      <FeCabResp><Resultado>R</Resultado></FeCabResp>
      <FeDetResp><FECAEDetResponse>
        <Resultado>R</Resultado>
        <Obs><Observaciones><Code>10016</Code><Msg>CbteDesde no es correlativo</Msg></Observaciones></Obs>
      </FECAEDetResponse></FeDetResp>
    </FECAESolicitarResult></FECAESolicitarResponse></soap:Body></soap:Envelope>`);

    const result = await solicitarCAE(TICKET, CONFIG, {
      cbteNro: 42,
      importe: 6080,
      fecha: new Date("2026-08-29T12:00:00Z"),
    });

    expect(result.resultado).toBe("R");
    expect(result.cae).toBeNull();
    expect(result.observaciones).toEqual(["10016: CbteDesde no es correlativo"]);
  });

  it("una aprobación con observaciones no excluyentes sigue siendo A, con CAE", async () => {
    mockResponse(`<soap:Envelope><soap:Body><FECAESolicitarResponse><FECAESolicitarResult>
      <FeCabResp><Resultado>A</Resultado></FeCabResp>
      <FeDetResp><FECAEDetResponse>
        <Resultado>A</Resultado>
        <CAE>75311234567890</CAE>
        <CAEFchVto>20260915</CAEFchVto>
        <Obs><Observaciones><Code>2000</Code><Msg>Advertencia menor</Msg></Observaciones></Obs>
      </FECAEDetResponse></FeDetResp>
    </FECAESolicitarResult></FECAESolicitarResponse></soap:Body></soap:Envelope>`);

    const result = await solicitarCAE(TICKET, CONFIG, {
      cbteNro: 42,
      importe: 6080,
      fecha: new Date("2026-08-29T12:00:00Z"),
    });

    expect(result.resultado).toBe("A");
    expect(result.cae).toBe("75311234567890");
    expect(result.observaciones).toEqual(["2000: Advertencia menor"]);
  });

  it("errores globales (Errors) se traducen a ArcaError, no a un rechazo silencioso", async () => {
    mockResponse(`<soap:Envelope><soap:Body><FECAESolicitarResponse><FECAESolicitarResult>
      <Errors><Err><Code>600</Code><Msg>Token y Sign no corresponden</Msg></Err></Errors>
    </FECAESolicitarResult></FECAESolicitarResponse></soap:Body></soap:Envelope>`);

    await expect(
      solicitarCAE(TICKET, CONFIG, { cbteNro: 42, importe: 6080, fecha: new Date() }),
    ).rejects.toBeInstanceOf(ArcaError);
  });

  it("redondea el importe a dos decimales", async () => {
    mockResponse(APROBADA);
    await solicitarCAE(TICKET, CONFIG, {
      cbteNro: 42,
      importe: 6080.5,
      fecha: new Date("2026-08-29T12:00:00Z"),
    });
    expect(capturedBody).toContain("<ar:ImpTotal>6080.50</ar:ImpTotal>");
  });
});
