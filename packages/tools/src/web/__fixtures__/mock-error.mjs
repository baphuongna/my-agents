// Mock search module — always throws (error-propagation test).
// Used by bounded-search.test.ts.
export async function search() {
  throw new TypeError("Mock search failure");
}
