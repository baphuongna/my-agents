import { browserNavigateTool } from '/home/bom/source/my-agent/packages/tools/dist/index.js';
const n=await browserNavigateTool.run({url:"https://duckduckgo.com/",taskId:"if"},undefined);
const snap=((n.output||{}).snapshot)||"";
console.log("snapshot len:", snap.length);
const lines=snap.split("\n");
// show all input-like lines (combobox/searchbox/textbox/input/edit) + their refs
const inputs=lines.filter(l=>/combobox|searchbox|textbox|\binput\b|\bedit\b/i.test(l));
console.log(`\n── ${inputs.length} input-like lines ──`);
inputs.slice(0,8).forEach(l=>console.log("  "+JSON.stringify(l.trim().slice(0,110))));
