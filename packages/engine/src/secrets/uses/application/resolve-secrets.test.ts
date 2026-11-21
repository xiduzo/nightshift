import { describe, expect, test } from "bun:test";
import { inMemorySecretsPorts } from "../../scopes/adapters/out/in-memory-neighbours";
import { resolveSecrets } from "./resolve-secrets";

/** The use case resolveSecrets, on in-memory adapters. */

const RUN = { spaceId: "space-1", projectId: "app", runId: "run-1" };

describe("resolveSecrets", () => {
	test("the most specific scope wins: environment, keychain, Project, Personal", async () => {
		const ports = inMemorySecretsPorts();
		ports.env.TOKEN = "from-env";
		ports.env.ONLY_ENV = "env-only";
		ports.computer.values.set("TOKEN", "from-keychain");
		ports.facts.saved().set("TOKEN", 1);
		ports.projectTwin.projects.set(
			"app",
			new Map([["TOKEN", { value: "from-project", setAt: 1 }]]),
		);
		const { vars, fromProject } = await resolveSecrets(ports)({
			names: ["TOKEN", "ONLY_ENV"],
			use: { run: RUN },
		});
		expect(vars.TOKEN).toBe("from-project");
		expect(vars.ONLY_ENV).toBe("env-only");
		expect([...fromProject]).toEqual(["TOKEN"]);

		ports.personalTwin.secrets.set("TOKEN", {
			value: "from-personal",
			setAt: 2,
		});
		const again = await resolveSecrets(ports)({
			names: ["TOKEN"],
			use: { run: RUN },
		});
		expect(again.vars.TOKEN).toBe("from-personal");
		expect([...again.fromProject]).toEqual([]);
	});

	test("a keychain value is read only for a name saved here", async () => {
		const ports = inMemorySecretsPorts();
		ports.computer.values.set("STRAY", "never-saved-here");
		const { vars } = await resolveSecrets(ports)({ names: ["STRAY"] });
		expect(vars.STRAY).toBeUndefined();
	});

	test("fails closed: a name last known as Personal has no value while the Personal secrets cannot be read", async () => {
		const ports = inMemorySecretsPorts();
		ports.env.TOKEN = "env-value";
		ports.computer.values.set("TOKEN", "keychain-value");
		ports.facts.saved().set("TOKEN", 1);
		ports.personalTwin.secrets.set("TOKEN", {
			value: "personal-value",
			setAt: 1,
		});
		const resolve = resolveSecrets(ports);
		expect((await resolve({ names: ["TOKEN"] })).vars.TOKEN).toBe(
			"personal-value",
		);
		ports.personalTwin.fail(new Error("offline"));
		const closed = await resolve({ names: ["TOKEN", "OTHER"] });
		expect(closed.vars.TOKEN).toBeUndefined();
		expect(closed.unreachable).toBe(true);
		// A name the Personal secrets never had still reads the other scopes.
		ports.env.OTHER = "other";
		expect((await resolve({ names: ["OTHER"] })).vars.OTHER).toBe("other");
	});

	test("fails closed: a name last known as the Project's has no value while the Project's secrets cannot be read", async () => {
		const ports = inMemorySecretsPorts();
		ports.env.TOKEN = "env-value";
		ports.projectTwin.projects.set(
			"app",
			new Map([["TOKEN", { value: "project-value", setAt: 1 }]]),
		);
		const resolve = resolveSecrets(ports);
		expect(
			(await resolve({ names: ["TOKEN"], use: { run: RUN } })).vars.TOKEN,
		).toBe("project-value");
		ports.projectTwin.fail(new Error("offline"));
		const closed = await resolve({ names: ["TOKEN"], use: { run: RUN } });
		expect(closed.vars.TOKEN).toBeUndefined();
		expect(closed.projectUnreachable).toBe(true);
	});

	test("a Personal scope not reachable yet fails closed too, with its words logged once", async () => {
		const ports = inMemorySecretsPorts();
		ports.unreach("personal");
		const resolve = resolveSecrets(ports);
		await resolve({ names: ["TOKEN"] });
		await resolve({ names: ["TOKEN"] });
		expect(ports.warnings).toHaveLength(1);
		expect(ports.warnings[0]?.line).toBe(
			"[secrets] the Personal secrets were not read:",
		);
		expect(String(ports.warnings[0]?.error)).toContain(
			"Night Shift could not read your Personal secrets now.",
		);
	});

	test("no value reaches the log when a scope fails", async () => {
		const ports = inMemorySecretsPorts();
		ports.env.TOKEN = "env-secret-value";
		ports.computer.values.set("SAVED", "keychain-secret-value");
		ports.facts.saved().set("SAVED", 1);
		ports.personalTwin.fail(new Error("offline"));
		ports.projectTwin.fail(new Error("refused"));
		await resolveSecrets(ports)({
			names: ["TOKEN", "SAVED"],
			use: { run: RUN },
		});
		const logged = JSON.stringify(
			ports.warnings.map(({ line, error }) => [line, String(error)]),
		);
		expect(ports.warnings).toHaveLength(2);
		expect(logged).not.toContain("env-secret-value");
		expect(logged).not.toContain("keychain-secret-value");
	});

	test("on a Host, a Personal name is listed, not read, and the person hears why", async () => {
		const ports = inMemorySecretsPorts();
		ports.place.host = true;
		ports.personalTwin.secrets.set("TOKEN", {
			value: "personal-value",
			setAt: 1,
		});
		const resolved = await resolveSecrets(ports)({ names: ["TOKEN"] });
		expect(resolved.vars.TOKEN).toBeUndefined();
		expect(resolved.personalHere).toBe(true);
		expect(ports.personalTwin.calls.map((c) => c.call)).toEqual(["list"]);
	});

	test("under an Offer, the Personal secrets are not asked", async () => {
		const ports = inMemorySecretsPorts();
		ports.personalTwin.secrets.set("TOKEN", {
			value: "personal-value",
			setAt: 1,
		});
		const resolved = await resolveSecrets(ports)({
			names: ["TOKEN"],
			use: { underOffer: true },
		});
		expect(resolved.vars.TOKEN).toBeUndefined();
		expect(ports.personalTwin.calls).toEqual([]);
	});
});
