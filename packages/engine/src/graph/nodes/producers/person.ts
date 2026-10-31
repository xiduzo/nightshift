import { isAbsolute, relative, resolve as resolvePath } from "node:path";
import { Command } from "@langchain/langgraph";
import {
	ASK_ANSWER,
	type AskAttachment,
	type AskChoice,
	type AskForm,
	type AttachmentSource,
	type ChoiceItem,
	choiceItemSchema,
	type GateDeadline as DeadlineSpec,
	type JsonValue,
	renderTemplate,
	renderValue,
	type TemplateContext,
	type ValueNode,
	withChoices,
} from "@nightshift/flows";
import { createArtifactStore } from "../../../artifacts";
import type { GateChoice, StepOutputs } from "../../../log";
import type { NodeAction, StepContext } from "../../context";
import { interruptNode } from "../../interrupt";
import { askAnswerProblem } from "../../output-schema";
import { route } from "../../route";
import type { OpenStep } from "../../step-runner";
import {
	type GateAsk,
	type GateEnding,
	gateChooser,
	resolve,
} from "../choosers/person";
import { type Producer, valueOutputs } from "./producer";

/**
 * A Value made by a person: an Ask (ADR 10). It is a Gate with a form, so
 * the Needs-you inbox, the notifications, the phone, a deadline and a
 * restart treat it as a Gate (`choosers/person.ts`). Its one choice is
 * `answer`; the answer's data, held to the form's schema, is the step's
 * `data`.
 *
 * The form is made as the Gate opens: the node's output schema, with the
 * names of the run's choices (`choices.from`, rendered) as the `enum` of
 * the field the node names, and the attachments. A file attachment is
 * copied from the run's copy of the project on this computer into the
 * run's artifacts, so the web and the phone can show it after the copy
 * changes. A choices list that is not valid, or a file that is not there,
 * ends the step `error` with why: the Gate does not open.
 *
 * The engine refuses an answer whose data does not match the form before
 * it resumes the thread (`run/actions.ts`). At the deadline, the Ask takes
 * the node's `default`; with none, the step ends `fail`.
 */
export function personProducer(node: ValueNode, ctx: StepContext): Producer {
	return gateChooser(node, ctx, askGate(node, ctx, {}));
}

/**
 * What else an Ask starts with: the data the form starts with, the data
 * the deadline takes, and the deadline (the node's, else this one). The
 * person tier of a cascade gives these.
 */
export type AskHow = {
	prefill?: JsonValue;
	deadline?: DeadlineSpec;
	default?: JsonValue;
	outputs?: StepOutputs;
	climb?: true;
};

/** The one choice of an Ask's Gate: an older screen shows it, and the engine asks for the data. */
const ANSWER: GateChoice = {
	name: ASK_ANSWER,
	description: "Fill in the form to answer.",
};

/** The Gate an Ask opens: the rendered prompt, the one choice, and the form. */
export function askGate(
	node: ValueNode,
	ctx: StepContext,
	how: AskHow,
): GateAsk {
	const deadline =
		how.deadline ??
		(node.deadline === undefined
			? undefined
			: { ...node.deadline, choose: ASK_ANSWER });
	const fallback = how.default ?? node.default;
	return {
		question: (tctx) => renderTemplate(node.prompt ?? "", tctx),
		choices: [ANSWER],
		...(deadline ? { deadline } : {}),
		outputs: { ...how.outputs, data: null },
		...(how.climb ? { climb: true as const } : {}),
		form: (step) =>
			askForm(node, ctx, step, {
				...(how.prefill !== undefined ? { prefill: how.prefill } : {}),
				...(fallback !== undefined ? { default: fallback } : {}),
			}),
	};
}

