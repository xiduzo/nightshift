import type { Flow, FlowInputDef } from "../../flow";
import type { SectionProblem } from "../../sections";
import type { FlowIssue } from "../../validate";

/**
 * What "Make subflow from section" takes and gives: its options, the plan,
 * the changes it lists and the blockers. Codes, not words: the editor
 * writes the words.
 */

export type SubflowOptions = {
	/** The new flow's file name, without `.json`. */
	name: string;
	/** The names of the project's flow files, the caller's own included. */
	existingFlowNames: readonly string[];
	/**
	 * The project's flows by name (null: a file that does not parse), for
	 * the checks of Call nodes. Without it, the plan checks both flows
	 * without the Call checks.
	 */
	flows?: Readonly<Record<string, Flow | null>>;
	/** The caller's own file name, when it has one. */
	flowName?: string;
};

/** A node or a flow output of the caller that reads a value. */
export type SubflowReader = { node: string } | { output: string };

/** Where the value of an input of the new flow comes from, in the caller. */
export type SubflowInputSource =
	| { kind: "node"; node: string; field: string }
	| { kind: "input"; input: string }
	| { kind: "run"; field: "flow" | "base_branch" | "index" }
	| { kind: "variable"; variable: string };

/**
 * One thing the plan does or changes, for the dialog to list. `kind`:
 * `info` is what the action does; `differs` is a way the flow works
 * differently afterwards, which the person should see before agreeing.
 *
 * - `nodes-moved`: these nodes move to the new flow, which starts at `entry`.
 * - `call-added`: the Call node that takes their place.
 * - `start-moved`: the flow started inside the Section; it starts at the Call now.
 * - `input-added`: an input of the new flow, bound by the Call to `source`.
 *   `readBy`: the nodes inside that read it (or write it, for a variable).
 * - `output-added`: an output of the new flow, a node's field that `readBy`
 *   (outside) now read from the Call.
 * - `variable-written-back`: a variable that nodes inside write. The new
 *   flow returns it as `output`, and the Call writes it back.
 * - `exit-added`: an exit of the Section. The new flow ends there on
 *   `label` (at `endNode`, null when the node itself ends it), and the
 *   caller goes on to `to`.
 * - `decision-added`: a Decision by rule after the Call that routes on the
 *   label the new flow ended on.
 * - `ends-inside`: outcomes inside that end the run (no edge). The new flow
 *   ends there, and the caller ends at the Decision's `option` (null: at
 *   the Call). The run's end reason names the caller's node.
 * - `section-removed`: the Section goes from the caller.
 * - `restarts-on-resume` (differs): when a step inside fails, the run
 *   stops at the Call, and a resume runs the new flow again from its start.
 * - `reads-earlier-pass` (differs): the flow can come back into the
 *   Section, and `node` reads `reads` (inside), which may not have run yet
 *   in this pass. Before, it read the value of an earlier pass. Now it reads
 *   nothing, as each run of the Subflow starts without node values.
 * - `visit-per-call` (differs): `node` reads the visit count of `reads`
 *   (inside), which now counts from 1 in each run of the Subflow.
 * - `loop-limit-per-call` (differs): these edges inside have a `max`, which
 *   now counts in each run of the Subflow, not in the whole run.
 * - `session-per-call` (differs): these Agent nodes continue their last
 *   session (`session: "resume"`). A new run of the Subflow starts a new one.
 */
