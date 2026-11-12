import type { NodeCheck } from "./base";
import type { OutcomeColor } from "./outcomes";

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
	/** The secrets the node names, known before a run (`flowSecrets`). */
	secrets: (node: N, known: KnownText) => readonly string[];
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
