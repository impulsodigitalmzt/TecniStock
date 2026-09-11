import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  asegurarCierreAbierto,
  cantidadDesdeConsulta,
  fusionarLineasPedido,
  lineaDesdeInventario,
  pideCerrarCuenta,
  ultimoTextoUsuario,
} from "./cuenta-abierta.ts";

describe("cuenta abierta de mostrador", () => {
  it("lee cantidades de mostrador y no confunde 220 V", () => {
    assert.equal(cantidadDesdeConsulta("dame 3 cintas de teflon"), 3);
    assert.equal(cantidadDesdeConsulta("un foco LED"), 1);
    assert.equal(cantidadDesdeConsulta("acometida de 220v"), 1);
    assert.equal(cantidadDesdeConsulta("dos contactos duplex"), 2);
  });

  it("acumula líneas del mismo SKU en la cuenta", () => {
    const cuenta = fusionarLineasPedido(
      [{ sku: "TEF-12", nombre: "Cinta teflón", cantidad: 1, precio: 12 }],
      [{ sku: "TEF-12", nombre: "Cinta teflón", cantidad: 2, precio: 12 }]
    );
    assert.equal(cuenta.length, 1);
    assert.equal(cuenta[0]?.cantidad, 3);
  });

  it("no mete a la cuenta lo que no tiene existencia", () => {
    assert.equal(lineaDesdeInventario({ sku: "X", nombre: "Nada", stock_disponible: 0, precio: 10 }), null);
    assert.equal(lineaDesdeInventario({ sku: "F-1", nombre: "Foco", stock_disponible: 4, precio: 25 }, 8)?.cantidad, 4);
  });

  it("mantiene la cuenta abierta salvo cierre explícito", () => {
    assert.equal(pideCerrarCuenta("también cinta de teflón"), false);
    assert.equal(pideCerrarCuenta("es todo"), true);
    assert.match(asegurarCierreAbierto("Ya lo agregué a tu lista."), /Se te ofrece algo más/);
    assert.equal(asegurarCierreAbierto("¿Se te ofrece algo más o con esto cerramos?"), "¿Se te ofrece algo más o con esto cerramos?");
  });

  it("toma el último turno del cliente si mandan el hilo completo", () => {
    assert.equal(
      ultimoTextoUsuario(
        [
          { role: "user", content: "acometida 220" },
          { role: "assistant", content: "Te armé el paquete" },
          { role: "user", content: "y cinta de teflón" },
        ],
        ""
      ),
      "y cinta de teflón"
    );
  });
});