export type SubflowChange =
	| { kind: "info"; code: "nodes-moved"; nodes: string[]; entry: string }
	| { kind: "info"; code: "call-added"; node: string; flow: string }
	| { kind: "info"; code: "start-moved"; from: string; to: string }
	| {
			kind: "info";
			code: "input-added";
			input: string;
			type: FlowInputDef["type"];
			source: SubflowInputSource;
			readBy: string[];
	  }
	| {
			kind: "info";
			code: "output-added";
			output: string;
			node: string;
			field: string;
			readBy: SubflowReader[];
	  }
	| {
			kind: "info";
			code: "variable-written-back";
			variable: string;
			output: string;
			writtenBy: string[];
	  }
	| {
			kind: "info";
			code: "exit-added";
			label: string;
			from: string;
			outcome: string;
			to: string[];
			endNode: string | null;
	  }
	| { kind: "info"; code: "decision-added"; node: string; options: string[] }
	| {
			kind: "info";
			code: "ends-inside";
			ends: { node: string; outcome: string; option: string | null }[];
	  }
	| { kind: "info"; code: "section-removed"; section: string }
	| { kind: "differs"; code: "restarts-on-resume" }
	| {
			kind: "differs";
			code: "reads-earlier-pass";
			reads: { node: string; reads: string }[];
	  }
	| {
			kind: "differs";
			code: "visit-per-call";
			reads: { node: string; reads: string }[];
	  }
	| { kind: "differs"; code: "loop-limit-per-call"; edges: string[] }
	| { kind: "differs"; code: "session-per-call"; nodes: string[] };

/**
 * Why the Section cannot become a Subflow and keep its meaning.
 *
 * - `section-not-found`: the flow has no Section with that id.
 * - `name-not-valid`: the name is not a valid flow file name.
 * - `name-taken`: a flow of the project has that name.
 * - `section-not-valid`: the Section is not one connected part with one
 *   entry (`canMakeSection`). A start inside the Section that is not its
 *   entry is a second entry (`several-entries`).
 * - `flow-not-valid`: the flow has errors now. Fix them first.
 * - `stopped-edge`: these Call nodes inside go on along a `stopped` edge
 *   after the stop time. Inside a Subflow, the caller stops instead.
 * - `calls-new-flow`: these Call nodes inside call a flow of the new name.
 * - `end-node`: these End nodes inside end the run. Inside a Subflow they
 *   end the Subflow only, and the caller goes on.
 * - `mixed-exit`: edges on one outcome lead inside and outside, and an edge
 *   inside comes after an edge outside that has a `max`. Its count stays
 *   with the caller, so the new flow cannot pick between them.
 * - `rule-reads-outside`: a rule or an expression of `node` (inside) reads
 *   these nodes outside, or a run field that differs inside a Call
 *   (`run.flow`). Rules are not rewritten: read the value in a template, or
 *   move the node.
 * - `rule-reads-inside`: a rule or an expression of `node` (outside) reads
 *   these nodes inside.
 * - `loop-without-limit`: a loop through the Section has its only `max` on
 *   `edges` inside. Inside a Subflow it counts per run of the Subflow, so
 *   the loop through the Call has no limit. Give an edge outside a max.
 * - `result-not-valid`: the planned flow has errors (a safety net: the
 *   checks above should catch every case).
 */
export type SubflowBlocker =
	| { code: "section-not-found"; section: string }
	| { code: "name-not-valid"; name: string }
	| { code: "name-taken"; name: string }
	| { code: "section-not-valid"; problems: SectionProblem[] }
	| { code: "flow-not-valid"; errors: number }
	| { code: "stopped-edge"; nodes: string[] }
	| { code: "calls-new-flow"; nodes: string[] }
	| { code: "end-node"; nodes: string[] }
	| { code: "mixed-exit"; from: string; outcome: string; edges: string[] }
	| { code: "rule-reads-outside"; node: string; names: string[] }
	| { code: "rule-reads-inside"; node: string; names: string[] }
	| { code: "loop-without-limit"; edges: string[] }
	| {
			code: "result-not-valid";
			flow: "caller" | "subflow";
			issues: FlowIssue[];
	  };

export type SubflowPlan =
	| {
			ok: true;
			/** The new flow file, to save as `<name>.json`. */
			subflow: Flow;
			/** The flow with the Call node in place of the Section. */
			caller: Flow;
			/** The id of the Call node in `caller`. */
			callNode: string;
			/** The id of the Decision after the Call, or null when none is needed. */
			decisionNode: string | null;
			changes: SubflowChange[];
	  }
	| { ok: false; blockers: SubflowBlocker[] };
