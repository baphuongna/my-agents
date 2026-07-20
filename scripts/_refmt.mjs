import { browserNavigateTool } from '/home/bom/source/my-agent/packages/tools/dist/index.js';
const n=await browserNavigateTool.run({url:"https://duckduckgo.com/",taskId:"rf"},undefined);
const auto=(n.output||{}).snapshot||"";
const line=auto.split("\n").find(l=>/combobox/i.test(l));
console.log("combobox line exact:", JSON.stringify(line));
// show char codes around "ref"
const idx=line?.indexOf("ref");
if(idx>=0) console.log("around 'ref':", JSON.stringify(line.slice(idx,idx+12)), "→ codes:", [...line.slice(idx,idx+10)].map(c=>c.charCodeAt(0)));
