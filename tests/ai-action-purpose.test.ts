import { describe, expect, it } from "vitest";
import { purposeOf } from "@/components/onboarding/AiAction";

/**
 * When there is no AI to use, the button of `AiAction` is not there, and the card that takes its place says what it was for (e5 UX, U40): «Para armar mi recorrido hace falta una IA…», and
 * not «Armar mi recorrido con tu IA necesita una IA disponible». The label says which text or which document it is about, and there can be one offer for each of a few documents on the
 * same screen, so that part has to survive; what does not is «con tu IA», which in a sentence that says there is none is the same thing said twice.
 */

describe("what an action is, for the sentence that says there is no AI for it", () => {
  it("is the label without «con tu IA», starting in lower case", () => {
    expect(purposeOf("Armar mi recorrido con tu IA")).toBe("armar mi recorrido");
    expect(purposeOf("Leer con tu IA")).toBe("leer");
    expect(purposeOf("Leer la foto con tu IA")).toBe("leer la foto");
    expect(purposeOf("Separar con tu IA")).toBe("separar");
  });

  it("keeps which document it is about, because there can be an offer for each", () => {
    expect(purposeOf("Mejorar la lectura de «cv.pdf» con tu IA")).toBe("mejorar la lectura de «cv.pdf»");
    expect(purposeOf("Mejorar la lectura de «LinkedIn (ZIP)» con tu IA")).toBe("mejorar la lectura de «LinkedIn (ZIP)»");
    expect(purposeOf("Mejorar la lectura de «cv.pdf» con tu IA")).not.toBe(purposeOf("Mejorar la lectura de «Texto pegado» con tu IA"));
  });

  it("takes a label that does not end in «con tu IA» as it is, and does not touch a «con tu IA» in the middle", () => {
    expect(purposeOf("Contámelo a mi manera")).toBe("contámelo a mi manera");
    expect(purposeOf("Revisar con tu IA lo que cargaste")).toBe("revisar con tu IA lo que cargaste");
    expect(purposeOf("  Armar mi recorrido con tu IA ")).toBe("armar mi recorrido");
    expect(purposeOf("")).toBe("");
  });
});
