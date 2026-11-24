import { describe, expect, spyOn, test } from "bun:test";
import { createDb } from "@nightshift/db";
import { migrateDb } from "@nightshift/db/migrate";
import * as Y from "yjs";
import { inMemoryAccess } from "../access/adapters/out/in-memory-access";
import { inMemoryComputer } from "../access/computer/adapters/out/in-memory-computer";
import { NIGHT_SHIFT, type PersonActor } from "../contract";
import { openDeviceDocument } from "../documents";
import { inMemoryComputerSecrets } from "./scopes/adapters/out/in-memory-computer-secrets";
import {
	inMemoryPersonalSecrets,
	inMemoryProjectSecrets,
	inMemorySecretReferences,
} from "./scopes/adapters/out/in-memory-neighbours";
import { wireSecrets } from "./wire";

/**
 * The stop rules of the secrets slice, through the wire over a real
 * Device document: a value never reaches the document, the log or a
 * reply, and a read fails closed.
 */

const ADA: PersonActor = { personId: "ada", door: "session" };
const VALUE = "v4lue-that-must-not-leak";
const RUN = { spaceId: "space-1", projectId: "app", runId: "run-1" };

async function wired() {
	const db = createDb({ DATABASE_URL: ":memory:" });
	await migrateDb(db);
	const document = await openDeviceDocument({ db, deviceId: "device-1" });
	const computer = inMemoryComputerSecrets();
	const personal = inMemoryPersonalSecrets();
	const projects = inMemoryProjectSecrets();
	const access = inMemoryAccess();
	access.members.join("space-1", "ada", "member");
	const secrets = wireSecrets({
		computerAccess: inMemoryComputer({ id: () => "ada" }),
		access,
		document,
		env: { TOKEN: "env-fallback" },
		computer,
		references: inMemorySecretReferences([["TOKEN", ["github"]]]),
		personal: () => personal,
		projects: () => projects,
	});
	return { document, computer, personal, projects, secrets };
}

/** Every byte of the document, as text. */
const documentText = (document: { doc: Y.Doc }) =>
	new TextDecoder().decode(Y.encodeStateAsUpdate(document.doc));

describe("a secret value never reaches the document", () => {
	test("after a save, a use, a move and a removal, the document holds names and times only", async () => {
		const { document, computer, secrets } = await wired();
		await secrets.saveSecret(NIGHT_SHIFT, { name: "TOKEN", value: VALUE });
		expect(computer.values.get("TOKEN")).toBe(VALUE);
		expect(await secrets.readSecret({ name: "TOKEN" })).toBe(VALUE);
		await secrets.moveSecret(NIGHT_SHIFT, { name: "TOKEN", to: "personal" });
		await secrets.moveSecret(NIGHT_SHIFT, { name: "TOKEN", to: "computer" });
		await secrets.saveSecret(NIGHT_SHIFT, { name: "OTHER", value: VALUE });
		await secrets.removeSecret(NIGHT_SHIFT, { name: "OTHER" });
		await document.flush();
		const text = documentText(document);
		expect(text).toContain("TOKEN");
		expect(text).not.toContain(VALUE);
	});
});

describe("a secret value never reaches the log", () => {
	test("the lines logged when the Personal and Project secrets fail hold no value", async () => {
		const { personal, projects, secrets } = await wired();
		await secrets.saveSecret(NIGHT_SHIFT, { name: "TOKEN", value: VALUE });
		personal.fail(new Error("offline"));
		projects.fail(new Error("refused"));
		const warn = spyOn(console, "warn").mockImplementation(() => {});
		try {
			await secrets.readSecretEnv({ names: ["TOKEN"], use: { run: RUN } });
			await secrets.listSecretValues({ use: { run: RUN } });
			await secrets.listSecrets(NIGHT_SHIFT, {});
			const logged = JSON.stringify(
				warn.mock.calls.map((call) => call.map(String)),
			);
			expect(warn.mock.calls.length).toBeGreaterThan(0);
			expect(logged).not.toContain(VALUE);
		} finally {
			warn.mockRestore();
		}
	});
});

describe("a secret value never reaches a reply to a person", () => {
	test("the lists and the refusals name secrets, never their values", async () => {
		const { projects, secrets } = await wired();
		await secrets.saveSecret(NIGHT_SHIFT, { name: "TOKEN", value: VALUE });
		await secrets.saveProjectSecret(ADA, {
			project: RUN,
			name: "PROJ",
			value: VALUE,
		});
		const replies = [
			await secrets.listSecrets(NIGHT_SHIFT, {}),
			await secrets.listProjectSecrets(ADA, {
				project: RUN,
			}),
			await secrets.listSpaceSecrets(ADA, {
				spaceId: "space-1",
			}),
		];
		projects.fail(new Error("refused"));
		const refusal = await secrets
			.moveSecretToProject(ADA, {
				name: "TOKEN",
				from: "computer",
				project: RUN,
			})
			.catch((error: Error) => error.message);
		expect(JSON.stringify([...replies, refusal])).not.toContain(VALUE);
	});
});

describe("a read fails closed", () => {
	test("a name last known as Personal or the Project's gets no other scope's value while they cannot be read", async () => {
		const { personal, projects, secrets } = await wired();
		personal.secrets.set("TOKEN", { value: VALUE, setAt: 1 });
		expect(await secrets.readSecret({ name: "TOKEN" })).toBe(VALUE);
		personal.fail(new Error("offline"));
		// The environment has TOKEN, and the read still gives nothing.
		expect(await secrets.readSecret({ name: "TOKEN" })).toBeUndefined();
		expect(await secrets.readSecretEnv({ names: ["TOKEN"] })).toEqual({
			ok: false,
			missing: ["TOKEN"],
			unreachable: true,
		});

		personal.heal();
		personal.secrets.delete("TOKEN");
		projects.projects.set(
			"app",
			new Map([["TOKEN", { value: VALUE, setAt: 1 }]]),
		);
		expect(await secrets.readSecret({ name: "TOKEN", use: { run: RUN } })).toBe(
			VALUE,
		);
		projects.fail(new Error("offline"));
		expect(
			await secrets.readSecret({ name: "TOKEN", use: { run: RUN } }),
		).toBeUndefined();
	});
});
