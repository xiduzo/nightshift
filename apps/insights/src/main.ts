import { readEnv } from "@/shared/config";

import { start } from "./server";

if (import.meta.main) {
	try {
		await start(readEnv(process.env));
	} catch (error) {
		const message = error instanceof Error ? error.message : "";
		console.error(
			/password|postgres:\/\//i.test(message) || message === ""
				? "Night Shift did not start."
				: message,
		);
		process.exit(1);
	}
}
