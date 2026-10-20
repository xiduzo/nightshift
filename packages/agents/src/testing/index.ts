/**
 * Test helpers of `@nightshift/agents`: a fake harness and a fake decider
 * that follow a script, and the fake programs in `fixtures/`. Only tests
 * import this entry.
 */
import { join } from "node:path";

export {
	type FakeHarness,
	failingScript,
	fakeDecider,
	fakeHarness,
	reportingScript,
	usageLimitScript,
} from "./fake";

/**
 * The absolute path of a fixture program, such as `fake-claude.ts` or
 * `fake-mcp.ts`. A test runs it with `process.execPath`.
 */
export function fixturePath(name: string): string {
	return join(import.meta.dir, "fixtures", name);
}
