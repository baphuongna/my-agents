/**
 * Tokenization — chuyen text thanh set cua tokens.
 * Implement theo SPEC §5.3.
 */

/**
 * Tokenize text thanh Set cua lowercase tokens.
 * - Split hyphenated names (-, _, /)
 * - Remove punctuation va non-alphanumeric chars
 * - Skip 1-char tokens (deliberate trade-off)
 * - Deduplicate qua Set
 */
const STOPWORDS = new Set([
	"the",
	"a",
	"an",
	"is",
	"are",
	"was",
	"were",
	"be",
	"been",
	"being",
	"have",
	"has",
	"had",
	"do",
	"does",
	"did",
	"will",
	"would",
	"could",
	"should",
	"may",
	"might",
	"shall",
	"can",
	"to",
	"of",
	"in",
	"for",
	"on",
	"with",
	"at",
	"by",
	"from",
	"as",
	"into",
	"through",
	"during",
	"before",
	"after",
	"above",
	"below",
	"and",
	"or",
	"but",
	"not",
	"no",
	"nor",
	"it",
	"its",
	"this",
	"that",
	"these",
	"those",
	"i",
	"me",
	"my",
	"we",
	"our",
	"you",
	"your",
	"he",
	"she",
	"they",
	"them",
	"their",
	"what",
	"which",
	"who",
	"whom",
	"how",
	"when",
	"where",
	"why",
	"all",
	"each",
	"every",
	"both",
	"few",
	"more",
	"most",
	"other",
	"some",
	"such",
	"than",
	"too",
	"very",
	"just",
	"about",
	"also",
	"then",
	"up",
	"out",
	"if",
]);

export function tokenize(text: string): Set<string> {
	return new Set(
		text
			.toLowerCase()
			.replace(/[-_/]/g, " ")
			.replace(/[^a-z0-9\s]/g, "")
			.split(/\s+/)
			.filter((w) => w.length >= 2 && !STOPWORDS.has(w)),
	);
}
