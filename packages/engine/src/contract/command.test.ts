import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { type RunAction, WALKED_ELSEWHERE, whyNot } from "../run-status";
import {
	COMMAND_KINDS,
	commandOf,
	permissionOf,
	type RunActionKind,
	type RunActionRequest,
	requestOf,
	runCommandSchema,
} from "./command";

/**
 * The Command module: one home for the kinds the schema stores, the
 * actions that travel as them, the permission each needs and the wire
 * shape. The engine applies them in `run/actions.ts` (`run/command.test.ts`).
 */

const file = { name: "note.md", mediaType: "text/markdown", content: "aGk=" };

/** One request of each kind, with every field set. */
const requests: {
	[K in RunActionKind]: Extract<RunActionRequest, { kind: K }>;
} = {
	stop: { kind: "stop", when: "after-step" },
	answer: {
		kind: "answer",
		stepId: "step-1",
		choice: "approve",
		note: "Looks right.",
		data: { variant: "calm" },
		files: [file],
		via: "phone",
	},
	useful: { kind: "useful", useful: true },
	signal: { kind: "signal", name: "deploy-done" },
	move: { kind: "move", to: "laptop" },
	"release-lease": { kind: "release-lease", name: "docker" },
	resume: { kind: "resume", prompt: "Go on." },
	restart: { kind: "restart", stepId: "step-2", prompt: "Again." },
	rerun: { kind: "rerun", nodeId: "build", fresh: true },
	"take-over": { kind: "take-over" },
};

const actions = Object.keys(requests) as RunActionKind[];

describe("the Command", () => {
	test("carries every kind the schema stores, each by one action", () => {
		const carried = actions.flatMap((action) => {
			const command = commandOf(requests[action]);
			return command ? [command.kind] : [];
		});
		expect([...carried].sort()).toEqual([...COMMAND_KINDS].sort());
		expect(new Set(carried).size).toBe(carried.length);
	});

	test("travels exactly when the status rule relays it", () => {
		// The status rule names the actions the screens offer. A useful and a
		// release of a lease are not offered there, and travel.
		const offered: RunAction[] = [
			"stop",
			"answer",
			"signal",
			"move",
			"resume",
			"restart",
			"rerun",
		];
		for (const action of offered) {
			const stays = whyNot(action, "running", false) === WALKED_ELSEWHERE;
			expect(commandOf(requests[action]) === null, action).toBe(stays);
		}
		expect(commandOf(requests.useful)).not.toBeNull();
		expect(commandOf(requests["release-lease"])).not.toBeNull();
		// A take-over is logged where the run is walked: it never travels.
		expect(commandOf(requests["take-over"])).toBeNull();
	});

	test("is the request on the wire, and the request again at the Walker", () => {
		for (const action of actions) {
			const request = requests[action];
			const command = commandOf(request);
			if (command === null) {
				expect(requestOf(request)).toBe(request);
				continue;
			}
			expect(requestOf(command)).toEqual(request);
		}
		// A field that is not set stays off the wire.
		expect(commandOf({ kind: "stop" })).toStrictEqual({
			kind: "run.stop",
			payload: {},
		});
	});

	test("needs the same permission by either of its names", () => {
		for (const action of actions) {
			const command = commandOf(requests[action]);
			if (command === null) continue;
			expect(permissionOf(command.kind), action).toEqual(permissionOf(action));
		}
		expect(permissionOf("answer")).toEqual({ gate: ["resolve"] });
		expect(permissionOf("restart")).toEqual({ run: ["stop", "resume"] });
		expect(permissionOf("take-over")).toEqual({ run: ["resume"] });
	});

	test("parses on the wire with what its carrier adds", () => {
		const schema = runCommandSchema({ runId: z.string().min(1) });
		for (const action of actions) {
			const command = commandOf(requests[action]);
			if (command === null) continue;
			const parsed = schema.safeParse({ runId: "run-1", ...command });
			expect(parsed.success, action).toBe(true);
			expect(parsed.data).toEqual({ runId: "run-1", ...command });
		}
		expect(
			schema.safeParse({ runId: "run-1", kind: "run.rerun", payload: {} })
				.success,
		).toBe(false);
	});
});
