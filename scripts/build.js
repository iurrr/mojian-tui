import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { stripTypeScriptTypes } from "node:module";

const source = readFileSync("src/main.ts", "utf8");
const output = stripTypeScriptTypes(source);
const mainTarget = "dist/main.js";
const cliTarget = "dist/cli.js";

mkdirSync(dirname(mainTarget), { recursive: true });
writeFileSync(mainTarget, output, "utf8");
writeFileSync(cliTarget, "#!/usr/bin/env node\n\nimport { main } from \"./main.js\";\n\nmain();\n", "utf8");
chmodSync(cliTarget, 0o755);
