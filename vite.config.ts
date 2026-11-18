import { existsSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const searchProxy = {
	"/api": {
		target: "http://127.0.0.1:8788",
		changeOrigin: false,
	},
};

export default defineConfig(({ command }) => {
	const plugins = [...react()];
	if (command === "serve") {
		plugins.push({
			name: "dev-style-hmr-csp",
			transformIndexHtml(html) {
				return html.replace(
					"style-src 'self';",
					"style-src 'self' 'unsafe-inline';",
				);
			},
		} as Plugin);
	}
	return {
		base: process.env.VITE_BASE_PATH ?? "/",
		plugins: [
			...plugins,
			{
				name: "pages-index-output",
				closeBundle() {
					const appHtml = resolve(process.cwd(), "dist/app.html");
					const indexHtml = resolve(process.cwd(), "dist/index.html");
					if (existsSync(appHtml)) renameSync(appHtml, indexHtml);
				},
			},
		],
		server: { proxy: searchProxy },
		preview: { proxy: searchProxy },
		build: {
			manifest: true,
			chunkSizeWarningLimit: 600,
			rollupOptions: {
				input: { index: resolve(process.cwd(), "app.html") },
			},
		},
	};
});
