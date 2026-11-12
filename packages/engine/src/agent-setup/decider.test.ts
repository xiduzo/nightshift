import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { isAgentProfile } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";

import {
	type ConfigStores,
	openConfigStores,
} from "../device-config/config-stores";
import type { SecretBackend } from "../device-config/connections";
import type { OllamaStatus } from "../ollama";
import { createSandbox, type Sandbox, waitFor } from "../testing/test-support";
import {
	createDeciderSetup,
	type DeciderSetup,
	type DeciderSetupDeps,
	type DeciderSetupJob,
} from "./decider";
import { fakeSpawn } from "./test-support";

/**
 * The setup of a decider with a fake Ollama, a fake spawn and secrets in
 * memory: no test installs, starts or downloads anything for real.
 */

const MODEL = "llama3.2:latest";
const KEY = "TYPESAFE_API_KEY";
const HERE = { here: true };

let sandbox: Sandbox;
let stores: ConfigStores;
let saved: Map<string, string>;
let setup: DeciderSetup | null = null;

async function openStores(env: Record<string, string> = {}) {
	saved = new Map();
	const secrets: SecretBackend = {
		get: async (name) => saved.get(name) ?? null,
		set: async (name, value) => {
			saved.set(name, value);
		},
		delete: async (name) => {
			saved.delete(name);
		},
	};
	stores = await openConfigStores({
		document: await sandbox.openDocument(),
		env,
		secrets,
	});
}

beforeEach(async () => {
	sandbox = await createSandbox();
	await openStores();
});
afterEach(async () => {
	setup?.stop();
	setup = null;
	await sandbox.cleanup();
});

/** An Ollama the test drives: whether it is here and answers, its models, a download. */
function fakeOllama(start: Partial<OllamaState> = {}) {
	const state: OllamaState = {
		installed: true,
		answers: true,
		models: [],
		from: "local",
		where: null,
		download: null,
		startsOnRefresh: true,
		pulls: [],
		cancelled: [],
		refreshes: 0,
		...start,
	};
	const service: DeciderSetupDeps["ollama"] = {
		status: async (model = "qwen3-embedding:0.6b"): Promise<OllamaStatus> => ({
			where: state.where,
			from: state.from,
			started: false,
			installed: state.installed,
			answers: state.answers,
			model,
			hasModel: state.answers && state.models.includes(model),
			download: state.download,
			missingSecrets: [],
		}),
		pull: (model) => {
			state.pulls.push(model);
			state.download = { percent: 0, running: true, error: null };
		},
		cancelPull: async (model) => {
			state.cancelled.push(model);
			state.download = null;
		},
		refresh: async () => {
			state.refreshes += 1;
			if (state.startsOnRefresh && state.installed) state.answers = true;
		},
	};
	return { state, service };
}

type OllamaState = {
	installed: boolean;
	answers: boolean;
	models: string[];
	from: OllamaStatus["from"];
	where: string | null;
	download: OllamaStatus["download"];
	/** A refresh starts Ollama, as the setting "on" does. */
	startsOnRefresh: boolean;
	pulls: string[];
	cancelled: string[];
	refreshes: number;
};

function make(
	ollama: DeciderSetupDeps["ollama"],
	deps: Partial<DeciderSetupDeps> = {},
) {
	setup = createDeciderSetup({
		stores,
		ollama,
		localModel: { name: MODEL, bytes: 2_000_000_000 },
		typesafeKey: KEY,
		container: false,
		platform: "darwin",
		home: "/home/ada",
		env: { PATH: "/usr/bin", HOME: "/home/ada" },
		which: () => null,
		spawn: fakeSpawn().spawn,
		pollMs: 1,
		...deps,
	});
	return setup;
}

const until = async (s: DeciderSetup, state: DeciderSetupJob["state"]) =>
	waitFor(
		async () => {
			const { job } = await s.status(HERE);
			return job.state === state && job;
		},
		{ label: state },
	);

async function refusal(promise: Promise<unknown>) {
	try {
		await promise;
	} catch (error) {
		if (error instanceof Refusal) return [error.kind, error.message];
		throw error;
	}
	throw new Error("It did not refuse.");
}

