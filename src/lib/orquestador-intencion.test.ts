import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clasificarIntencionHeuristica } from "./intencion-ruta.ts";

describe("orquestador de intención TecniStock", () => {
  it("manda un artículo concreto a búsqueda de producto", () => {
    assert.equal(clasificarIntencionHeuristica("cinta de teflón").ruta, "producto");
    assert.equal(clasificarIntencionHeuristica("un foco LED").ruta, "producto");
    assert.equal(clasificarIntencionHeuristica("contacto duplex").ruta, "producto");
    assert.equal(clasificarIntencionHeuristica("cable thw 12").ruta, "producto");
    assert.equal(clasificarIntencionHeuristica("armar el pedido").ruta, "producto");
  });

  it("manda armados e instalaciones a la ruta de proyecto", () => {
    assert.equal(
      clasificarIntencionHeuristica("necesito lo necesario para armar una acometida de 220v").ruta,
      "proyecto"
    );
    assert.equal(clasificarIntencionHeuristica("cableado de una recámara").ruta, "proyecto");
    assert.equal(clasificarIntencionHeuristica("instalar una bomba de cisterna").ruta, "proyecto");
    assert.equal(clasificarIntencionHeuristica("lista de materiales para acometida").ruta, "proyecto");
  });

  it("no trata una objeción de metros como proyecto nuevo", () => {
    assert.equal(
      clasificarIntencionHeuristica("pero un rollo de cable es demasiado, solo ocupo 5 metros nada mas").ruta,
      "producto"
    );
  });
});
