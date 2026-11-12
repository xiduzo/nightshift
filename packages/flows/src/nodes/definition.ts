import type { AgentNode } from "./agent";
import type { NodeCheck } from "./base";
import type { DecisionNode } from "./decision";
import type { OutcomeColor } from "./outcomes";
import type { NodeText } from "./texts";

/**
 * The definition of one node type: every fact of the type that holds
 * without a run. Each file in `nodes/` exports the definition of its type,
 * and `NODE_DEFINITIONS` (`flow/node.ts`) lists them, one per type of the
 * flow schema. A type without a definition, or a definition without a
 * fact, does not compile. The facts that need a run stay in the engine
 * (`NodeKind`).
 */

/**
 * The families of node types, by their role, in the order the editor
 * shows them. Do: work that changes something or fetches it. Decide: pick
 * a way on. Shape: make a value from other values. Hold: wait for a time,
 * a turn or a process. Compose: run other flows, meet, and end.
 */
export const NODE_FAMILIES = [
	"do",
	"decide",
	"shape",
	"hold",
	"compose",
] as const;
export type NodeFamily = (typeof NODE_FAMILIES)[number];

/** What a person calls each family: the headings of the add-node dialog. */
export const NODE_FAMILY_LABEL = {
	do: "Do",
	decide: "Decide",
	shape: "Shape",
	hold: "Hold",
	compose: "Compose",
} as const satisfies Record<NodeFamily, string>;

/**
 * The outcomes Night Shift names itself: the ones a node ends on when the
 * flow names none (`nodeOutcomes`), and the ones the engine ends a step on
 * when its work did not finish (`error`, `stopped`, `interrupted`). Any
 * other outcome is a name the flow gives: an agent outcome, a command exit,
 * a Decision option. Each screen gives these a word of their own.
 */
export type BuiltInOutcome =
	| "pass"
	| "fail"
	| "needs-input"
	| "done"
	| "halted"
	| "timeout"
	| "error"
	| "stopped"
	| "interrupted";

/**
 * A template's text as it renders before a run, or null when only a run
 * knows it: a reference to an input that the run gets, or to a node.
 */
export type KnownText = (template: string) => string | null;

/** Where a node sits on the canvas. */
export type Position = { x: number; y: number };

/**
 * What a new Agent or Decision node starts with: the daemon's settings
 * (Settings → New nodes). Each one left out keeps the built-in default.
 */
export type NodeDefaults = {
	agentHarness?: AgentNode["harness"];
	agentModel?: string;
	agentPermissionMode?: AgentNode["permissionMode"];
	decisionDecider?: DecisionNode["decider"];
};

/** A node the editor adds, of one kind of the palette. */
export type NewNode<N> = {
	/** The id it takes, with `_2`, `_3`, … when that is taken. */
	id: string;
	/**
	 * Whether it starts from nothing or takes a value: the main output of
	 * the node it follows (`NodeDefinition.takeValue`).
	 */
	takes: "nothing" | "value";
	/** The node, with what it starts with. The issues panel asks for the rest. */
	create: (id: string, position: Position, defaults: NodeDefaults) => N;
};

/** The value a new node takes: the main output of the node it follows. */
export type TakenValue = {
	/** Its reference: `news.data`. */
	ref: string;
	/** The reference of the one list in it, else `ref`: `news.data.items`. */
	list: string;
	/** Its path in a rule (JSONata). */
	path: string;
};

/** The id of the Device that the profiles of the examples belong to. */
export const EXAMPLE_DEVICE = "8c1e4f2a-6b0d-4a7e-9f3c-2d5b7e9a1c4f";

/**
 * The facts of one node type. `N` is the type's node as the schema reads
 * it, `I` as a flow file holds it, before defaults apply.
 */