describe("the status of the setup of a decider", () => {
	test("without a key or a choice, new nodes start on Ollama, and the model's size shows first", async () => {
		const { service } = fakeOllama({ installed: false, answers: false });
		const status = await make(service, {
			which: (p) => (p === "brew" ? "/opt/homebrew/bin/brew" : null),
		}).status(HERE);
		expect(status).toEqual({
			available: true,
			reason: null,
			message: null,
			current: { decider: "ollama", chosen: false },
			local: {
				model: MODEL,
				bytes: 2_000_000_000,
				where: null,
				installed: false,
				answers: false,
				hasModel: false,
				install: { kind: "brew", command: "brew install ollama" },
			},
			typesafe: { keySaved: false, keyPage: "https://typesafe.ai" },
			job: { state: "idle" },
		});
	});

	test("a TypeSafe key in the environment makes TypeSafe the default", async () => {
		await openStores({ [KEY]: "from-env" });
		const { service } = fakeOllama();
		const status = await make(service).status(HERE);
		expect(status.current).toEqual({ decider: "typesafe", chosen: false });
		expect(status.typesafe.keySaved).toBe(true);
		expect(status.local.install).toBeNull();
	});

	test("without Homebrew, or on Linux, the person downloads Ollama from its page", async () => {
		const missing = { installed: false, answers: false };
		const mac = await make(fakeOllama(missing).service).status(HERE);
		expect(mac.local.install).toEqual({
			kind: "download",
			url: "https://ollama.com/download/mac",
		});
		const linux = await make(fakeOllama(missing).service, {
			platform: "linux",
			which: () => "/home/linuxbrew/.linuxbrew/bin/brew",
		}).status(HERE);
		expect(linux.local.install).toEqual({
			kind: "download",
			url: "https://ollama.com/download/linux",
		});
	});

	test("an Ollama elsewhere needs no install", async () => {
		const { service } = fakeOllama({
			installed: false,
			answers: false,
			from: "setting",
			where: "studio.local",
		});
		const status = await make(service, {
			which: () => "/opt/homebrew/bin/brew",
		}).status(HERE);
		expect(status.local).toMatchObject({
			where: "studio.local",
			install: null,
		});
	});

	test("refused from another computer and in a container, with what to do instead", async () => {
		const { service } = fakeOllama({ installed: false, answers: false });
		const elsewhere = make(service);
		expect(await elsewhere.status({ here: false })).toMatchObject({
			available: false,
			reason: "elsewhere",
			message: "Open Night Shift on that computer to set up a decider there.",
		});
		expect(await refusal(elsewhere.useLocal({ here: false }))).toEqual([
			"forbidden",
			"Open Night Shift on that computer to set up a decider there.",
		]);
		const container = make(service, { container: true });
		const status = await container.status(HERE);
		expect(status).toMatchObject({ available: false, reason: "container" });
		// Its image has Ollama: nothing to install.
		expect(status.local.install).toBeNull();
		expect(await refusal(container.useTypesafe("k", HERE))).toEqual([
			"forbidden",
			"Night Shift runs in a container here. Its image has Ollama already. Choose the decider in Settings.",
		]);
	});
});

