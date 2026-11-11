import type { CostSource } from "@nightshift/agents/pricing";
import type { ValueResult } from "@nightshift/agents/types";
import {
	DEFAULT_GATE_URGENCY,
	GATE_URGENCIES,
	type GateBriefFields,
	type GateUrgency,
	isGateUrgency,
	renderTemplate,
	type TemplateContext,
	valueDecider,
} from "@nightshift/flows";
import type {
	DerivedStep,
	GateBackgroundItem,
	GateBrief,
	GateBriefPart,
	GateChoice,
	StepOutputs,
} from "../log";
import type { StepContext } from "./context";
import { deciderCostSource } from "./cost";
import type { StepHandle } from "./step-runner";

/**
 * The brief of a Gate (ADR 21), written as the Gate opens: how urgent it
 * is, why a person must decide, what is already done, which option the
 * flow recommends, and what each option does. The author's fields come
 * first (rendered). What the author left empty, the engine fills from
 * what it knows (a cascade's tiers), and then one model call writes the
 * rest, unless the node says `fillBrief: false`.
 *
 * The model call never blocks or fails the Gate: no decider, an error, or
 * no answer within a minute, and the Gate opens with what it has. Its
 * cost goes on the Gate's step (`GateOpened.briefCostUsd`).
 */

/** The parts of a Gate's brief, as one source gives them: text already rendered. */
export type BriefParts = {
	urgency?: string;
	situation?: string;
	/** Text (`- ` lines are items) or items. */
	background?: string | readonly (string | GateBackgroundItem)[];
	recommend?: { option?: string; reason?: string };
	/** What each option does, by its name. */
	impacts?: Readonly<Record<string, string | undefined>>;
};

/** What a Gate's node says about its brief, before the Gate renders it. */
export type BriefSpec = {
	/** The author's fields, with templates. */
	fields: GateBriefFields;
	/** The author's impact of each option, with templates, by option name. */
	impacts?: Readonly<Record<string, string | undefined>>;
	/** The Gate's choices are options a person may be recommended: a Decision's. */
	recommends: boolean;
	/**
	 * What the engine knows besides the author (a cascade's tiers): it
	 * fills a part the author left empty, before a model does.
	 */
	known?: Pick<BriefParts, "background" | "recommend">;
};

/** The brief a Gate opens with. */
export type WrittenBrief = {
	urgency: GateUrgency;
	brief: GateBrief;
	/** The choices, with their impacts. */
	choices: GateChoice[];
	/** What the model call cost. Null: no model was asked. */
	cost: {
		costUsd: number | null;
		/** As `StepEnded.costSource`: absent when the call failed before it spent. */
		costSource?: CostSource | null;
	} | null;
};

/** A source chip at the end of an item: `The tests pass (source: CI)`. */
const SOURCE = /\s*\(source:\s*([^)]+)\)\s*$/i;

/** One item of a background, with its source chip read off its end. */
function backgroundItem(text: string): GateBackgroundItem | null {
	const match = SOURCE.exec(text);
	const body = (match ? text.slice(0, match.index) : text).trim();
	if (body === "") return null;
	return { text: body, source: match?.[1]?.trim() || null };
}

/**
 * The items of a background text: each line that starts with `- ` is an
 * item (the lines under it belong to it); without such a line the whole
 * text is one item.
 */
export function backgroundItems(text: string): GateBackgroundItem[] {
	const lines = text.split(/\r?\n/);
	if (!lines.some((line) => line.trimStart().startsWith("- "))) {
		const one = backgroundItem(text.trim());
		return one ? [one] : [];
	}
	const items: string[] = [];
	for (const line of lines) {
		const trimmed = line.trimStart();
		if (trimmed.startsWith("- ")) items.push(trimmed.slice(2));
		else if (items.length > 0 && trimmed !== "") {
			items[items.length - 1] = `${items.at(-1)} ${trimmed}`;
		}
	}
	return items.flatMap((item) => backgroundItem(item) ?? []);
}

const textOf = (text: string | undefined): string | null => {
	const trimmed = text?.trim() ?? "";
	return trimmed === "" ? null : trimmed;
};

function itemsOf(background: BriefParts["background"]): GateBackgroundItem[] {
	if (background === undefined) return [];
	if (typeof background === "string") return backgroundItems(background);
	return background.flatMap((item) =>
		typeof item === "string"
			? (backgroundItem(item) ?? [])
			: textOf(item.text) === null
				? []
				: [{ text: item.text.trim(), source: textOf(item.source ?? "") }],
	);
}

/**
 * A brief from parts that are already text: the urgency when it is one of
 * the three, the background as items, a recommendation of one of the
 * choices (a recommendation of anything else is left out), and the
 * impacts on the choices. `recommends` false: no recommendation.
 */
