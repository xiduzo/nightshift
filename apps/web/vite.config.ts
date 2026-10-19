import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { varlockVitePlugin } from "@varlock/vite-integration";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	server: {
		port: 3001,
	},
	// The prerender serves the build to itself and fetches its pages. In a
	// container `localhost` binds `::1` while the fetch dials `127.0.0.1`
	// (deploy/Dockerfile): name the address.
	preview: {
		host: "127.0.0.1",
	},
	resolve: {
		tsconfigPaths: true,
	},
	plugins: [
		varlockVitePlugin({ ssrInjectMode: "auto-load" }),
		tailwindcss(),
		tanstackStart({
			prerender: {
				enabled: true,
			},
		}),
		viteReact(),
	],
});
