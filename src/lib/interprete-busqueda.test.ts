import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  filaPerteneceAFamilia,
  interpretarPieza,
  interpretarTexto,
} from "./interprete-busqueda.ts";

describe("intérprete de búsqueda TecniStock", () => {
  it("corrige 'apagodor' a familia apagador", () => {
    const intencion = interpretarTexto("apagodor sencillo");
    assert.equal(intencion.familia, "apagador");
    assert.equal(intencion.rubro, "electricidad");
    assert.ok(intencion.tokens.includes("apagador"));
    assert.ok(!intencion.tokens.includes("contacto"));
    assert.equal(intencion.canonico.split(" ")[0], "apagador");
    assert.ok(filaPerteneceAFamilia("Apagador sencillo 127 V", "INT-SENC-127", intencion.familia));
    assert.ok(!filaPerteneceAFamilia("Módulo cargador USB doble para placa (Acero / Plata)", "INT-USB-PLT", intencion.familia));
    assert.ok(!filaPerteneceAFamilia("Contacto dúplex aterrizado", "CONT-DUP-127", intencion.familia));
  });

  it("entiende 'tomo corrinte' como contacto, no como apagador", () => {
    const intencion = interpretarTexto("tomo corrinte");
    assert.equal(intencion.familia, "contacto");
    assert.equal(intencion.rubro, "electricidad");
    assert.ok(intencion.canonico.startsWith("contacto"));
    assert.ok(!intencion.canonico.includes("tomo"));
    assert.ok(!intencion.canonico.includes("corrinte"));
    assert.ok(intencion.familiasExcluidas.includes("apagador"));
    assert.ok(!filaPerteneceAFamilia("Apagador sencillo 127 V", "INT-SENC-127", intencion.familia));
    assert.ok(filaPerteneceAFamilia("Contacto dúplex aterrizado", "CONT-DUP-127", intencion.familia));
  });

  it("no cruza interruptor termomagnético con un apagador de pared", () => {
    const intencion = interpretarTexto("pastilla termomagnetica 20A");
    assert.equal(intencion.familia, "breaker");
    assert.ok(!filaPerteneceAFamilia("Apagador sencillo 127 V", "INT-SENC-127", intencion.familia));
    assert.ok(filaPerteneceAFamilia("Interruptor termomagnético 1x20A", "TMT-1P-20A", intencion.familia));
  });

  it("clasifica visión estructurada de un contacto sin mezclar apagadores", () => {
    const intencion = interpretarPieza({
      nombre: "Contacto dúplex",
      producto_venta: "contacto duplex",
      material: "plástico",
      medida: "2 módulos",
      categoria: "electricidad",
      palabras_clave: ["contacto", "duplex", "aterrizado"],
    });
    assert.equal(intencion.familia, "contacto");
    assert.ok(intencion.familiasExcluidas.includes("apagador"));
    assert.ok(!intencion.tokens.includes("apagador"));
  });

  it("mantiene plomería fuera de electricidad", () => {
    const intencion = interpretarTexto("valbula de esfera 1/2");
    assert.equal(intencion.familia, "valvula");
    assert.equal(intencion.rubro, "plomeria");
  });
});
