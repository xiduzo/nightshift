import type { WorkCall } from "../../../contract";

/**
 * The input of a call as this computer takes it from a Walker: only the
 * fields the call declares. Each list below names every field of its
 * type, so a new field has a place here before the types allow it.
 */

type Session = Extract<WorkCall, { kind: "session" }>["input"];
export type OfferedInput = Extract<Session, { offered: unknown }>;
type Resolved = Exclude<Session, { offered: unknown }>;
type Input<K extends WorkCall["kind"]> = Extract<
	WorkCall,
	{ kind: K; input: unknown }
>["input"];

/** Every field of `T`: the Walker decides it, or this computer does. */
type Fields<T> = Record<keyof Required<T>, "walker" | "device">;

/**
 * A session under an Offer. The step is the Walker's: its folder, prompt,
 * report, files, knowledge and limits. The profile is its owner's
 * (`offeredSession`), so no field of a profile is here.
 */
const OFFERED_FIELDS = {
	cwd: "walker",
	prompt: "walker",
	resumeSessionId: "walker",
	stepReport: "walker",
	artifacts: "walker",
	files: "walker",
	knowledge: "walker",
	knowledgeOnly: "walker",
	maxTurns: "walker",
	maxBudgetUsd: "walker",
	// The profile it names, read by the admission.
	offered: "device",
	// Set by the admission, and by `serveWork`.
	underOffer: "device",
	run: "device",
} as const satisfies Fields<OfferedInput>;

/** A session of the owner's own run: the Walker resolved the profile. */
const SESSION_FIELDS = {
	cwd: "walker",
	prompt: "walker",
	resumeSessionId: "walker",
	stepReport: "walker",
	artifacts: "walker",
	files: "walker",
	knowledge: "walker",
	knowledgeOnly: "walker",
	maxTurns: "walker",
	maxBudgetUsd: "walker",
	harness: "walker",
	model: "walker",
	permissionMode: "walker",
	effort: "walker",
	clis: "walker",
	connections: "walker",
	// A Walker's only narrows.
	underOffer: "walker",
	run: "device",
} as const satisfies Fields<Resolved>;

const EXEC_FIELDS = {
	command: "walker",
	cwd: "walker",
	env: "walker",
	secrets: "walker",
	outputFile: "walker",
	knowledge: "walker",
	artifacts: "walker",
	pid: "walker",
	run: "device",
} as const satisfies Fields<Input<"exec">>;

const TOOL_FIELDS = {
	connection: "walker",
	tool: "walker",
	arguments: "walker",
	run: "device",
} as const satisfies Fields<Input<"callTool">>;

const REQUEST_FIELDS = {
	method: "walker",
	url: "walker",
	query: "walker",
	headers: "walker",
	body: "walker",
	timeoutMs: "walker",
	maxBytes: "walker",
	run: "device",
} as const satisfies Fields<Input<"request">>;

/** The fields a Walker decides in `F`. */
type WalkerField<F> = {
	[K in keyof F]: F[K] extends "walker" ? K : never;
}[keyof F];

function fromWalker<T extends object, F extends Fields<T>>(
	input: T,
	fields: F,
): Pick<T, WalkerField<F> & keyof T> {
	const taken: Partial<T> = {};
	for (const key of Object.keys(fields) as (keyof T & keyof F)[]) {
		if (fields[key] === "walker" && input[key] !== undefined) {
			taken[key] = input[key];
		}
	}
	return taken as Pick<T, WalkerField<F> & keyof T>;
}

/** What the Walker decides of a session under an Offer. */
export function offeredInput(input: OfferedInput) {
	return fromWalker(input, OFFERED_FIELDS);
}

/** The call of the owner's own run with only the fields it declares. */
export function declaredCall(call: WorkCall): WorkCall {
	switch (call.kind) {
		case "session":
			return "offered" in call.input
				? call
				: { kind: call.kind, input: fromWalker(call.input, SESSION_FIELDS) };
		case "exec":
			return { kind: call.kind, input: fromWalker(call.input, EXEC_FIELDS) };
		case "callTool":
			return { kind: call.kind, input: fromWalker(call.input, TOOL_FIELDS) };
		case "request":
			return { kind: call.kind, input: fromWalker(call.input, REQUEST_FIELDS) };
		default:
			return call;
	}
}
