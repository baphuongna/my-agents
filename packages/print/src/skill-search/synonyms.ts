/**
 * Tu dong ngu (synonym dictionary) — SPEC §5.2.
 * Moi entry key → danh sach tu dong ngu, cho phep expand query.
 */
import { tokenize } from "./text.ts";

/**
 * Bang tu dong ngu. Moi key danh cho cac tu co cung nghia.
 * Bidirectional — moi cap phai duoc mirror thuan nghich.
 */
export const SYNONYMS: Record<string, string[]> = {
	// Chemistry
	molecule: ["molecular", "molecules", "compound"],
	molecular: ["molecule", "molecules", "compound"],
	drug: ["pharmaceutical", "medicinal"],
	chem: ["chemistry", "chemical", "rdkit", "cheminformatics"],
	docking: ["dock", "binding", "pose", "diffdock"],
	admet: ["absorption", "distribution", "metabolism", "excretion", "toxicity"],
	metabolism: ["metabolic", "metabolite", "pathway", "flux"],
	metabolic: ["metabolism", "metabolite", "pathway", "flux"],
	smiles: ["rdkit", "molecular", "cheminformatics", "compound"],

	// Biology
	gene: ["genomic", "genomics", "sequence", "dna", "rna"],
	protein: ["proteomics", "peptide", "amino acid"],
	"single-cell": ["scrna-seq", "single cell", "scrnaseq", "scanpy", "anndata"],
	"rna-seq": ["transcriptom", "rna seq", "expression", "scrna"],
	dna: ["genome", "genomic", "sequence", "biopython"],
	sequence: ["dna", "rna", "protein", "genome", "alignment"],

	// ML
	ml: ["machine learning", "machine-learning"],
	dl: ["deep learning", "deep-learning", "neural network"],
	nlp: ["natural language", "text mining"],

	// Clinical
	clinical: ["medical", "patient", "healthcare"],

	// Physics
	quantum: ["qubit", "quantum computing"],

	// General
	viz: ["visualization", "plotting", "chart", "matplotlib", "seaborn"],
	stats: ["statistics", "statistical", "scipy"],
	db: ["database"],
	// Search & tools
	pdf: ["markitdown", "convert", "document"],
	markitdown: ["pdf", "convert", "document", "docx", "pptx"],
	// Agent/dev workflow
	delegation: ["subagent", "dispatch", "parallel"],
	parallel: ["concurrent", "delegation", "dispatch"],
	agent: ["subagent", "delegation", "worker"],
	// Lab
	robot: ["opentrons", "pylabrobot", "automation"],
	opentrons: ["robot", "lab automation", "liquid handling"],
	// Neural network
	"neural network": ["pytorch", "deep learning", "tensorflow"],
	"deep learning": ["pytorch", "neural network", "tensorflow"],
};

/**
 * Expand query tokens voi tu dong ngu.
 * Tokenize query truoc, sau do union them tat ca synonym values.
 */
export function expandQuery(query: string): Set<string> {
	const tokens = tokenize(query);
	const expanded = new Set(tokens);

	for (const token of tokens) {
		const synonyms = SYNONYMS[token];
		if (synonyms) {
			for (const syn of synonyms) {
				// Tokenize moi synonym vi co the la multi-word ("machine learning")
				const synTokens = tokenize(syn);
				for (const st of synTokens) {
					expanded.add(st);
				}
			}
		}
	}

	return expanded;
}
