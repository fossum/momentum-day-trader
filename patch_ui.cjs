const fs = require('fs');
let code = fs.readFileSync('src/components/ExecutionEngine.tsx', 'utf8');

const target1 = `        <div ref={terminalContainerRef} className="h-48 overflow-y-auto space-y-2 pr-1 custom-scrollbar">`;
const replacement1 = `        <div ref={terminalContainerRef} className="h-96 min-h-[16rem] max-h-[1200px] resize-y overflow-y-auto space-y-2 pr-1 custom-scrollbar">`;

if(code.includes(target1)){
  code = code.replace(target1, replacement1);
  fs.writeFileSync('src/components/ExecutionEngine.tsx', code);
  console.log("Replaced UI");
} else {
  console.log("Not found UI");
}
