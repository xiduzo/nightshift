import { afterEach, beforeEach } from "bun:test";
import { createSandbox, type Sandbox } from "./test-support";

/**
 * A new sandbox for each test of the file (or of the `describe` it stands
 * in), cleaned up after it: the runners and the engines made over it end
 * with it. The value stands for the sandbox of the test that runs, so a
 * test reads it only inside a hook or a test.
 */
export function sandboxPerTest(): Sandbox {
	let current: Sandbox | null = null;
	beforeEach(async () => {
		current = await createSandbox();
	});
	afterEach(async () => {
		await current?.cleanup();
		current = null;
	});
	return new Proxy({} as Sandbox, {
		get(_, name) {
			if (!current) throw new Error("No test runs: there is no sandbox.");
			return Reflect.get(current, name);
		},
	});
}
