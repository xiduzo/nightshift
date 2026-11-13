/**
 * PROTOTYPE, throw away. The six built-in agents of Night Shift: what
 * each does and what can answer for it. Nothing here is saved.
 */

/** A harness works in turns with tools. A model gives one answer. */
export type Takes = "harness-with-tools" | "either" | "model";

export const TAKES_LABEL: Record<Takes, string> = {
	"harness-with-tools": "An agent",
	either: "An agent or a model",
	model: "A model",
};

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
	startedBy: string;
	reads: string;
	proposes: string;
	never: string;
	takes: Takes;
	limit: string;
};

export const BUILTINS: readonly Builtin[] = [
	{
		id: "builder",
		name: "Builder",
		job: "Makes a flow from a sentence.",
		startedBy: '"Build with an agent" in the flow editor and on a new flow.',
		reads: "The flow you edit, the other flows and the files of one project.",
		proposes: "A new version of the flow. You apply it.",
		never: "Reads a secret, opens another project, starts a run.",
		takes: "harness-with-tools",
		limit: "$2.00",
	},
	{
		id: "improver",
		name: "Improver",
		job: "Finds what to change in a flow.",
		startedBy: '"Improve this flow" on a run, on Spend and on a project page.',
		reads: "The flows, runs, costs and changes of one project.",
		proposes: "A new version of the flow. You apply it.",
		never: "Reads a secret, opens another project, starts a run.",
		takes: "harness-with-tools",
		limit: "$2.00",
	},
	{
		id: "explainer",
		name: "Explainer",
		job: 'Answers "Ask why" on a run.',
		startedBy: '"Ask why" on a run, on Home and on your phone.',
		reads: "One run: its steps, what each cost, and where it stopped.",
		proposes: "Nothing. It gives one short answer.",
		never: "Reads another run or a secret. Changes anything.",
		takes: "either",
		limit: "$0.10",
	},
	{
		id: "field-writer",
		name: "Field writer",
		job: "Fills one field.",
		startedBy: '"Suggest …" under a field, and Cmd/Ctrl+I in a prompt.',
		reads: "The flow you edit. An agent also reads the files of the project.",
		proposes: "The text of one field, with a preview.",
		never: "Changes another field. Saves the flow.",
		takes: "either",
		limit: "$0.10",
	},
	{
		id: "decider",
		name: "Decider",
		job: "Picks an option in a run.",
		startedBy: "A Decision or a Value that a model decides.",
		reads: "The prompt of its node. Nothing else.",
		proposes: "Nothing. It picks one of the options you wrote.",
		never: "Reads the project. Calls a tool.",
		takes: "model",
		limit: "One call",
	},
	{
		id: "brief-writer",
		name: "Brief writer",
		job: "Writes what a Gate asks.",
		startedBy: "Every Gate, unless its author turns it off.",
		reads: "The question, the options and what the run did so far.",
		proposes: "Nothing. It writes the brief and how urgent it is.",
		never: "Answers the Gate. Calls a tool.",
		takes: "model",
		limit: "One call",
	},
];

export const builtinOf = (id: string | undefined) =>
	BUILTINS.find((builtin) => builtin.id === id);
