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

  it("el texto 'placa de contacto duplex' también se queda en familia placa", () => {
    const intencion = interpretarTexto("placa de contacto duplex");
    assert.equal(intencion.familia, "placa");
    assert.ok(filaPerteneceAFamilia("Placa de acero inoxidable de 1 módulo", "PLAC-ACEO-01", intencion.familia));
  });

  it("una placa de contacto dúplex se busca como placa, no como contacto", () => {
    const intencion = interpretarPieza({
      nombre: "Placa de contacto eléctrico dúplex",
      producto_venta: "contacto duplex",
      material: "plástico",
      medida: "1 módulo",
      categoria: "electricidad",
      mecanismo: "receptáculo dúplex",
      palabras_clave: ["placa", "contacto", "duplex", "plateado"],
    });
    assert.equal(intencion.familia, "placa");
    assert.ok(intencion.tokens.includes("placa"));
    assert.ok(intencion.canonico.startsWith("placa"));
    assert.ok(filaPerteneceAFamilia("Placa de acero inoxidable de 1 módulo", "PLAC-ACEO-01", intencion.familia));
    assert.ok(filaPerteneceAFamilia("Placa de acero inoxidable de 2 módulos", "PLAC-ACEO-02", intencion.familia));
    assert.ok(!filaPerteneceAFamilia("Contacto dúplex aterrizado", "CONT-DUP-127", intencion.familia));
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

  it("no convierte una llave de baño en apagador por la palanca", () => {
    const intencion = interpretarPieza({
      nombre: "Grifo de lavabo monomando",
      producto_venta: "Grifo de lavabo",
      material: "Metal cromado",
      medida: "Estándar",
      categoria: "plomeria",
      mecanismo: "Palanca monomando",
      palabras_clave: ["grifo", "lavabo", "monomando", "visible", "Palanca"],
    });
    assert.equal(intencion.rubro, "plomeria");
    assert.equal(intencion.familia, "mezcladora");
    assert.ok(!intencion.tokens.includes("apagador"));
    assert.ok(!intencion.tokens.includes("palanca"));
    assert.ok(intencion.familiasExcluidas.includes("apagador"));
    assert.ok(!filaPerteneceAFamilia("Apagador sencillo 127 V", "INT-SENC-127", intencion.familia));
    assert.ok(filaPerteneceAFamilia("Mezcladora de lavabo monomando cromada", "MEZ-LAV-01", intencion.familia));
  });

  it("entiende 'llave de baño' como mezcladora, no como apagador", () => {
    const intencion = interpretarTexto("llave de baño");
    assert.equal(intencion.familia, "mezcladora");
    assert.equal(intencion.rubro, "plomeria");
    assert.ok(!filaPerteneceAFamilia("Apagador sencillo 127 V", "INT-SENC-127", intencion.familia));
  });

  it("sigue distinguiendo llave de paso (válvula) de llave de baño", () => {
    const paso = interpretarTexto("llave de paso 1/2");
    assert.equal(paso.familia, "valvula");
    assert.equal(paso.rubro, "plomeria");
  });

  it("corrige 'cista de teflon' a cinta PTFE de plomería", () => {
    const intencion = interpretarTexto("cista de teflon");
    assert.equal(intencion.familia, "cinta");
    assert.equal(intencion.rubro, "plomeria");
    assert.equal(intencion.subtipo, "teflon");
    assert.ok(intencion.canonico.includes("teflon"));
    assert.ok(filaPerteneceAFamilia("Cinta de teflón 1/2 pulg", "TEF-12", intencion.familia, intencion.subtipo));
    assert.ok(!filaPerteneceAFamilia("Cinta de aislar vinílica profesional", "CIN-AIS-3M", intencion.familia, intencion.subtipo));
  });

  it("entiende 'Dame nuestras tres cintas de teflon' sin pedir otra familia", () => {
    const intencion = interpretarTexto("Dame nuestras tres cintas de teflon");
    assert.equal(intencion.familia, "cinta");
    assert.equal(intencion.rubro, "plomeria");
    assert.equal(intencion.subtipo, "teflon");
    assert.ok(!intencion.tokens.includes("dame"));
    assert.ok(!intencion.tokens.includes("nuestras"));
    assert.ok(!intencion.tokens.includes("tres"));
    assert.equal(intencion.modulos, null);
  });

  it("no cruza cinta de aislar con teflón", () => {
    const intencion = interpretarTexto("cinta de aislar");
    assert.equal(intencion.familia, "cinta");
    assert.equal(intencion.rubro, "electricidad");
    assert.equal(intencion.subtipo, "aislar");
    assert.ok(filaPerteneceAFamilia("Cinta de aislar vinílica profesional", "CIN-AIS-3M", intencion.familia, intencion.subtipo));
    assert.ok(!filaPerteneceAFamilia("Cinta de teflón 1/2 pulg", "TEF-12", intencion.familia, intencion.subtipo));
  });

  it("corrige faltas de otras familias, no solo cinta", () => {
    const foco = interpretarTexto("foko led 10w");
    assert.equal(foco.familia, "foco");
    assert.equal(foco.rubro, "electricidad");
    const cable = interpretarTexto("cabre thw 12");
    assert.equal(cable.familia, "cable");
    assert.equal(cable.rubro, "electricidad");
    const tubo = interpretarTexto("tubo pvc 1/2");
    assert.equal(tubo.familia, "tubo");
    assert.equal(tubo.rubro, "plomeria");
    assert.ok(!filaPerteneceAFamilia("Tubo conduit 1/2", "TUBO-CON-50", tubo.familia));
  });
});
