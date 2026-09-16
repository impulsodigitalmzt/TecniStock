import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ajusteVarianteContacto, gangasEnTexto, varianteContacto } from "./stock.ts";

describe("variante de contacto vs módulos", () => {
  it("no trata un enchufe sencillo como 1 módulo", () => {
    assert.equal(gangasEnTexto("Módulo contacto / enchufe sencillo (Color Blanco)"), null);
    assert.equal(varianteContacto("Módulo contacto / enchufe sencillo (Color Blanco)", "CONT-SEN-BLC-MOD"), "sencillo");
  });

  it("un dúplex de 1 módulo sigue siendo dúplex", () => {
    const foto = "Contacto dúplex con placa metálica 1 módulo Receptáculo dúplex dos tomas";
    assert.equal(gangasEnTexto(foto), 1);
    assert.equal(varianteContacto(foto), "duplex");
    assert.equal(varianteContacto("Contacto dúplex aterrizado", "CONT-DUP-127"), "duplex");
  });

  it("apagador sencillo sí cuenta como 1 módulo", () => {
    assert.equal(gangasEnTexto("Apagador sencillo 127 V"), 1);
    assert.equal(varianteContacto("Apagador sencillo 127 V", "INT-SENC-127"), null);
  });

  it("prioriza dúplex sobre un módulo sencillo cuando la foto es dúplex", () => {
    const foto =
      "Contacto dúplex con placa metálica contacto duplex 1 módulo Receptáculo dúplex dos tomas apiladas";
    const duplex = ajusteVarianteContacto(foto, "Contacto dúplex aterrizado", "CONT-DUP-127");
    const sencillo = ajusteVarianteContacto(
      foto,
      "Módulo contacto / enchufe sencillo (Color Blanco)",
      "CONT-SEN-BLC-MOD"
    );
    assert.equal(duplex, 14);
    assert.equal(sencillo, -18);
    assert.ok(duplex > sencillo);
  });

  it("si pide sencillo, el dúplex baja y el de una toma sube", () => {
    const foto = "Contacto sencillo de una toma 1 módulo";
    const sencillo = ajusteVarianteContacto(
      foto,
      "Módulo contacto / enchufe sencillo (Color Blanco)",
      "CONT-SEN-BLC-MOD"
    );
    const duplex = ajusteVarianteContacto(foto, "Contacto dúplex aterrizado", "CONT-DUP-127");
    assert.equal(sencillo, 14);
    assert.equal(duplex, -18);
    assert.ok(sencillo > duplex);
  });
});