export function briefOf(
	parts: BriefParts,
	choices: readonly GateChoice[],
	recommends: boolean,
): Omit<WrittenBrief, "cost"> {
	const urgency = parts.urgency?.trim().toLowerCase() ?? "";
	const known = isGateUrgency(urgency);
	const option = parts.recommend?.option?.trim() ?? "";
	const recommended =
		recommends && choices.some((choice) => choice.name === option);
	return {
		urgency: known ? urgency : DEFAULT_GATE_URGENCY,
		brief: {
			urgencyBy: known ? "flow" : "default",
			situation: textOf(parts.situation),
			background: itemsOf(parts.background),
			recommendation: recommended
				? { option, reason: textOf(parts.recommend?.reason) }
				: null,
			byModel: [],
		},
		choices: choices.map((choice) => {
			const impact = textOf(parts.impacts?.[choice.name]);
			return impact === null ? choice : { ...choice, impact };
		}),
	};
}

/** The author's parts rendered, with what the engine knows where the author wrote nothing. */
function renderedParts(spec: BriefSpec, tctx: TemplateContext): BriefParts {
	const render = (text: string | undefined) =>
		text === undefined ? undefined : renderTemplate(text, tctx);
	const { fields, known } = spec;
	const background = render(fields.background);
	const recommend = fields.recommend
		? {
				option: render(fields.recommend.option),
				reason: render(fields.recommend.reason),
			}
		: undefined;
	return {
		urgency: render(fields.urgency),
		situation: render(fields.situation),
		background: textOf(background) === null ? known?.background : background,
		recommend:
			textOf(recommend?.option) === null ? known?.recommend : recommend,
		impacts: Object.fromEntries(
			Object.entries(spec.impacts ?? {}).map(([name, impact]) => [
				name,
				render(impact),
			]),
		),
	};
}

/** The parts still empty that a model may write. */
export function missingParts(
	written: Omit<WrittenBrief, "cost">,
	recommends: boolean,
): GateBriefPart[] {
	const { brief } = written;
	return [
		...(brief.urgencyBy === "default" ? (["urgency"] as const) : []),
		...(brief.situation === null ? (["situation"] as const) : []),
		...(brief.background.length === 0 ? (["background"] as const) : []),
		...(recommends && brief.recommendation === null
			? (["recommendation"] as const)
			: []),
		...(recommends && written.choices.some((choice) => !choice.impact)
			? (["impacts"] as const)
			: []),
	];
}

/** At most this many characters of the run so far in the model's prompt. */
const DIGEST_CHARS = 12_000;
/** At most this many characters of one step in it. */
const STEP_CHARS = 1_500;

const clip = (text: string, max: number) =>
	text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** What one step that ended said: its summary, note or output, else its outputs. */
function stepLine(step: DerivedStep): string {
	const outputs: StepOutputs = step.outputs;
	const said = ["summary", "note", "ended", "end_message", "output"]
		.map((field) => outputs[field])
		.find(
			(value): value is string => typeof value === "string" && value !== "",
		);
	const { visit: _visit, outcome: _outcome, ...rest } = outputs;
	const body =
		said ?? (Object.keys(rest).length > 0 ? JSON.stringify(rest) : "");
	const head = `- ${step.nodeId} (${step.nodeType}) ended ${step.outcome}`;
	return clip(body === "" ? `${head}.` : `${head}: ${body}`, STEP_CHARS);
}

/**
 * The run so far for the model: the steps that ended, oldest first, each
 * with what it said. The newest steps win when the run says more than
 * `DIGEST_CHARS`.
 */
export function runDigest(steps: Iterable<DerivedStep>): string {
	const ended = [...steps]
		.filter((step) => step.endedAt !== null && step.outcome !== null)
		.sort((a, b) => a.startedAt - b.startedAt);
	const lines: string[] = [];
	let size = 0;
	for (const step of ended.reverse()) {
		const line = stepLine(step);
		if (size + line.length + 1 > DIGEST_CHARS) break;
		lines.push(line);
		size += line.length + 1;
	}
	return lines.reverse().join("\n");
}

/** The JSON Schema the model answers with: only the parts it writes. */
function briefSchema(
	missing: readonly GateBriefPart[],
	choices: readonly GateChoice[],
): Record<string, unknown> {
	const names = choices.map((choice) => choice.name);
	const lacking = choices
		.filter((choice) => !choice.impact)
		.map((choice) => choice.name);
	const all: Record<GateBriefPart, Record<string, unknown>> = {
		urgency: { type: "string", enum: [...GATE_URGENCIES] },
		situation: { type: "string" },
		background: {
			type: "array",
			items: {
				type: "object",
				properties: { text: { type: "string" }, source: { type: "string" } },
				required: ["text", "source"],
				additionalProperties: false,
			},
		},
		recommendation: {
			type: "object",
			properties: {
				option: { type: "string", enum: names },
				reason: { type: "string" },
			},
			required: ["option", "reason"],
			additionalProperties: false,
		},
		impacts: {
			type: "object",
			properties: Object.fromEntries(
				lacking.map((name) => [name, { type: "string" }]),
			),
			required: lacking,
			additionalProperties: false,
		},
	};
	return {
		type: "object",
		properties: Object.fromEntries(missing.map((part) => [part, all[part]])),
		required: [...missing],
		additionalProperties: false,
	};
}

