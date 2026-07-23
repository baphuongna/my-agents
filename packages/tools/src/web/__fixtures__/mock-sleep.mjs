// Mock search module — sleeps 60s; parent should kill before completion.
// Used by bounded-search.test.ts for timeout and interrupt tests.
export async function search() {
  await new Promise((resolve) => setTimeout(resolve, 60_000));
  return [];
}
