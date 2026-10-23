import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import forge from "node-forge";
import {
  buildLoginTicketRequest,
  clearTicketCache,
  getTicket,
  signTicketRequest,
  WsaaError,
} from "@/lib/fiscal/wsaa";
import type { FiscalConfig } from "@/lib/fiscal/config";

/**
 * El WSAA es la mitad de este módulo que no se puede probar contra un fixture
 * grabado sin más: la firma CMS depende de un certificado y una clave real. Un
 * certificado autofirmado, generado en el test con `node-forge` (la misma
 * librería que firma en producción), alcanza para probar la parte que sí es
 * nuestra — que el TRA sale con la forma correcta y que la firma es un CMS
 * SignedData válido y verificable — sin necesitar el de ARCA, que sólo importa
 * para que el *servidor* de WSAA confíe en la firma, no para que la firma en
 * sí esté bien hecha.
 */

function selfSignedCert() {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const attrs = [{ name: "commonName", value: "test" }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha1.create());
  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
  };
}

describe("buildLoginTicketRequest", () => {
  it("arma el TRA con el service pedido y fechas en horario de Argentina", () => {
    const now = new Date("2026-08-29T15:00:00.000Z"); // 12:00 en Argentina (UTC-3)
    const xml = buildLoginTicketRequest("wsfe", now);

    expect(xml).toContain("<service>wsfe</service>");
    expect(xml).toContain("<generationTime>2026-08-29T12:00:00.000-03:00</generationTime>");
    // 10 minutos después.
    expect(xml).toContain("<expirationTime>2026-08-29T12:10:00.000-03:00</expirationTime>");
  });

  it("uniqueId es el timestamp Unix en segundos, siempre no negativo", () => {
    const now = new Date("2026-08-29T15:00:00.000Z");
    const xml = buildLoginTicketRequest("wsfe", now);
    const match = xml.match(/<uniqueId>(\d+)<\/uniqueId>/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(Math.floor(now.getTime() / 1000));
  });
});

describe("signTicketRequest", () => {
  it("produce un CMS SignedData que se puede volver a leer, con el contenido intacto", () => {
    const { certPem, keyPem } = selfSignedCert();
    const xml = buildLoginTicketRequest("wsfe");

    const base64 = signTicketRequest(xml, certPem, keyPem);

    // Sin las marcas -----BEGIN/END CMS-----, ni saltos de línea: es
    // exactamente lo que el parámetro `in0` de loginCms espera.
    expect(base64).not.toContain("BEGIN");
    expect(base64).not.toContain("\n");

    const der = forge.util.decode64(base64);
    const asn1 = forge.asn1.fromDer(der);
    const message = forge.pkcs7.messageFromAsn1(asn1) as unknown as {
      certificates: unknown[];
      rawCapture: { content: { value: [{ value: string }] } };
    };

    // Un certificado incluido, el del firmante.
    expect(message.certificates).toHaveLength(1);
    // Adjunto (no detached, "-nodetach"): el contenido viaja dentro del CMS,
    // y sale intacto. `message.content` (el getter de forge) queda vacío
    // para este armado en particular — lo real vive en `rawCapture`, que es
    // la estructura ASN.1 ya decodificada.
    expect(message.rawCapture.content.value[0].value).toBe(xml);
  });
});

describe("getTicket", () => {
  const CONFIG: FiscalConfig = {
    cuit: "20123456789",
    ptoVta: 3,
    ...selfSignedCert(),
    environment: "homologacion",
  };

  const okResponse = (token: string, expirationTime: string) => `<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <loginCmsResponse>
      <loginCmsReturn>&lt;?xml version="1.0"?&gt;
        &lt;loginTicketResponse&gt;
          &lt;header&gt;
            &lt;expirationTime&gt;${expirationTime}&lt;/expirationTime&gt;
          &lt;/header&gt;
          &lt;credentials&gt;
            &lt;token&gt;${token}&lt;/token&gt;
            &lt;sign&gt;firma-de-prueba&lt;/sign&gt;
          &lt;/credentials&gt;
        &lt;/loginTicketResponse&gt;
      </loginCmsReturn>
    </loginCmsResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

  const faultResponse = `<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <soapenv:Fault>
      <faultcode>soapenv:Server</faultcode>
      <faultstring>coe.alreadyAuthenticated</faultstring>
      <detail><exceptionInfo><code>coe.alreadyAuthenticated</code><message>El CEE ya posee un TA valido</message></exceptionInfo></detail>
    </soapenv:Fault>
  </soapenv:Body>
</soapenv:Envelope>`;

  beforeEach(() => {
    clearTicketCache();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pide un ticket y lo devuelve parseado", async () => {
    const future = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    vi.mocked(fetch).mockResolvedValue(
      new Response(okResponse("token-1", future), { status: 200 }),
    );

    const ticket = await getTicket("wsfe", CONFIG);

    expect(ticket.token).toBe("token-1");
    expect(ticket.sign).toBe("firma-de-prueba");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("no vuelve a pedir un ticket todavía vigente — pedirlo de nuevo es coe.alreadyAuthenticated", async () => {
    const future = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    vi.mocked(fetch).mockResolvedValue(
      new Response(okResponse("token-1", future), { status: 200 }),
    );

    await getTicket("wsfe", CONFIG);
    await getTicket("wsfe", CONFIG);

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("pide uno nuevo cuando el anterior está por vencer", async () => {
    const almostExpired = new Date(Date.now() + 60 * 1000).toISOString(); // 1 min
    const future = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(okResponse("token-1", almostExpired), { status: 200 }))
      .mockResolvedValueOnce(new Response(okResponse("token-2", future), { status: 200 }));

    const first = await getTicket("wsfe", CONFIG);
    const second = await getTicket("wsfe", CONFIG);

    expect(first.token).toBe("token-1");
    expect(second.token).toBe("token-2");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("un SOAP Fault se traduce a WsaaError con el código", async () => {
    // Una `Response` por llamada: el body de un `Response` sólo se puede leer
    // una vez, y `getTicket` sin caché reintenta el fetch en cada `expect`.
    vi.mocked(fetch).mockImplementation(
      async () => new Response(faultResponse, { status: 500 }),
    );

    await expect(getTicket("wsfe", CONFIG)).rejects.toMatchObject({
      code: "coe.alreadyAuthenticated",
    });
  });

  it("un SOAP Fault es una WsaaError de verdad, no un objeto parecido", async () => {
    vi.mocked(fetch).mockImplementation(
      async () => new Response(faultResponse, { status: 500 }),
    );

    await expect(getTicket("wsfe", CONFIG)).rejects.toBeInstanceOf(WsaaError);
  });
});
