/**
 * Category classifier — phan loai skill theo category.
 * Implement theo SPEC §6.1 rules va §6.2 logic.
 *
 * Luu y: Word-boundary matching cho single-word keywords de tranh false positives.
 * Multi-word keywords (phrases) match exact substring.
 */
export interface CategoryRule {
	name: string;
	keywords: string[];
	maxExamples: number;
}

/**
 * 14 category rules tu SPEC §6.1.
 * Thu tu khai bao quyet dinh thu tu trong summary output.
 */
export const CATEGORY_RULES: CategoryRule[] = [
	{
		name: "Cheminformatics & Drug Discovery",
		keywords: [
			"molecular",
			"molecule",
			"drug",
			"compound",
			"chemic",
			"smiles",
			"docking",
			"fingerprint",
			"admet",
			"cheminformatics",
			"medicinal",
			"rdkit",
			"virtual screening",
			"lead optim",
		],
		maxExamples: 5,
	},
	{
		name: "Bioinformatics & Genomics",
		keywords: [
			"gene",
			"genomic",
			"rna-seq",
			"single-cell",
			"transcriptom",
			"protein",
			"sequence",
			"variant",
			"alignment",
			"phylogen",
			"pathway",
			"gene regul",
			"anndata",
			"h5ad",
			"neural recording",
			"neuropixel",
			"spikeglx",
			"openephys",
			"electrophysiolog",
			"cytometry",
			"imaging",
			"radiology",
			"pathology",
			"knowledge graph",
			"microscopy",
		],
		maxExamples: 5,
	},
	{
		name: "Machine Learning & AI",
		keywords: [
			"machine learning",
			"deep learning",
			"neural network",
			"reinforcement learn",
			"gradient boost",
			"random forest",
			"model train",
			"pytorch",
			"tensorflow",
			"transformer",
			"gan",
			"cnn",
			"rnn",
			"lstm",
			"interpret",
			"shap",
			"feature engineer",
			"scikit",
			"sklearn",
			"quantum comput",
			"probabilistic",
			"bayesian",
			"mcmc",
		],
		maxExamples: 5,
	},
	{
		name: "Clinical & Medical",
		keywords: [
			"clinical",
			"patient",
			"medical",
			"diagnosis",
			"treatment",
			"ehr",
			"electronic health",
			"hospital",
			"therap",
			"trial",
			"icd",
			"hipaa",
		],
		maxExamples: 5,
	},
	{
		name: "Data Visualization & EDA",
		keywords: [
			"visualization",
			"plotting",
			"chart",
			"datafram",
			"eda",
			"network analysis",
			"time series",
			"forecast",
		],
		maxExamples: 5,
	},
	{
		name: "Scientific Writing & Communication",
		keywords: [
			"writing",
			"paper",
			"publication",
			"peer review",
			"citation",
			"bibtex",
			"literature",
			"poster",
			"slide",
			"schematic",
			"infographic",
			"markdown",
			"document convert",
			"report",
			"research proposal",
			"latex",
		],
		maxExamples: 5,
	},
	{
		name: "Geospatial & Remote Sensing",
		keywords: [
			"geospatial",
			"gis",
			"satellite",
			"spatial",
			"terrain",
			"remote sensing",
			"raster",
			"vector",
			"coordinate",
			"map",
		],
		maxExamples: 5,
	},
	{
		name: "Lab Automation & Integration",
		keywords: [
			"lab",
			"laboratory",
			"liquid handl",
			"plate reader",
			"workflow automat",
			"lims",
			"pipette",
			"robot",
			"opentrons",
			"benchling",
			"latchbio",
			"microscopy",
			"hpc",
		],
		maxExamples: 5,
	},
	{
		name: "Time Series & Forecasting",
		keywords: ["time series", "forecast", "anomaly detect", "signal process", "timesfm", "aeon"],
		maxExamples: 5,
	},
	{
		name: "Materials Science & Engineering",
		keywords: [
			"crystal",
			"material",
			"phase diagram",
			"metabolic model",
			"simulation",
			"optimization",
			"pymoo",
			"simpy",
			"pymatgen",
			"fluid dynamics",
			"navier-stokes",
			"turbulence",
		],
		maxExamples: 5,
	},
	{
		name: "Research Methodology",
		keywords: [
			"hypothesis",
			"brainstorm",
			"critical thinking",
			"grant",
			"scholar",
			"peer review",
			"reproducib",
			"experimental design",
			"nsf",
			"nih",
			"doe",
			"darpa",
			"proposal",
		],
		maxExamples: 5,
	},
	{
		name: "Integration Platforms",
		keywords: ["benchling", "modal", "streamlit", "gradio", "api", "rest", "webhook", "service", "deploy"],
		maxExamples: 5,
	},
	{
		name: "Developer Tools & Workflow",
		keywords: ["debug", "profile", "test", "ci/cd", "lint", "format", "types", "version control", "repo", "github"],
		maxExamples: 5,
	},
	{
		name: "AI Agent & Pi Extensions",
		keywords: [
			"agent",
			"crew",
			"team",
			"worker",
			"pipeline",
			"memory",
			"pi-extension",
			"extension",
			"pi-skill",
			"pi extension",
			"skill",
			"llm",
			"prompt",
			"task",
			"orchestrat",
			"async",
			"parallel",
			"pi-crew",
			"pi crew",
			"autonomous",
			"react-agent",
			"react agent",
			"codegen",
			"code generat",
			"browser-agent",
			"browser agent",
			"langchain",
			"langgraph",
			"crewai",
			"ultraqa",
			"ultragoal",
			"omc ",
			"claude mem",
			"deep-interview",
			"deep interview",
			"deepinit",
			"deep codebase",
			"learner",
			"make-plan",
			"make plan",
			"mcp",
			"code review",
			"pull request",
			"subagent",
			"dispatching",
			"executing plan",
			"verification-before",
			"systematic debug",
			"semantic compress",
			"smart-explore",
			"smart explore",
			"consciousness",
			"hud",
			"autoresearch",
			"self-improve",
			"babysit",
			"writer-memory",
			"writer memory",
			"visual-verdict",
			"visual verdict",
			"external-context",
			"external context",
			"remember",
			"system prompt",
			"spec-kit",
			"community extension",
			"verify",
			"plan",
			"finishing",
			"development branch",
			"learn-codebase",
			"semantic-compression",
			"systematic-debugging",
		],
		maxExamples: 5,
	},
];