/** What the model is told about each part it writes. */
const PART_RULES: Record<GateBriefPart, string> = {
	urgency:
		'urgency: "now" when work is blocked or something breaks until the person answers, or a deadline is close. "today" when the run waits but nothing breaks. "later" when nothing waits on the answer.',
	situation:
		"situation: why a person must decide this, in one or two short sentences.",
	background:
		"background: what is already decided, checked or done, one fact per item. Give the step the fact comes from as its source, else an empty string.",
	recommendation:
		"recommendation: the option you recommend, and why in one sentence. Recommend only what the run supports.",
	impacts:
		"impacts: for each option named in the schema, one sentence on what happens when the person picks it.",
};

/** The prompt of the model that writes the missing parts. */
export function briefPrompt(input: {
	question: string;
	choices: readonly GateChoice[];
	written: Omit<WrittenBrief, "cost">;
	missing: readonly GateBriefPart[];
	digest: string;
}): string {
	const { brief } = input.written;
	const options = input.choices
		.map((choice) =>
			[
				`- ${choice.name}`,
				choice.description ? `: ${choice.description}` : "",
				choice.impact ? ` (when picked: ${choice.impact})` : "",
			].join(""),
		)
		.join("\n");
	const known = [
		brief.urgencyBy === "flow" ? `Urgency: ${input.written.urgency}` : "",
		brief.situation ? `Situation: ${brief.situation}` : "",
		brief.background.length > 0
			? `Background:\n${brief.background.map((item) => `- ${item.text}`).join("\n")}`
			: "",
		brief.recommendation
			? `Recommendation: ${brief.recommendation.option}${brief.recommendation.reason ? ` (${brief.recommendation.reason})` : ""}`
			: "",
	].filter((line) => line !== "");
	return [
		"A run of Night Shift waits for a person to answer a question in the inbox. Write the brief the person reads before they answer.",
		"Write plainly: short sentences, active voice, simple present. Address the person as you. Use only facts the question and the run show. Do not invent facts.",
		`The question:\n${input.question}`,
		options === "" ? "" : `The options:\n${options}`,
		known.length > 0 ? `What the flow already says:\n${known.join("\n")}` : "",
		input.digest === ""
			? "The run has no earlier steps."
			: `What the run did so far, oldest first:\n${input.digest}`,
		`Write only these parts:\n${input.missing.map((part) => `- ${PART_RULES[part]}`).join("\n")}`,
	]
		.filter((part) => part !== "")
		.join("\n\n");
}

/** The parts the model wrote, as parts a brief takes, and which it wrote. */
function modelParts(
	data: unknown,
	missing: readonly GateBriefPart[],
): { parts: BriefParts; wrote: GateBriefPart[] } {
	if (typeof data !== "object" || data === null)
		return { parts: {}, wrote: [] };
	const answer = data as Record<string, unknown>;
	const str = (value: unknown) =>
		typeof value === "string" && value.trim() !== "" ? value : undefined;
	const parts: BriefParts = {};
	const wrote: GateBriefPart[] = [];
	for (const part of missing) {
		const value = answer[part];
		switch (part) {
			case "urgency":
				if (typeof value === "string" && isGateUrgency(value)) {
					parts.urgency = value;
					wrote.push(part);
				}
				break;
			case "situation":
				if (str(value)) {
					parts.situation = str(value);
					wrote.push(part);
				}
				break;
			case "background":
				if (Array.isArray(value)) {
					parts.background = value.flatMap((item) => {
						const one = item as { text?: unknown; source?: unknown };
						const text = str(one?.text);
						return text === undefined
							? []
							: [{ text, source: str(one.source) ?? null }];
					});
					if (parts.background.length > 0) wrote.push(part);
				}
				break;
			case "recommendation": {
				const one = value as { option?: unknown; reason?: unknown } | null;
				const option = str(one?.option);
				if (option) {
					parts.recommend = { option, reason: str(one?.reason) ?? "" };
					wrote.push(part);
				}
				break;
			}
			case "impacts":
				if (typeof value === "object" && value !== null) {
					parts.impacts = Object.fromEntries(
						Object.entries(value).flatMap(([name, impact]) =>
							str(impact) ? [[name, str(impact)]] : [],
						),
					);
					if (Object.keys(parts.impacts).length > 0) wrote.push(part);
				}
				break;
		}
	}
	return { parts, wrote };
}

