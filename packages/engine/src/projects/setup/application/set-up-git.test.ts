import { describe, expect, test } from "bun:test";
import { inMemorySetupPorts } from "../adapters/out/in-memory-neighbours";
import { NO_IDENTITY, STARTER_GITIGNORE } from "../domain/readiness";
import { checkProjectFolder } from "./check-project-folder";
import { setUpGit } from "./set-up-git";

/** The use case setUpGit, on in-memory adapters. */

function setUp() {
	const ports = inMemorySetupPorts();
	const check = checkProjectFolder(ports);
	return { ports, run: setUpGit({ folders: ports.folders, check }) };
}

describe("setUpGit", () => {
	test("makes a repository, a .gitignore and a first commit, with the name and email given", async () => {
		const { ports, run } = setUp();
		ports.folders.folder("/app");
		const readiness = await run({
			path: "/app",
			name: " Ada ",
			email: "ada@example.com",
		});
		expect(readiness.ready).toBe(true);
		expect(ports.folders.done).toEqual([
			"init /app",
			"user.name Ada",
			"user.email ada@example.com",
			"gitignore /app",
			"commit Initial commit",
		]);
		expect(ports.folders.folders.get("/app")?.gitignore).toBe(
			STARTER_GITIGNORE,
		);
	});

	test("refuses without a name and email, after it made the repository", async () => {
		const { ports, run } = setUp();
		ports.folders.folder("/app");
		await expect(run({ path: "/app" })).rejects.toThrow(NO_IDENTITY);
		expect(ports.folders.done).toEqual(["init /app"]);
	});

	test("refuses a subfolder, and changes nothing", async () => {
		const { ports, run } = setUp();
		ports.folders.repository("/app", 1);
		ports.folders.subfolder("/app/docs", "/app");
		await expect(run({ path: "/app/docs" })).rejects.toThrow(
			"inside the project",
		);
		expect(ports.folders.done).toEqual([]);
	});

	test("a ready folder stays as it is", async () => {
		const { ports, run } = setUp();
		ports.folders.repository("/app", 1);
		expect((await run({ path: "/app" })).ready).toBe(true);
		expect(ports.folders.done).toEqual([]);
	});
});