/**
 * Phan loai skill vao cac categories.
 * Word-boundary matching: keyword phai la mot "word" trong text.
 * Multi-word keywords (phrases) phai xuat hien exactly trong text.
 * Gioi han false positives nhu "gene" matching "generation".
 */
export function classify(entry: { name: string; description: string }): string[] {
	const text = `${entry.name} ${entry.description}`.toLowerCase();
	const matched: string[] = [];

	for (const rule of CATEGORY_RULES) {
		if (rule.keywords.some((kw) => matchKeyword(kw, text))) {
			matched.push(rule.name);
		}
	}

	return matched.length > 0 ? matched : ["Other"];
}

/**
 * Match keyword trong text voi word-boundary semantics.
 * - Single-word keyword: phai la mot "word" (bounded boi non-alphanumeric/start/end)
 * - Multi-word keyword: phai xuat hien exactly trong text
 */
function matchKeyword(keyword: string, text: string): boolean {
	const kw = keyword.toLowerCase();
	if (kw.includes(" ")) {
		// Multi-word: exact substring match
		return text.includes(kw);
	}
	// Single-word: word boundary match
	// Match: bounded by non-alphanumeric or start/end
	const pattern = new RegExp(`(?:[^a-z0-9]|^)${escapeRegex(kw)}(?:[^a-z0-9]|$)`, "i");
	return pattern.test(text);
}

/**
 * Escape regex special characters.
 */
function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