/** The brief with the model's parts in the empty places: the author's parts stay. */
function withModelParts(
	written: Omit<WrittenBrief, "cost">,
	parts: BriefParts,
	wrote: readonly GateBriefPart[],
	recommends: boolean,
): Omit<WrittenBrief, "cost"> {
	const model = briefOf(parts, written.choices, recommends);
	const { brief } = written;
	const byModel = wrote.filter((part) => {
		switch (part) {
			case "urgency":
				return model.brief.urgencyBy === "flow";
			case "recommendation":
				return model.brief.recommendation !== null;
			case "impacts":
				return model.choices.some(
					(choice, at) => choice.impact && !written.choices[at]?.impact,
				);
			default:
				return true;
		}
	});
	const has = (part: GateBriefPart) => byModel.includes(part);
	return {
		urgency: has("urgency") ? model.urgency : written.urgency,
		brief: {
			urgencyBy: has("urgency") ? "model" : brief.urgencyBy,
			situation: has("situation") ? model.brief.situation : brief.situation,
			background: has("background") ? model.brief.background : brief.background,
			recommendation: has("recommendation")
				? model.brief.recommendation
				: brief.recommendation,
			byModel,
		},
		choices: written.choices.map((choice, at) =>
			choice.impact || !has("impacts") ? choice : (model.choices[at] ?? choice),
		),
	};
}

/** How long the model may take. A Gate opens without its parts after that. */
export const BRIEF_MINUTES = 1;

/**
 * Asks the model for the missing parts within `BRIEF_MINUTES`. Null when
 * the Device has no decider that makes values, or the call failed or ran
 * out of time: the Gate opens without them.
 */
async function askModel(
	ctx: Pick<StepContext, "minuteMs">,
	step: Pick<StepHandle, "device" | "signal">,
	prompt: string,
	output: Record<string, unknown>,
): Promise<ValueResult | null> {
	const controller = new AbortController();
	const signal = AbortSignal.any([controller.signal, step.signal]);
	let timer: ReturnType<typeof setTimeout> | undefined;
	const late = new Promise<null>((resolve) => {
		timer = setTimeout(() => {
			controller.abort();
			resolve(null);
		}, BRIEF_MINUTES * ctx.minuteMs);
	});
	const ask = async (): Promise<ValueResult | null> => {
		const decider = (await step.device.capabilities()).decider;
		if (!decider?.values) return null;
		const maker = valueDecider({});
		return step.device.decide({
			decider: maker,
			prompt,
			output,
			model: decider.defaultModels[maker].value,
			signal,
		});
	};
	try {
		return await Promise.race([ask().catch(() => null), late]);
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Writes a Gate's brief as it opens: the author's parts rendered, what the
 * engine knows, then a model for the rest (`fillBrief` unset or true).
 * Never throws for the model: the Gate opens with what it has.
 */
export async function writeBrief(
	ctx: Pick<StepContext, "minuteMs">,
	step: Pick<StepHandle, "device" | "signal" | "tctx" | "runState" | "stepId">,
	gate: { question: string; choices: readonly GateChoice[]; spec: BriefSpec },
): Promise<WrittenBrief> {
	const { spec } = gate;
	const written = briefOf(
		renderedParts(spec, step.tctx),
		gate.choices,
		spec.recommends,
	);
	const missing = missingParts(written, spec.recommends);
	if (spec.fields.fillBrief === false || missing.length === 0) {
		return { ...written, cost: null };
	}
	const others = [...step.runState.steps.values()].filter(
		(one) => one.id !== step.stepId,
	);
	const prompt = briefPrompt({
		question: gate.question,
		choices: written.choices,
		written,
		missing,
		digest: runDigest(others),
	});
	const result = await askModel(
		ctx,
		step,
		prompt,
		briefSchema(missing, written.choices),
	);
	if (result === null) return { ...written, cost: null };
	const source = deciderCostSource(result);
	const cost = {
		costUsd: result.costUsd,
		...(source === undefined ? {} : { costSource: source }),
	};
	if (result.kind !== "made") return { ...written, cost };
	const { parts, wrote } = modelParts(result.data, missing);
	return {
		...withModelParts(written, parts, wrote, spec.recommends),
		cost,
	};
}

/** Whether a brief says anything: a Gate without one logs none (`GateOpened`). */
export function saysAnything(
	written: Pick<WrittenBrief, "brief" | "choices">,
): boolean {
	const { brief } = written;
	return (
		brief.urgencyBy !== "default" ||
		brief.situation !== null ||
		brief.background.length > 0 ||
		brief.recommendation !== null
	);
}
