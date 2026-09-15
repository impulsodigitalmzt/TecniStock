import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clasificarIntencionHeuristica } from "./intencion-ruta.ts";
import { elegirHitBom, limpiarQueryBom } from "./paquete-bom-match.ts";

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

  it("limpia el query de cable inventado por metro", () => {
    assert.equal(limpiarQueryBom("cable THW calibre 12.5 metro"), "cable THW calibre 12");
    assert.equal(limpiarQueryBom("cable thw calibre 10"), "cable thw calibre 10");
  });

  it("si pide tramo pero el anaquel vende rollo, ofrece el rollo", () => {
    const hit = elegirHitBom(
      { query: "cable THW calibre 12.5 metro", cantidad: 1, grupo: "conductores" },
      [
        {
          sku: "CAB-12-THW",
          nombre: "Rollo de cable THW-15 Calibre 12 (100m)",
          categoria: "electricidad",
          stock_disponible: 6,
          precio: 1450,
          ubicacion_tienda: "",
          url_imagen: "",
        },
      ],
      "que ocupo para hacer una instalacion de un foco"
    );
    assert.equal(hit?.sku, "CAB-12-THW");
  });
});
