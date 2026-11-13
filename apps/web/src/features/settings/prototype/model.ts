/**
 * PROTOTYPE, throw away. The built-in agents of Night Shift, the slots that
 * carry the model choice, and sample computers to look at them on.
 * Nothing here is saved: every choice stays in this tab.
 */

/** An agent works in turns with tools. A model gives one answer. */
export type EngineKind = "agent" | "model";

export type Engine = {
	id: string;
	name: string;
	kind: EngineKind;
	/** One line: what it runs on. */
	detail: string;
	/** An agent that takes Night Shift's own tools. Always false for a model. */
	takesTools: boolean;
	ready: boolean;
	/** Why it is not ready, and what to do. */
	problem?: string;
};

export type SlotId = "helper" | "quick" | "decision";
export type Takes = "agent-with-tools" | "either" | "model";

export type Slot = {
	id: SlotId;
	title: string;
	what: string;
	takes: Takes;
	takesLabel: string;
};

export const SLOTS: readonly Slot[] = [
	{
		id: "helper",
		title: "Helper",
		what: "Builds and improves flows with you.",
		takes: "agent-with-tools",
		takesLabel: "An agent",
	},
	{
		id: "quick",
		title: "Quick",
		what: 'Short answers: "Ask why" and "Suggest".',
		takes: "either",
		takesLabel: "An agent or a model",
	},
	{
		id: "decision",
		title: "Decision model",
		what: "Decides inside a run and writes the brief of a Gate.",
		takes: "model",
		takesLabel: "A model",
	},
];

export type BuiltinId =
	| "explainer"
	| "improver"
	| "builder"
	| "field-writer"
	| "decider"
	| "brief-writer";

export type Builtin = {
	id: BuiltinId;
	name: string;
	job: string;
	/** What the person gets, in the words of the button. */
	gives: string;
	startedBy: string;
	reads: string;
	proposes: string;
	never: string;
	slot: SlotId;
	takes: Takes;
	limit: string;
};

export const BUILTINS: readonly Builtin[] = [
	{
		id: "builder",
		name: "Builder",
		job: "Makes a flow from a sentence.",
		gives: "Build a flow with an agent",
		startedBy: '"Build with an agent" in the flow editor and on a new flow.',
		reads: "The flow you edit, the other flows and the files of one project.",
		proposes: "A new version of the flow. You apply it.",
		never: "Reads a secret, opens another project, starts a run.",
		slot: "helper",
		takes: "agent-with-tools",
		limit: "$2.00",
	},
	{
		id: "improver",
		name: "Improver",
		job: "Finds what to change in a flow.",
		gives: "Improve a flow from a run or from Spend",
		startedBy: '"Improve this flow" on a run, on Spend and on a project page.',
		reads: "The flows, runs, costs and changes of one project.",
		proposes: "A new version of the flow. You apply it.",
		never: "Reads a secret, opens another project, starts a run.",
		slot: "helper",
		takes: "agent-with-tools",
		limit: "$2.00",
	},
	{
		id: "explainer",
		name: "Explainer",
		job: 'Answers "Ask why" on a run.',
		gives: "Ask why a run stopped",
		startedBy: '"Ask why" on a run, on Home and on your phone.',
		reads: "One run: its steps, what each cost, and where it stopped.",
		proposes: "Nothing. It gives one short answer.",
		never: "Reads another run or a secret. Changes anything.",
		slot: "quick",
		takes: "either",
		limit: "$0.10",
	},
	{
		id: "field-writer",
		name: "Field writer",
		job: "Fills one field.",
		gives: "Suggest a prompt, a command or a field",
		startedBy: '"Suggest …" under a field, and Cmd/Ctrl+I in a prompt.',
		reads: "The flow you edit. An agent also reads the files of the project.",
		proposes: "The text of one field, with a preview.",
		never: "Changes another field. Saves the flow.",
		slot: "quick",
		takes: "either",
		limit: "$0.10",
	},
	{
		id: "decider",
		name: "Decider",
		job: "Picks an option in a run.",
		gives: "Let a model decide in a flow",
		startedBy: "A Decision or a Value that a model decides.",
		reads: "The prompt of its node. Nothing else.",
		proposes: "Nothing. It picks one of the options you wrote.",
		never: "Reads the project. Calls a tool.",
		slot: "decision",
		takes: "model",
		limit: "One call",
	},
	{
		id: "brief-writer",
		name: "Brief writer",
		job: "Writes what a Gate asks.",
		gives: "A short brief on every Gate",
		startedBy: "Every Gate, unless its author turns it off.",
		reads: "The question, the options and what the run did so far.",
		proposes: "Nothing. It writes the brief and how urgent it is.",
		never: "Answers the Gate. Calls a tool.",
		slot: "decision",
		takes: "model",
		limit: "One call",
	},
];

export const builtinOf = (id: string | undefined) =>
	BUILTINS.find((builtin) => builtin.id === id);

/** Whether `engine` can fill something that takes `takes`, and why not. */
export function fits(
	takes: Takes,
	engine: Engine,
): { ok: true } | { ok: false; why: string } {
	if (takes === "model" && engine.kind === "agent") {
		return { ok: false, why: "An agent is too slow to decide in a run." };
	}
	if (takes === "agent-with-tools" && engine.kind === "model") {
		return { ok: false, why: "A model cannot read a project or propose." };
	}
	if (takes === "agent-with-tools" && !engine.takesTools) {
		return { ok: false, why: "This agent cannot use Night Shift's tools." };
	}
	return { ok: true };
}

export const SCENARIOS = [
	{ key: "live", name: "This computer" },
	{ key: "fresh", name: "Sample: new computer" },
	{ key: "half", name: "Sample: an agent, no model" },
	{ key: "full", name: "Sample: all set" },
] as const;

export type ScenarioKey = (typeof SCENARIOS)[number]["key"];

const CLAUDE: Engine[] = [
	{
		id: "p:opus",
		name: "opus",
		kind: "agent",
		detail: "Claude Code · opus · high",
		takesTools: true,
		ready: true,
	},
	{
		id: "p:sonnet",
		name: "sonnet",
		kind: "agent",
		detail: "Claude Code · sonnet",
		takesTools: true,
		ready: true,
	},
];

const PI: Engine = {
	id: "p:pi_local",
	name: "pi_local",
	kind: "agent",
	detail: "pi · a model on this computer",
	takesTools: false,
	ready: true,
};

const CODEX: Engine = {
	id: "p:codex",
	name: "codex",
	kind: "agent",
	detail: "Codex · default model",
	takesTools: true,
	ready: false,
	problem: "Codex is not signed in.",
};

export const LOCAL_MODEL: Engine = {
	id: "m:local",
	name: "Local · llama3.2",
	kind: "model",
	detail: "On this computer. Free.",
	takesTools: false,
	ready: true,
};

const PROVIDER_MODEL: Engine = {
	id: "m:provider",
	name: "fast",
	kind: "model",
	detail: "A provider with a key · a small model",
	takesTools: false,
	ready: true,
};

/** The agent the sample setup connects. */
export const SAMPLE_AGENTS: Engine[] = CLAUDE;

export const SAMPLES: Record<Exclude<ScenarioKey, "live">, Engine[]> = {
	fresh: [],
	half: [...CLAUDE, PI],
	full: [...CLAUDE, PI, CODEX, LOCAL_MODEL, PROVIDER_MODEL],
};