/** The form of an Ask, as the Gate opens: the schema with the run's choices, and the attachments kept. */
async function askForm(
	node: ValueNode,
	ctx: StepContext,
	step: OpenStep,
	start: Pick<AskForm, "prefill" | "default">,
): Promise<AskForm> {
	const keep = keeper(ctx, step);
	const items =
		node.choices === undefined
			? []
			: choiceItems(renderValue(node.choices.from, step.tctx));
	const sources = (node.attachments ?? []).map((source) =>
		rendered(source, step.tctx),
	);
	// Every attachment is checked before any file is kept.
	for (const source of [
		...items.flatMap((item) => item.attachments ?? []),
		...sources,
	]) {
		attachmentProblem(source, step.worktree);
	}
	let schema = node.output as AskForm["schema"];
	let choices: AskForm["choices"];
	if (node.choices !== undefined) {
		schema = withChoices(
			schema,
			node.choices.field,
			items.map((item) => item.name),
		);
		choices = {
			field: node.choices.field,
			items: await Promise.all(items.map((item) => askChoice(item, keep))),
		};
	}
	const attachments = await Promise.all(sources.map(keep));
	return {
		schema,
		...(choices ? { choices } : {}),
		...(attachments.length > 0 ? { attachments } : {}),
		...start,
	};
}

/** An attachment's templates rendered: a static attachment of the node may name the run's values. */
function rendered(
	source: AttachmentSource,
	tctx: TemplateContext,
): AttachmentSource {
	return {
		...source,
		...(source.path !== undefined
			? { path: renderTemplate(source.path, tctx).trim() }
			: {}),
		...(source.url !== undefined
			? { url: renderTemplate(source.url, tctx).trim() }
			: {}),
	};
}

/** At most this many choices: a form with more is not one a person reads. */
const MAX_CHOICES = 100;

/**
 * The list `choices.from` rendered: JSON text is read as JSON. Throws,
 * with words for the flow's author, when it is not a list of choices,
 * when a name repeats, or when it is empty.
 */
export function choiceItems(value: JsonValue): ChoiceItem[] {
	let list: unknown = value;
	if (typeof value === "string") {
		try {
			list = JSON.parse(value);
		} catch {
			throw new Error(
				"The choices are not a list. Give a list of { name, label } from an earlier node.",
			);
		}
	}
	if (!Array.isArray(list)) {
		throw new Error(
			"The choices are not a list. Give a list of { name, label } from an earlier node.",
		);
	}
	if (list.length === 0) {
		throw new Error("The list of choices is empty. Give at least one.");
	}
	if (list.length > MAX_CHOICES) {
		throw new Error(
			`The list has ${list.length} choices. Give at most ${MAX_CHOICES}.`,
		);
	}
	const items = list.map((item, index) => {
		const parsed = choiceItemSchema.safeParse(item);
		if (!parsed.success) {
			throw new Error(
				`Choice ${index + 1} is not valid: it needs a name and a label.`,
			);
		}
		return parsed.data;
	});
	const names = new Set<string>();
	for (const { name } of items) {
		if (names.has(name)) {
			throw new Error(
				`Two choices have the name "${name}". Give each its own.`,
			);
		}
		names.add(name);
	}
	return items;
}

async function askChoice(
	item: ChoiceItem,
	keep: (source: AttachmentSource) => Promise<AskAttachment>,
): Promise<AskChoice> {
	const attachments = await Promise.all((item.attachments ?? []).map(keep));
	return {
		name: item.name,
		label: item.label,
		...(item.description !== undefined
			? { description: item.description }
			: {}),
		...(attachments.length > 0 ? { attachments } : {}),
	};
}

/**
 * Keeps one attachment for the form: a file of the run's copy of the
 * project becomes an artifact of the run, a link stays a link. Throws when
 * the file is not in the copy, or the link is not a web address.
 */
function keeper(
	ctx: StepContext,
	step: OpenStep,
): (source: AttachmentSource) => Promise<AskAttachment> {
	const store = createArtifactStore(ctx.dataDir);
	return async (source) => {
		attachmentProblem(source, step.worktree);
		const url = source.url?.trim() ?? "";
		if (url !== "") return { label: source.label ?? url, url };
		const path = source.path?.trim() ?? "";
		const artifact = await store.save({
			runId: ctx.run.id,
			stepId: step.stepId,
			cwd: step.worktree,
			path,
			...(source.label !== undefined ? { title: source.label } : {}),
		});
		return {
			label: artifact.title,
			artifactId: artifact.id,
			mediaType: artifact.mediaType,
		};
	};
}

