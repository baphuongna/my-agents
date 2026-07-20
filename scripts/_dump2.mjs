import { browserNavigateTool } from '/home/bom/source/my-agent/packages/tools/dist/index.js';
const n=await browserNavigateTool.run({url:"https://duckduckgo.com/",taskId:"dp"},undefined);
const snap=((n.output||{}).snapshot)||"";
const fs=await import('node:fs');
fs.writeFileSync('/tmp/camofox-ddg.txt', snap);
console.log("snapshot saved:", snap.length, "chars → /tmp/camofox-ddg.txt");
