import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import { loadDatabaseUrl } from "./lib/tecnistock-db.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const url = loadDatabaseUrl(root, { preferEnv: false });
const sql = neon(url);
const rows = await sql`
  SELECT categoria, estado, count(*)::int AS n
  FROM productos
  GROUP BY categoria, estado
  ORDER BY categoria, estado
`;
const sample = await sql`SELECT id, nombre, categoria, precio, stock, estado, sustituto FROM productos WHERE sustituto IS NOT NULL ORDER BY id LIMIT 5`;
console.log(JSON.stringify({ resumen: rows, con_sustituto: sample }, null, 2));
