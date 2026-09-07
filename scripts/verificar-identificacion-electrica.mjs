import { alinearIdentificacionElectrica } from "../src/lib/pieza-ia.ts";

function caso(titulo, pieza, espera) {
  const out = alinearIdentificacionElectrica(pieza);
  const ok =
    out.nombre.toLowerCase().includes(espera.nombre) &&
    out.vozDatos === espera.vozDatos &&
    (espera.producto ? out.producto_venta.toLowerCase().includes(espera.producto) : true);
  console.log(ok ? "OK " : "FAIL ", titulo, "→", out.nombre, "|", out.producto_venta, "| vozDatos=", out.vozDatos);
  if (!ok) process.exitCode = 1;
}

caso(
  "sesgo RJ45 con clavija_127",
  {
    nombre: "Placa de voz y datos RJ45",
    producto_venta: "placa de voz y datos RJ45",
    accesorios_visibles: "cable negro enchufado",
    descripcion: "Placa con jack RJ45 y cable conectado.",
    mecanismo: "jack RJ45",
    palabras_clave: ["placa", "datos", "rj45", "jack"],
    conexion_visible: "clavija_127",
  },
  { nombre: "contacto", producto: "contacto", vozDatos: false }
);

caso(
  "modelo dijo Contacto pero producto_venta RJ45",
  {
    nombre: "Contacto dúplex",
    producto_venta: "placa de voz y datos RJ45",
    accesorios_visibles: "clavija de 127 V",
    descripcion: "Contacto con clavija conectada.",
    mecanismo: "orificios 127 V",
    palabras_clave: ["contacto", "duplex"],
    conexion_visible: "clavija_127",
  },
  { nombre: "contacto", producto: "contacto", vozDatos: false }
);

caso(
  "RJ45 real con jack_red",
  {
    nombre: "Placa de voz y datos RJ45",
    producto_venta: "placa de voz y datos RJ45",
    accesorios_visibles: "patch UTP",
    descripcion: "Placa blanca con jack RJ45 y cable de red delgado.",
    mecanismo: "jack RJ45",
    palabras_clave: ["placa", "datos", "rj45", "jack"],
    conexion_visible: "jack_red",
  },
  { nombre: "placa", producto: "placa", vozDatos: true }
);

caso(
  "apagador con teclas",
  {
    nombre: "Apagador doble",
    producto_venta: "apagador doble",
    accesorios_visibles: "",
    descripcion: "Dos teclas en placa de acero.",
    mecanismo: "teclas",
    palabras_clave: ["apagador", "doble"],
    conexion_visible: "tecla_apagador",
  },
  { nombre: "apagador", vozDatos: false }
);

caso(
  "forma grande+grueso gana al nombre RJ45",
  {
    nombre: "Placa de voz y datos RJ45",
    producto_venta: "placa de voz y datos RJ45",
    accesorios_visibles: "Cable de red RJ45",
    descripcion: "Placa con jack RJ45.",
    mecanismo: "Jack RJ45",
    palabras_clave: ["placa", "datos", "rj45"],
    conexion_visible: "jack_red",
    conector_tamano: "grande",
    cable_grosor: "grueso",
    conector_pines: "no_visible",
  },
  { nombre: "contacto", producto: "contacto", vozDatos: false }
);

caso(
  "combo apagador + contacto no se reduce a Contacto",
  {
    nombre: "Placa de dos módulos plateada",
    producto_venta: "placa",
    accesorios_visibles: "clavija de 127 V en el módulo inferior",
    descripcion: "Placa de instalación de dos módulos. Arriba hay un apagador de tecla. Abajo un tomacorriente con enchufe.",
    mecanismo: "no_visible",
    palabras_clave: ["placa", "doble"],
    conexion_visible: "clavija_127",
    modulos_vistos: ["apagador", "contacto"],
  },
  { nombre: "apagador", producto: "contacto", vozDatos: false }
);