describe("a local decider", () => {
	test("starts Ollama, downloads the model, and makes it the decider with the profile local", async () => {
		const ollama = fakeOllama({ answers: false });
		const s = make(ollama.service);
		expect((await s.useLocal(HERE)).job.state).toBe("starting");
		await until(s, "downloading");
		// Night Shift starts Ollama now and at each start.
		expect(stores.settings.current().ollama).toBe("on");
		expect(ollama.state.refreshes).toBe(1);
		expect(ollama.state.pulls).toEqual([MODEL]);

		ollama.state.download = { percent: 40, running: true, error: null };
		const halfway = await waitFor(async () => {
			const { job } = await s.status(HERE);
			return job.state === "downloading" && job.percent === 40 && job;
		});
		expect(halfway).toMatchObject({ percent: 40 });

		ollama.state.models.push(MODEL);
		ollama.state.download = null;
		const ready = await until(s, "ready");
		const profile = stores.profiles.byName("local");
		expect(profile).toMatchObject({ decider: "ollama", model: MODEL });
		expect(ready).toMatchObject({
			decider: "ollama",
			profileId: profile?.id,
			profileName: "local",
		});
		expect((await s.status(HERE)).current).toEqual({
			decider: "ollama",
			chosen: true,
		});
	});

	test("an Ollama that has the model is ready at once, with no download", async () => {
		const ollama = fakeOllama({ models: [MODEL] });
		await stores.settings.save({ ollama: "off" });
		const s = make(ollama.service);
		await s.useLocal(HERE);
		await until(s, "ready");
		expect(ollama.state.pulls).toEqual([]);
		// It answered: the setting stays as the person left it.
		expect(stores.settings.current().ollama).toBe("off");
	});

	test("refuses without Ollama, and while a job runs", async () => {
		const missing = make(
			fakeOllama({ installed: false, answers: false }).service,
		);
		expect(await refusal(missing.useLocal(HERE))).toEqual([
			"conflict",
			"Ollama is not on this computer. Install it first.",
		]);

		const ollama = fakeOllama();
		const s = make(ollama.service);
		await s.useLocal(HERE);
		await until(s, "downloading");
		expect(await refusal(s.useTypesafe("k", HERE))).toEqual([
			"conflict",
			"Night Shift is setting up a decider already. Wait for it, or cancel it.",
		]);
	});

	test("a cancel stops the download", async () => {
		const ollama = fakeOllama();
		const s = make(ollama.service);
		await s.useLocal(HERE);
		await until(s, "downloading");
		const after = await s.cancel(HERE);
		expect(after.job.state).toBe("cancelled");
		expect(ollama.state.cancelled).toEqual([MODEL]);
		expect(stores.profiles.byName("local")).toBeNull();
		expect(stores.settings.view().fields.decisionDecider.source).toBe(
			"default",
		);
	});

	test("a download that fails, and an Ollama that does not start, say what to do", async () => {
		const ollama = fakeOllama();
		const s = make(ollama.service);
		await s.useLocal(HERE);
		await until(s, "downloading");
		ollama.state.download = { percent: 12, running: false, error: "EOF" };
		expect(await until(s, "failed")).toMatchObject({
			problem:
				"The download of llama3.2:latest stopped. Check the internet connection, then try again.",
		});

		const silent = fakeOllama({ answers: false, startsOnRefresh: false });
		const t = make(silent.service, { startTimeoutMs: 20 });
		await t.useLocal(HERE);
		expect(await until(t, "failed")).toMatchObject({
			problem: "Ollama did not start. Start it yourself, then try again.",
		});
	});

	test("an Ollama elsewhere that does not answer names where", async () => {
		const s = make(
			fakeOllama({ answers: false, from: "env", where: "studio.local" })
				.service,
		);
		await s.useLocal(HERE);
		expect(await until(s, "failed")).toMatchObject({
			problem:
				"Ollama at studio.local does not answer. Check that it runs there, then try again.",
		});
	});

	test("updates the Model Profile local, and leaves an Agent Profile of that name alone", async () => {
		const ollama = fakeOllama({ models: [MODEL] });
		const mine = await stores.profiles.save({
			name: "local",
			description: "Decisions at home",
			decider: "ollaya",
		});
		const s = make(ollama.service);
		await s.useLocal(HERE);
		await until(s, "ready");
		expect(stores.profiles.get(mine.id)).toMatchObject({
			name: "local",
			description: "Decisions at home",
			decider: "ollama",
			model: MODEL,
		});

		await stores.profiles.remove(mine.id);
		const agent = await stores.profiles.save({
			name: "local",
			harness: "claude-code",
			model: "sonnet",
			permissionMode: "auto",
			clis: [],
			connections: [],
		});
		await s.useLocal(HERE);
		const ready = await until(s, "ready");
		expect(ready).toMatchObject({ profileName: "local_2" });
		const kept = stores.profiles.get(agent.id);
		expect(kept && isAgentProfile(kept)).toBe(true);
	});
});

