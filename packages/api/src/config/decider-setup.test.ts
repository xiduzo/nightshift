import { describe, expect, test } from "bun:test";
import { createDeciderSetup } from "@nightshift/engine/agent-setup";
import { createSandbox, createSettingsStore } from "@nightshift/engine/testing";
import { call, ORPCError } from "@orpc/server";

import type { Context } from "../context";
import { onOutputMismatch } from "../output";
import { appRouter } from "../router";
import { accessAs, testContext } from "../testing";

/**
 * The decider setup routes over the engine's own setup, with an Ollama
 * that is not here and stores in memory. Nothing installs or downloads:
 * the spawn throws, and the refusals come before it.
 */

const OWNER = "ada";
const SPACE = "space-1";
const KEY = "TYPESAFE_API_KEY";

type SetupDeps = Parameters<typeof createDeciderSetup>[0];

/** A settings view with `decisionDecider` saved or not. */
function settingsView(saved: string | null) {
	const values = {
		decisionDecider: saved ?? "typesafe",
		ollama: "auto",
		builtinAgents: {},
	};
	return {
		values,
		fields: {
			decisionDecider: saved
				? { source: "saved", default: "typesafe" }
				: { source: "default", default: "typesafe" },
		},
	};
}

/** Stores in memory: the secrets, the profiles and the settings a setup touches. */
function memoryStores() {
	const secrets = new Map<string, string>();
	const profiles: { id: string; name: string; decider: string }[] = [];
	let decider: string | null = null;
	const stores = {
		secrets,
		profiles,
		settings: {
			current: () => settingsView(decider).values,
			view: () => settingsView(decider),
			save: async (patch: { decisionDecider?: string }) => {
				if (patch.decisionDecider) decider = patch.decisionDecider;
				return settingsView(decider);
			},
		},
		connections: {
			secretSource: (name: string) =>
				secrets.has(name) ? "keychain" : "missing",
			setSecret: async (name: string, value: string) => {
				secrets.set(name, value);
			},
			get: () => null,
		},
		cliTools: { get: () => null },
		profileStore: {
			list: () => profiles,
			get: (id: string) => profiles.find((p) => p.id === id) ?? null,
			byName: (name: string) => profiles.find((p) => p.name === name) ?? null,
			save: async (input: { name: string; decider: string }) => {
				const view = { ...input, id: `p-${profiles.length + 1}` };
				profiles.push(view);
				return view;
			},
		},
	};
	return stores;
}

function engineSetup(
	stores: ReturnType<typeof memoryStores>,
	more: Partial<SetupDeps> = {},
) {
	return createDeciderSetup({
		stores: {
			settings: stores.settings,
			connections: stores.connections,
			cliTools: stores.cliTools,
			profiles: stores.profileStore,
		} as unknown as SetupDeps["stores"],
		ollama: {
			status: async (model = "qwen3-embedding:0.6b") => ({
				where: null,
				from: "local",
				started: false,
				installed: false,
				answers: false,
				model,
				hasModel: false,
				download: null,
				missingSecrets: [],
			}),
			pull: () => {},
			cancelPull: async () => {},
			refresh: async () => {},
		},
		localModel: { name: "llama3.2:latest", bytes: 2_000_000_000 },
		typesafeKey: KEY,
		container: false,
		platform: "darwin",
		home: "/home/ada",
		env: { PATH: "/usr/bin" },
		which: () => null,
		spawn: () => {
			throw new Error("A route test runs no program.");
		},
		...more,
	});
}

function contextFor(options: {
	personId?: string;
	fromThisComputer: boolean;
	deciderSetup: Context["deciderSetup"];
}): Context {
	return testContext({
		access: accessAs({
			personId: options.personId ?? OWNER,
			spaceId: SPACE,
			role: "owner",
		}),
		fromThisComputer: options.fromThisComputer,
		daemon: { device: { id: "device", name: "test", ownerId: OWNER } },
		deciderSetup: options.deciderSetup,
	});
}

async function refusal(promise: Promise<unknown>) {
	try {
		await promise;
	} catch (error) {
		if (error instanceof ORPCError) {
			return { code: error.code, message: error.message };
		}
		throw error;
	}
	throw new Error("The call did not fail.");
}

