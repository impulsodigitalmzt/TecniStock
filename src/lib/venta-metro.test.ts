import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cotizarVentaMetro,
  esMaterialCortable,
  extraerMetrosPedido,
  metrosSugeridosTrabajo,
  pideRolloCompleto,
  precioPorMetro,
} from "./venta-metro.ts";

describe("venta por metro de mostrador", () => {
  const rollo10 = {
    sku: "CAB-10-THW",
    nombre: "Rollo de cable THW-LS Calibre 10 (100m)",
    precio: 1450,
    existencia: 5,
  };
  const metro14 = {
    sku: "CAB-THW-14",
    nombre: "Cable THW calibre 14 AWG",
    precio: 14.5,
    existencia: 80,
  };
  const tubo = {
    sku: "TUBO-CON-50",
    nombre: "Tubo conduit pared delgada 1/2 pulgada",
    precio: 92,
    existencia: 25,
    descripcion: "tramo de 3 m para protección de cableado",
  };

  it("lee metros y centímetros del cliente", () => {
    assert.equal(extraerMetrosPedido("me das 3 metros del cable 10"), 3);
    assert.equal(extraerMetrosPedido("dame 1 metro de tubo"), 1);
    assert.equal(extraerMetrosPedido("30 cms de cobre"), 0.3);
    assert.equal(extraerMetrosPedido("un metro de pvc"), 1);
    assert.equal(extraerMetrosPedido("el rollo de 100m es mucho, ocupo 5 metros"), 5);
  });

  it("una instalación de foco sugiere 3 m, no el rollo", () => {
    assert.equal(metrosSugeridosTrabajo("que ocupo para hacer una instalacion de un foco"), 3);
    assert.equal(pideRolloCompleto("me das el rollo de calibre 10"), true);
  });

  it("el rollo de 100 m se cotiza por metro", () => {
    assert.equal(esMaterialCortable(rollo10.nombre, rollo10.sku), true);
    assert.equal(precioPorMetro(rollo10), 14.5);
    const corte = cotizarVentaMetro(rollo10, "me das 3 metros del cable 10");
    assert.equal(corte.unidad, "m");
    assert.equal(corte.cantidad, 3);
    assert.equal(corte.precio, 14.5);
    assert.equal(corte.cantidad * corte.precio, 43.5);
    assert.match(corte.nombre, /3 m/);
  });

  it("si pide el rollo, cobra el paquete completo", () => {
    const rollo = cotizarVentaMetro(rollo10, "me das el rollo de calibre 10");
    assert.equal(rollo.unidad, "pza");
    assert.equal(rollo.cantidad, 1);
    assert.equal(rollo.precio, 1450);
  });

  it("el calibre 14 que ya está por metro no se divide", () => {
    const corte = cotizarVentaMetro(metro14, "dame 3 metros de calibre 14");
    assert.equal(corte.unidad, "m");
    assert.equal(corte.cantidad, 3);
    assert.equal(corte.precio, 14.5);
  });

  it("30 cm de tubo se cobran como 0.3 m del tramo de 3 m", () => {
    const corte = cotizarVentaMetro(tubo, "dame 30 cms de tubo conduit");
    assert.equal(corte.unidad, "m");
    assert.equal(corte.cantidad, 0.3);
    assert.equal(corte.precio, Math.ceil((92 / 3) * 100) / 100);
  });
});