describe("installing Ollama", () => {
	test("on a Mac with Homebrew: brew install ollama, then the local decider", async () => {
		const ollama = fakeOllama({ installed: false, answers: false });
		const { spawn, started } = fakeSpawn();
		const s = make(ollama.service, {
			which: (p) => (p === "brew" ? "/opt/homebrew/bin/brew" : null),
			spawn,
		});
		expect((await s.installOllama(HERE)).job.state).toBe("installing");
		const proc = started[0];
		if (!proc) throw new Error("The install did not start.");
		expect(proc.argv).toEqual(["/bin/sh", "-c", "brew install ollama"]);
		expect(proc.options).toMatchObject({
			cwd: "/home/ada",
			io: "pipes",
			input: false,
		});
		ollama.state.installed = true;
		proc.exit(0);
		await until(s, "downloading");
		expect(stores.settings.current().ollama).toBe("on");
		ollama.state.models.push(MODEL);
		await until(s, "ready");
	});

	test("a failed install keeps the end of what Homebrew printed", async () => {
		const ollama = fakeOllama({ installed: false, answers: false });
		const { spawn, started } = fakeSpawn();
		const s = make(ollama.service, {
			which: () => "/opt/homebrew/bin/brew",
			spawn,
		});
		await s.installOllama(HERE);
		started[0]?.print("Error: ollama: no bottle available\n");
		started[0]?.exit(1);
		expect(await until(s, "install-failed")).toMatchObject({
			problem:
				"Night Shift could not install Ollama. Try again, or read the details.",
			output: "Error: ollama: no bottle available",
		});
	});

	test("a cancel stops Homebrew", async () => {
		const { spawn, started } = fakeSpawn();
		const s = make(fakeOllama({ installed: false, answers: false }).service, {
			which: () => "/opt/homebrew/bin/brew",
			spawn,
		});
		await s.installOllama(HERE);
		expect((await s.cancel(HERE)).job.state).toBe("cancelled");
		expect(started[0]?.stopped).toBe(true);
	});

	test("refused without Homebrew, and when Ollama is here", async () => {
		const missing = make(
			fakeOllama({ installed: false, answers: false }).service,
		);
		expect(await refusal(missing.installOllama(HERE))).toEqual([
			"conflict",
			"Night Shift cannot install Ollama here. Download it from its page, then check again.",
		]);
		const here = make(fakeOllama().service, {
			which: () => "/opt/homebrew/bin/brew",
		});
		expect(await refusal(here.installOllama(HERE))).toEqual([
			"conflict",
			"Ollama is on this computer already.",
		]);
	});
});

describe("TypeSafe Jev", () => {
	test("saves the key on this computer, makes the profile jev, and never answers with the key", async () => {
		const errors = spyOn(console, "error");
		const s = make(fakeOllama().service);
		const status = await s.useTypesafe("  ts-secret-key  ", HERE);
		expect(saved.get(KEY)).toBe("ts-secret-key");
		expect(stores.connections.secretSource(KEY)).toBe("keychain");
		const profile = stores.profiles.byName("jev");
		expect(profile).toMatchObject({ decider: "typesafe" });
		expect(status.job).toMatchObject({
			state: "ready",
			decider: "typesafe",
			profileId: profile?.id,
			profileName: "jev",
		});
		expect(status.current).toEqual({ decider: "typesafe", chosen: true });
		expect(JSON.stringify(status)).not.toContain("ts-secret-key");
		for (const call of errors.mock.calls) {
			expect(JSON.stringify(call)).not.toContain("ts-secret-key");
		}
		errors.mockRestore();
	});

	test("keeps a saved key when none is pasted, and asks for one when none is saved", async () => {
		const s = make(fakeOllama().service);
		expect(await refusal(s.useTypesafe(null, HERE))).toEqual([
			"invalid",
			"Paste the key TypeSafe gave you.",
		]);
		expect(await refusal(s.useTypesafe("two words", HERE))).toEqual([
			"invalid",
			"Paste the key as TypeSafe shows it.",
		]);
		await stores.connections.setSecret(KEY, "kept");
		expect((await s.useTypesafe(null, HERE)).job.state).toBe("ready");
		expect(saved.get(KEY)).toBe("kept");
	});

	test("a key that cannot be saved leaves it out of the log", async () => {
		const errors = spyOn(console, "error").mockImplementation(() => {});
		stores.connections.setSecret = async (_name, value) => {
			throw new Error(`keychain refused ${value}`);
		};
		const s = make(fakeOllama().service);
		expect(await refusal(s.useTypesafe("ts-secret-key", HERE))).toEqual([
			"unavailable",
			"Night Shift could not save the key. Try again.",
		]);
		expect(errors).toHaveBeenCalled();
		for (const call of errors.mock.calls) {
			expect(JSON.stringify(call)).not.toContain("ts-secret-key");
		}
		errors.mockRestore();
		expect(stores.profiles.byName("jev")).toBeNull();
	});
});