export type NodeDefinition<N extends { type: string }, I> = {
	type: N["type"];
	/**
	 * What a person calls the type, on every screen: a Call node is a
	 * Subflow. A Decision has a name of its own by who decides it
	 * (`DECISION_LABEL`).
	 */
	label: string;
	/** Its family: where the add-node dialog shows it. */
	family: NodeFamily;
	/**
	 * Whether a test run may pin or skip a node of the type (ADR 27). An End
	 * ends the run, a Join waits for its branches, a Lease and a Service hold
	 * something for the steps after them: those always run.
	 */
	standsIn: boolean;
	/** The outcomes a node can end with, in the order its handles show. */
	outcomes: (node: N) => readonly string[];
	/** The colour the node gives one of its own outcomes, or undefined when it sets none. */
	outcomeColor: (node: N, outcome: string) => OutcomeColor | undefined;
	/**
	 * The fields a later node reads with `{{<nodeId>.<field>}}`, before the
	 * fields a cascade adds and a Call's called flow (`nodeOutputFields`).
	 */
	outputFields: readonly string[];
	/** The checks of the node's own content: its templates, rules and fields. */
	check: (node: N, check: NodeCheck) => void;
	/**
	 * Every text of the node that can read a name of the flow, by where it
	 * sits: its templates, its shell commands and its rules, in the order a
	 * rename visits them. The variable writes every node has come after
	 * them (`nodeBaseTexts`). A field the node does not read as it is set
	 * up now counts too (the Ask fields of a Value a model makes): set up
	 * again, it reads the new names. The check reads only the texts in use,
	 * and each of those is one of these.
	 */
	texts: readonly NodeText[];
	/**
	 * The other string fields of the node that could hold a template, but
	 * hold plain text: names, models, places, rules over a signal or a
	 * model's value. With `texts` and the plain fields of every node
	 * (`nodeBasePlain`), they name each such field of the type's schema once.
	 */
	plain: readonly string[];
	/** The secrets the node names, known before a run (`flowSecrets`). */
	secrets: (node: N, known: KnownText) => readonly string[];
	/**
	 * Whether ending with `outcome` and no edge ends the node's flow as
	 * chosen (`finished`), not as a failure. The engine's walk asks this
	 * (`route()`), and so does Make subflow. A stop never gets here: the walk
	 * parks it first.
	 */
	endsFlow: (node: N, outcome: string) => boolean;
	/** What a Call reports in `ended` when its flow ended at this node: the label, or "". */
	endedLabel: (node: N, outcome: string) => string;
	/**
	 * Whether a step of the node runs something on its computer beyond the
	 * run's folder: a process, a session, a tool, a web request or a model.
	 * An Offer allows only an offered Agent there. Where a step runs and
	 * what it needs there at run time is the engine's (`NodeKind.works`).
	 */
	touchesDevice: (node: N) => boolean;
	/**
	 * The output field that the node's own `output` schema types (`data`,
	 * a Web request's `body`), or null when the node has no output schema
	 * (`typedOutput`).
	 */
	typedOutputField: (node: N) => string | null;
	/**
	 * The output field that holds what the node made or found: the field a
	 * new node that takes a value reads (`mainOutputField`).
	 */
	mainOutputField: (node: N) => string;
	/**
	 * The new nodes the editor adds of this type, by their kind in the
	 * palette: the type itself, and for a Decision also a Gate and a Branch.
	 */
	newNodes: Readonly<Record<string, NewNode<N>>>;
	/** A new node that reads `value` where its kind reads one, else the node as it is. */
	takeValue: (node: N, value: TakenValue) => N;
	/**
	 * One small, valid node of the type, as a flow file holds it. The flow
	 * authoring guide shows it, and the table test of the definitions reads
	 * every fact from it.
	 */
	sample: I;
};

/** For a type whose outcomes take no colour of the node. */
export const noOwnColors = (): OutcomeColor | undefined => undefined;

/** For a type that names no secret. */
export const noSecrets = (): readonly string[] => [];

/** For a type whose flow ends as chosen on `pass` only. */
export const endsOnPass = (_node: unknown, outcome: string): boolean =>
	outcome === "pass";

/** For a type whose end a Call reports with no label. */
export const noEndedLabel = (): string => "";

/** For a type whose new node reads no value. */
export const takesNoValue = <N>(node: N): N => node;