/** Throws when the link is not a web address, or the file is not in the run's copy of the project. */
function attachmentProblem(source: AttachmentSource, cwd: string): void {
	const url = source.url?.trim() ?? "";
	if (url !== "") {
		if (!isWebAddress(url)) {
			throw new Error(
				`The link "${url}" is not a web address. Give one that starts with https://.`,
			);
		}
		return;
	}
	const path = source.path?.trim() ?? "";
	if (path === "" || !insideCopy(cwd, path)) {
		throw new Error(
			`The file "${path}" is not in the run's copy of the project. Give a path inside it.`,
		);
	}
}

function isWebAddress(text: string): boolean {
	try {
		const { protocol } = new URL(text);
		return protocol === "https:" || protocol === "http:";
	} catch {
		return false;
	}
}

/** A relative path that stays in the copy: no absolute path, no way out with `..`. */
function insideCopy(cwd: string, path: string): boolean {
	if (isAbsolute(path)) return false;
	const within = relative(cwd, resolvePath(cwd, path));
	return within !== "" && !within.startsWith("..") && !isAbsolute(within);
}

/**
 * How the answer ends the Ask's step: `pass` with the data, held to the
 * form's schema. At the deadline: the form's default, or `fail` without
 * one. Data that does not match (a default the checks could not judge)
 * ends it `fail`, with why in `note`.
 */
export function askEnding(
	form: AskForm,
	answer: { data?: JsonValue; byDeadline?: true },
	visit: number,
): GateEnding {
	const fail = (why: string): GateEnding => ({
		outcome: "fail",
		climbs: false,
		note: why,
		outputs: valueOutputs("fail", null, why, visit),
		event: { type: "value", data: null, problem: why },
	});
	const data = answer.byDeadline ? form.default : answer.data;
	if (answer.byDeadline && data === undefined) {
		return fail("Nobody answered by the deadline.");
	}
	const problem = askAnswerProblem(form, data);
	if (problem !== null) return fail(problem);
	const made = data as JsonValue;
	const note = answer.byDeadline
		? "Nobody answered by the deadline, so Night Shift took the default."
		: "";
	return {
		outcome: "pass",
		climbs: false,
		note,
		outputs: valueOutputs("pass", made, note, visit),
		event: { type: "value", data: made, problem: null },
	};
}

/** The node opens its Ask again, in a new visit. */
function askAgain(node: ValueNode): Command {
	return new Command({
		update: { pending: { [node.id]: null } },
		goto: node.id,
	});
}

/**
 * The ask node of an Ask (`ask__<id>`): interrupts with the Gate the node
 * opened and, on the answer, ends the step with the form's data and
 * routes. A reopen asks again in a new visit, as a Gate does.
 */
export function askAnswerNode(node: ValueNode, ctx: StepContext): NodeAction {
	return interruptNode({
		kind: "gate",
		nodeId: node.id,
		missing: `No question is open at node "${node.id}".`,
		value: (pending) => ({
			kind: "gate",
			stepId: pending.stepId,
			nodeId: node.id,
			question: pending.question,
			choices: pending.choices,
			...(pending.deadline ? { deadline: pending.deadline } : {}),
		}),
		async answer(pending, answer, state, config) {
			if (answer?.kind !== "gate" || pending.form === undefined) {
				return askAgain(node);
			}
			const form = pending.form as AskForm;
			const done = await resolve(
				ctx,
				node,
				state,
				config,
				pending,
				answer,
				() => askEnding(form, answer, pending.visit),
			);
			if (done.kind === "parked") return done.command;
			return route(ctx, state, node, done.end, config);
		},
		stale: { ctx, letGo: () => askAgain(node) },
	});
}
