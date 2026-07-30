import { defineConfig } from "vitest/config";

// pi-agent-core + pi-ai + pi-tui all resolve from node_modules (@earendil-works/* npm packages).

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		testTimeout: 30000,
		reporters: process.env.GITHUB_ACTIONS ? ["dot", "github-actions"] : ["dot"],
		silent: "passed-only",
		server: {
			deps: {
				external: [/@silvia-odwyer\/photon-node/],
			},
		},
	},
});
