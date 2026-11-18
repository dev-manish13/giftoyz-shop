import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const PUBLIC_FILE = /^[a-z0-9][a-z0-9-]*\.(html|js|css|png|jpg|jpeg|webp|avif|svg|ico)$/;
const site = resolve(import.meta.dirname, "../..");
const out = resolve(import.meta.dirname, "../public");

rmSync(out, { recursive: true, force: true });
mkdirSync(out);
let count = 0;
for (const name of readdirSync(site)) {
  const from = join(site, name);
  if (PUBLIC_FILE.test(name) && statSync(from).isFile()) {
    copyFileSync(from, join(out, name));
    count++;
  }
}
console.log(`assets: ${count} public files`);
