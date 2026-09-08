/**
 * Compila el SPA en frontend/.
 *
 * Cloudflare instala Wrangler en la raíz (esbuild 0.28.1) y luego npm install
 * en frontend/. El postinstall de esbuild 0.21.5 (Vite) resuelve el binario
 * subiendo a node_modules del padre y falla: Expected "0.21.5" but got "0.28.1".
 *
 * Este script oculta el esbuild de la raíz, instala el frontend aislado
 * (sin scripts de postinstall) y corre Vite mientras el padre sigue oculto.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontend = path.join(root, "frontend");
const rootNm = path.join(root, "node_modules");

function hideRootEsbuild() {
  const hidden = [];
  if (!fs.existsSync(rootNm)) return hidden;

  for (const name of fs.readdirSync(rootNm)) {
    if (name === "esbuild" || name.startsWith("@esbuild") || name === ".bin") {
      if (name === ".bin") {
        const binEsbuild = path.join(rootNm, ".bin", "esbuild");
        const binEsbuildCmd = path.join(rootNm, ".bin", "esbuild.cmd");
        const binEsbuildPs = path.join(rootNm, ".bin", "esbuild.ps1");
        for (const bin of [binEsbuild, binEsbuildCmd, binEsbuildPs]) {
          if (!fs.existsSync(bin)) continue;
          const to = `${bin}.hidden-for-frontend-build`;
          fs.renameSync(bin, to);
          hidden.push([bin, to]);
        }
        continue;
      }
      const from = path.join(rootNm, name);
      const to = path.join(rootNm, `${name}.hidden-for-frontend-build`);
      fs.renameSync(from, to);
      hidden.push([from, to]);
    }
  }
  return hidden;
}

function restoreHidden(hidden) {
  for (const [from, to] of hidden) {
    if (!fs.existsSync(to)) continue;
    if (fs.existsSync(from)) fs.rmSync(from, { recursive: true, force: true });
    fs.renameSync(to, from);
  }
}

function run(command, cwd) {
  const env = { ...process.env };
  delete env.ESBUILD_BINARY_PATH;
  env.npm_config_install_strategy = "nested";
  execSync(command, { cwd, stdio: "inherit", env, shell: true });
}

fs.rmSync(path.join(frontend, "node_modules"), { recursive: true, force: true });

const hidden = hideRootEsbuild();
try {
  run(
    "npm install --include=dev --include=optional --install-strategy=nested --ignore-scripts",
    frontend,
  );
  run("npm run build", frontend);
} finally {
  restoreHidden(hidden);
}