describe("the setup of a decider", () => {
	test("on this computer: Ollama as the default, its download page and the model's size", async () => {
		const stores = memoryStores();
		const status = await call(appRouter.deciderSetup.status, undefined, {
			context: contextFor({
				fromThisComputer: true,
				deciderSetup: engineSetup(stores),
			}),
		});
		expect(status).toMatchObject({
			available: true,
			current: { decider: "ollama", chosen: false },
			local: {
				model: "llama3.2:latest",
				bytes: 2_000_000_000,
				install: { kind: "download", url: "https://ollama.com/download/mac" },
			},
			typesafe: { keySaved: false, keyPage: "https://typesafe.ai" },
			job: { state: "idle" },
		});
	});

	test("TypeSafe: saves the key, and no reply holds it", async () => {
		const stores = memoryStores();
		const context = contextFor({
			fromThisComputer: true,
			deciderSetup: engineSetup(stores),
		});
		const status = await call(
			appRouter.deciderSetup.useTypesafe,
			{ key: "ts-secret-key" },
			{ context },
		);
		expect(stores.secrets.get(KEY)).toBe("ts-secret-key");
		expect(status).toMatchObject({
			current: { decider: "typesafe", chosen: true },
			typesafe: { keySaved: true },
			job: { state: "ready", decider: "typesafe", profileName: "jev" },
		});
		expect(JSON.stringify(status)).not.toContain("ts-secret-key");
	});

	test("from another computer, and in a container: refused", async () => {
		const stores = memoryStores();
		const elsewhere = contextFor({
			fromThisComputer: false,
			deciderSetup: engineSetup(stores),
		});
		const forbidden = {
			code: "FORBIDDEN",
			message: "Open Night Shift on that computer to set up a decider there.",
		};
		expect(
			await call(appRouter.deciderSetup.status, undefined, {
				context: elsewhere,
			}),
		).toMatchObject({ available: false, reason: "elsewhere" });
		for (const route of [
			appRouter.deciderSetup.useLocal,
			appRouter.deciderSetup.installOllama,
			appRouter.deciderSetup.cancel,
		]) {
			expect(
				await refusal(call(route, undefined, { context: elsewhere })),
			).toEqual(forbidden);
		}
		expect(
			await refusal(
				call(
					appRouter.deciderSetup.useTypesafe,
					{ key: "k" },
					{ context: elsewhere },
				),
			),
		).toEqual(forbidden);
		expect(stores.secrets.size).toBe(0);

		const container = contextFor({
			fromThisComputer: true,
			deciderSetup: engineSetup(stores, { container: true }),
		});
		expect(
			await refusal(
				call(appRouter.deciderSetup.useLocal, undefined, {
					context: container,
				}),
			),
		).toEqual({
			code: "FORBIDDEN",
			message:
				"Night Shift runs in a container here. Its image has Ollama already. Choose the decider in Settings.",
		});
	});

	test("refuses the local decider without Ollama, and a key without one saved", async () => {
		const context = contextFor({
			fromThisComputer: true,
			deciderSetup: engineSetup(memoryStores()),
		});
		expect(
			await refusal(
				call(appRouter.deciderSetup.useLocal, undefined, { context }),
			),
		).toEqual({
			code: "CONFLICT",
			message: "Ollama is not on this computer. Install it first.",
		});
		expect(
			await refusal(call(appRouter.deciderSetup.useTypesafe, {}, { context })),
		).toEqual({
			code: "BAD_REQUEST",
			message: "Paste the key TypeSafe gave you.",
		});
	});

	test("only the owner of this computer may use it", async () => {
		const context = contextFor({
			personId: "dee",
			fromThisComputer: true,
			deciderSetup: engineSetup(memoryStores()),
		});
		expect(
			await refusal(
				call(appRouter.deciderSetup.status, undefined, { context }),
			),
		).toEqual({
			code: "FORBIDDEN",
			message: "Only the owner of this computer can see or change this.",
		});
	});
});

describe("the settings of new Decision nodes", () => {
	test("show Ollama while no decider is saved and no TypeSafe key exists", async () => {
		const sandbox = await createSandbox();
		const quiet = onOutputMismatch(() => {});
		try {
			const settings = createSettingsStore({
				document: await sandbox.openDocument(),
				env: {},
			});
			await settings.load();
			const read = async (keySaved: boolean) => {
				const view = await call(appRouter.settings.get, undefined, {
					context: testContext({
						access: accessAs({
							personId: OWNER,
							spaceId: SPACE,
							role: "owner",
						}),
						daemon: {
							dataDir: sandbox.dataDir,
							device: { id: "device", name: "test", ownerId: OWNER },
							lease: { host: "test", pid: 1, epoch: 1, since: 0 },
						},
						settings,
						connections: {
							secretSource: () => (keySaved ? "keychain" : "missing"),
						},
					}),
				});
				return [view.values.decisionDecider, view.fields.decisionDecider];
			};
			expect(await read(false)).toEqual([
				"ollama",
				{ source: "default", default: "ollama" },
			]);
			expect(await read(true)).toEqual([
				"typesafe",
				{ source: "default", default: "typesafe" },
			]);
			await settings.save({ decisionDecider: "openai" });
			expect((await read(false))[0]).toBe("openai");
		} finally {
			quiet();
			await sandbox.cleanup();
		}
	});
});
