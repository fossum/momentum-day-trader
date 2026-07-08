const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const target = `import { createServer as createViteServer } from "vite";`;
const replacement = `import { createServer as createViteServer } from "vite";
import crypto from "crypto";`;

if(code.includes(target) && !code.includes("import crypto")){
  code = code.replace(target, replacement);
  fs.writeFileSync('server.ts', code);
  console.log("Replaced crypto");
} else {
  console.log("Not found crypto");
}
