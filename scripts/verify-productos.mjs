import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const raw = readFileSync(".dev.vars", "utf8");
const line = raw.split(/\r?\n/).find((item) => item.startsWith("DATABASE_URL="));
const url = (line?.slice("DATABASE_URL=".length) ?? "").replace("-pooler.", ".");
const sql = neon(url);
const rows = await sql`
  SELECT categoria, estado, count(*)::int AS n
  FROM productos
  GROUP BY categoria, estado
  ORDER BY categoria, estado
`;
const sample = await sql`SELECT id, nombre, categoria, precio, stock, estado, sustituto FROM productos WHERE sustituto IS NOT NULL ORDER BY id LIMIT 5`;
console.log(JSON.stringify({ resumen: rows, con_sustituto: sample }, null, 2));
