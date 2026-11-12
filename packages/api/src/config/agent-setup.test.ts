import { describe, expect, test } from "bun:test";
import { createAgentSetup } from "@nightshift/engine/agent-setup";
import { call, ORPCError } from "@orpc/server";

import type { Context } from "../context";
import { appRouter } from "../router";
import { accessAs, testContext } from "../testing";

/**
 * The guided setup routes over the engine's own setup. Its programs never
 * start here: the spawn throws, and the refusals come before it.
 */

const OWNER = "ada";
const SPACE = "space-1";

type SetupDeps = Parameters<typeof createAgentSetup>[0];

/** The engine's setup on a Mac, with no CLI found and nothing it may run. */
function engineSetup(more: Partial<SetupDeps> = {}) {
	return createAgentSetup({
		stores: {
			settings: {
				current: () => ({ claudeBin: "claude", codexBin: "codex" }),
			},
		} as unknown as SetupDeps["stores"],
		check: async () => ({ signIn: "signed_out", account: null }),
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
	agentSetup?: Context["agentSetup"];
}): Context {
	return testContext({
		access: accessAs({
			personId: options.personId ?? OWNER,
			spaceId: SPACE,
			role: "owner",
		}),
		fromThisComputer: options.fromThisComputer,
		daemon: { device: { id: "device", name: "test", ownerId: OWNER } },
		agentSetup: options.agentSetup ?? engineSetup(),
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

describe("the guided setup of an agent", () => {
	test("on this computer: lists Claude Code and Codex with the exact commands", async () => {
		const status = await call(appRouter.agentSetup.status, undefined, {
			context: contextFor({ fromThisComputer: true }),
		});
		expect(status).toMatchObject({
			available: true,
			reason: null,
			message: null,
		});
		expect(
			status.agents.map((agent) => [
				agent.harness,
				agent.install.command,
				agent.signIn.command,
				agent.job.state,
			]),
		).toEqual([
			[
				"claude-code",
				"curl -fsSL https://claude.ai/install.sh | bash",
				"claude auth login",
				"idle",
			],
			[
				"codex",
				"curl -fsSL https://chatgpt.com/codex/install.sh | sh",
				"codex login",
				"idle",
			],
		]);
	});

	test("from another computer: not available, and every step is refused", async () => {
		const context = contextFor({ fromThisComputer: false });
		expect(
			await call(appRouter.agentSetup.status, undefined, { context }),
		).toMatchObject({
			available: false,
			reason: "elsewhere",
			message: "Open Night Shift on that computer to set up an agent there.",
		});
		const forbidden = {
			code: "FORBIDDEN",
			message: "Open Night Shift on that computer to set up an agent there.",
		};
		const harness = { harness: "claude-code" } as const;
		expect(
			await refusal(call(appRouter.agentSetup.install, harness, { context })),
		).toEqual(forbidden);
		expect(
			await refusal(call(appRouter.agentSetup.signIn, harness, { context })),
		).toEqual(forbidden);
		expect(
			await refusal(
				call(
					appRouter.agentSetup.sendCode,
					{ ...harness, code: "abc" },
					{ context },
				),
			),
		).toEqual(forbidden);
		expect(
			await refusal(call(appRouter.agentSetup.cancel, harness, { context })),
		).toEqual(forbidden);
	});

	test("in a container: refused, with what to do instead", async () => {
		const context = contextFor({
			fromThisComputer: true,
			agentSetup: engineSetup({ container: true }),
		});
		expect(
			await call(appRouter.agentSetup.status, undefined, { context }),
		).toMatchObject({ available: false, reason: "container" });
		expect(
			await refusal(
				call(appRouter.agentSetup.install, { harness: "codex" }, { context }),
			),
		).toEqual({
			code: "FORBIDDEN",
			message:
				"Night Shift runs in a container here, so an install would not last. Add the agent to its image.",
		});
	});

	test("refuses an agent it cannot install, a sign-in without the CLI, and an empty code", async () => {
		const context = contextFor({ fromThisComputer: true });
		expect(
			await refusal(
				call(appRouter.agentSetup.install, { harness: "pi" }, { context }),
			),
		).toEqual({
			code: "BAD_REQUEST",
			message:
				"Night Shift cannot install pi for you. Install it yourself, then add it.",
		});
		expect(
			await refusal(
				call(appRouter.agentSetup.signIn, { harness: "codex" }, { context }),
			),
		).toEqual({
			code: "CONFLICT",
			message: "Codex is not installed on this computer. Install it first.",
		});
		expect(
			(
				await refusal(
					call(
						appRouter.agentSetup.sendCode,
						{ harness: "codex", code: "   " },
						{ context },
					),
				)
			).code,
		).toBe("BAD_REQUEST");
	});

	test("only the owner of this computer may use it", async () => {
		const context = contextFor({
			personId: "dee",
			fromThisComputer: true,
		});
		expect(
			await refusal(call(appRouter.agentSetup.status, undefined, { context })),
		).toEqual({
			code: "FORBIDDEN",
			message: "Only the owner of this computer can see or change this.",
		});
	});
});
