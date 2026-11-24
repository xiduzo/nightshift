import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	allowing,
	inMemoryAccess,
} from "../../access/adapters/out/in-memory-access";
import {
	inMemoryComputer,
	ONLY_THE_OWNER,
} from "../../access/computer/adapters/out/in-memory-computer";
import type { PersonActor } from "../../contract";
import { inMemorySecretsPorts } from "../../secrets/scopes/adapters/out/in-memory-neighbours";
import { createSandbox, type Sandbox } from "../../testing/test-support";
import { wireConnections } from "./wire";

/** The reads of a person reach the secrets as the Person who asks, and as nobody else. */

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

async function wired() {
	const computer = inMemoryComputer();
	const access = inMemoryAccess();
	const neighbours = inMemorySecretsPorts();
	const connections = wireConnections({
		computerAccess: computer,
		access,
		document: await sandbox.openDocument(),
		env: {},
		secrets: {
			get: async () => null,
			set: async () => {},
			delete: async () => {},
		},
		projects: () => neighbours.projectTwin,
	});
	return { computer, access, neighbours, connections };
}

test("only the owner of this computer lists its secrets", async () => {
	const { computer, connections } = await wired();
	expect(await computer.whoMay((actor) => connections.secrets(actor))).toEqual(
		ONLY_THE_OWNER,
	);
});

test("a Member lists the secrets of a Space and of a project, and the keeper gets that Member", async () => {
	const { access, neighbours, connections } = await wired();
	const project = { spaceId: "space-1", projectId: "p1" };
	const everyMember = allowing("owner", "admin", "member", "viewer");
	for (const list of [
		(actor: PersonActor) => connections.spaceSecrets(actor, "space-1"),
		(actor: PersonActor) => connections.projectSecrets(actor, project),
	]) {
		expect(
			await access.whoMay("space-1", (actor) => list(actor as PersonActor)),
		).toEqual(everyMember);
		neighbours.projectTwin.calls.length = 0;
		await list(access.as("viewer", "space-1")).catch(() => {});
		const asked = neighbours.projectTwin.calls.map((call) => call.args.at(-1));
		expect(new Set(asked)).toEqual(new Set(["the-viewer"]));
	}
});
