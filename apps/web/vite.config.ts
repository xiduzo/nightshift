import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { varlockVitePlugin } from "@varlock/vite-integration";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	server: {
		port: 3001,
		// PROTOTYPE (sidebar nav): `PROTO_PORT=3003` serves this checkout beside
		// the main dev server and proxies the daemon, so its CORS still sees 3001.
		...(process.env.PROTO_PORT
			? {
					port: Number(process.env.PROTO_PORT),
					proxy: Object.fromEntries(
						["/rpc", "/api"].map((path) => [
							path,
							{
								target: "http://localhost:3000",
								ws: true,
								headers: { origin: "http://localhost:3001" },
							},
						]),
					),
				}
			: {}),
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
