// PROTOTYPE, throw away. Runs the prototype beside the dev web app: its
// calls go through this server to the dev daemon, as the address the
// daemon accepts.
import { defineConfig, mergeConfig } from "vite";
import base from "./vite.config";

const daemon = {
	target: "http://localhost:3000",
	changeOrigin: true,
	ws: true,
	headers: { origin: "http://localhost:3001" },
};

export default mergeConfig(
	base,
	defineConfig({
		server: {
			port: 3002,
			strictPort: true,
			proxy: { "/rpc": daemon, "/api": daemon },
		},
	}),
);
