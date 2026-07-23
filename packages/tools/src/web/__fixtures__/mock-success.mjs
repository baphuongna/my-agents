// Mock search module — returns valid SearchResult[] without network.
// Used by bounded-search.test.ts.
export async function search(query, limit) {
  const count = Math.max(1, Math.min(limit, 3));
  return Array.from({ length: count }, (_, i) => ({
    title: `Result ${i + 1} for "${query}"`,
    url: `https://example.com/${i + 1}`,
    description: `Description for result ${i + 1}`,
    position: i + 1,
  }));
}
