/**
 * Night Shift's own agents: six agents with a fixed job. The product owns
 * the prompt and the tools of each. The person chooses only what answers
 * for it: one of their agents (an Agent Profile, or a harness and a model)
 * or one of their models (a Model Profile, or a decider).
 *
 * Four work for the person on Night Shift itself (Builder, Improver,
 * Explainer, Field writer). Two work inside a run (Decider, Brief writer).
 * The profiles that do the work of a step are not here: those are the
 * person's own agents.
 */
import { z } from "zod";

import {
	type AgentHarnessName,
	agentNodeSchema,
	canMakeValue,
	type DeciderName,
	deciderNameSchema,
	type ModelAddress,
	nameSchema,
} from "../nodes";
import { isAgentProfile, type Profile } from "../profiles";

export const builtinAgentIds = [
	"builder",
	"improver",
	"explainer",
	"field-writer",
	"decider",
	"brief-writer",
] as const;
export const builtinAgentIdSchema = z.enum(builtinAgentIds);
export type BuiltinAgentId = z.infer<typeof builtinAgentIdSchema>;

/**
 * What can answer for a built-in agent. An agent works in turns and can
 * take tools. A model gives one answer.
 */
export type BuiltinTakes = "agent-with-tools" | "either" | "model";

const agentFields = agentNodeSchema.shape;

/**
 * Who answers for one built-in agent. An agent is picked as an Agent node
 * picks its agent: a profile with overrides on top, or a harness and a
 * model. A model is a Model Profile, or a decider with its model (unset:
 * the decider's default).
 */
export const builtinAnswerSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("agent"),
		profile: nameSchema.optional(),
		harness: agentFields.harness,
		model: agentFields.model,
		effort: agentFields.effort,
	}),
	z.object({
		kind: z.literal("model"),
		/** A Model Profile of this computer, by its name. */
		profile: nameSchema.optional(),
		decider: deciderNameSchema.optional(),
		model: z.string().trim().min(1).max(200).optional(),
	}),
]);
export type BuiltinAnswer = z.infer<typeof builtinAnswerSchema>;

export type BuiltinAgent = {
	id: BuiltinAgentId;
	/** Its name in the product. */
	name: string;
	/** What it does, in one line. */
	job: string;
	/** Where the person starts it. */
	startedBy: string;
	reads: string;
	proposes: string;
	never: string;
	takes: BuiltinTakes;
	/**
	 * The most one answer may use. A session of an agent stops at these. A
	 * model gives one answer and has neither.
	 */
	limits: { turns?: number; usd?: number };
};

/** The six agents, in the order the Settings page lists them. */
export const BUILTIN_AGENTS: readonly BuiltinAgent[] = [
	{
		id: "builder",
		name: "Builder",
		job: "Makes a flow from a sentence.",
		startedBy: '"Build with an agent" in the flow editor and on a new flow.',
		reads: "The flow you edit, the other flows and the files of one project.",
		proposes: "A new version of the flow. You apply it.",
		never: "Reads a secret, opens another project, starts a run.",
		takes: "agent-with-tools",
		limits: { turns: 40, usd: 2 },
	},
	{
		id: "improver",
		name: "Improver",
		job: "Finds what to change in a flow.",
		startedBy: '"Improve this flow" on a run, on Spend and on a project page.',
		reads: "The flows, runs, costs and changes of one project.",
		proposes: "A new version of the flow. You apply it.",
		never: "Reads a secret, opens another project, starts a run.",
		takes: "agent-with-tools",
		limits: { turns: 40, usd: 2 },
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
		limits: { turns: 15, usd: 0.5 },
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
		limits: { turns: 15, usd: 0.5 },
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
		limits: {},
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
		limits: {},
	},
];

export function builtinAgent(id: BuiltinAgentId): BuiltinAgent {
	return BUILTIN_AGENTS.find((agent) => agent.id === id) as BuiltinAgent;
}

/** Why `answer` cannot answer for the agent `id`, or null. The kind only: the daemon checks the rest. */
export function builtinAnswerProblem(
	id: BuiltinAgentId,
	answer: BuiltinAnswer,
): string | null {
	const { name, takes } = builtinAgent(id);
	if (takes === "model" && answer.kind === "agent") {
		return `The ${name} gives one answer at a time. Choose a model for it, not an agent.`;
	}
	if (takes === "agent-with-tools" && answer.kind === "model") {
		return `The ${name} works in turns with Night Shift's tools. Choose an agent for it, not a model.`;
	}
	if (answer.kind === "agent") {
		const complete =
			answer.profile !== undefined ||
			(answer.harness !== undefined && answer.model !== undefined);
		return complete ? null : "Choose a profile, or a harness and a model.";
	}
	return answer.profile !== undefined || answer.decider !== undefined
		? null
		: "Choose a model profile, or a model.";
}

/**
 * Who answers for each built-in agent on one computer. An agent with no
 * entry follows the computer: the first of your agents that works, or the
 * decider of this computer.
 */
export const builtinAnswersSchema = z
	.object(
		Object.fromEntries(
			builtinAgentIds.map((id) => [id, builtinAnswerSchema.optional()]),
		) as Record<BuiltinAgentId, z.ZodOptional<typeof builtinAnswerSchema>>,
	)
	.strict()
	.superRefine((answers, ctx) => {
		for (const id of builtinAgentIds) {
			const answer = answers[id];
			if (!answer) continue;
			const problem = builtinAnswerProblem(id, answer);
			if (problem)
				ctx.addIssue({ code: "custom", message: problem, path: [id] });
		}
	});
export type BuiltinAnswers = z.infer<typeof builtinAnswersSchema>;

/**
 * The places in the product that start a built-in agent. A button names
 * its entry, and the entry names the agent: no button starts an agent that
 * is not one of the six.
 */
export const agentEntryIds = [
	"run.why",
	"run.improve",
	"spend.saving",
	"flow.improve",
	"flow.build",
	"field.suggest",
] as const;
export const agentEntryIdSchema = z.enum(agentEntryIds);
export type AgentEntryId = z.infer<typeof agentEntryIdSchema>;

export type AgentEntry = {
	agent: BuiltinAgentId;
	/** The words on its button. */
	label: string;
};

export const AGENT_ENTRIES: Record<AgentEntryId, AgentEntry> = {
	"run.why": { agent: "explainer", label: "Ask why" },
	"run.improve": { agent: "improver", label: "Improve this flow" },
	"spend.saving": { agent: "improver", label: "Improve this flow" },
	"flow.improve": { agent: "improver", label: "Improve this flow" },
	"flow.build": { agent: "builder", label: "Build with an agent" },
	"field.suggest": { agent: "field-writer", label: "Suggest" },
};

/** The decider, model and address that answer: a model as a run asks it. */
export type ModelPick = {
	decider: DeciderName;
	/** Unset: the decider's default model. */
	model?: string;
	address?: ModelAddress;
};

/**
 * The model that `answer` names on this computer, or why there is none: a
 * Model Profile by its name, or a decider with its model. `values`: the
 * model must make a value (text in a shape), not only pick an option.
 */
export function builtinModel(
	answer: Extract<BuiltinAnswer, { kind: "model" }>,
	profiles: readonly Profile[],
	needs: { values: boolean },
): ModelPick | { problem: string } {
	let pick: ModelPick;
	if (answer.profile !== undefined) {
		const profile = profiles.find((item) => item.name === answer.profile);
		if (!profile || isAgentProfile(profile)) {
			return {
				problem: `There is no model profile "${answer.profile}" on this computer. Choose another model in Settings.`,
			};
		}
		pick = {
			decider: profile.decider,
			...(profile.model !== undefined ? { model: profile.model } : {}),
			...(profile.address !== undefined ? { address: profile.address } : {}),
		};
	} else if (answer.decider !== undefined) {
		pick = {
			decider: answer.decider,
			...(answer.model !== undefined ? { model: answer.model } : {}),
		};
	} else {
		return { problem: "Choose a model profile, or a model." };
	}
	if (needs.values && !canMakeValue(pick.decider)) {
		return {
			problem:
				"This model only picks an option. It cannot write an answer. Choose another model in Settings.",
		};
	}
	return pick;
}

/** A way to save that a chat starts from: its kind, and the label of the step that cost most. */
export const entrySavingSchema = z.object({
	kind: z.enum(["unfinished", "nothing", "costly"]),
	step: z.string().trim().min(1).max(200).optional(),
});
export type EntrySaving = z.infer<typeof entrySavingSchema>;

/**
 * The first message of a chat that an entry starts: what the person asks,
 * in their words. The page and the agent both read it from here. Null: the
 * entry has none, and the person writes the first message.
 */
export function entryOpening(
	entry: AgentEntryId,
	context: { saving?: EntrySaving } = {},
): string | null {
	switch (entry) {
		case "run.improve":
			return "Why did this run not finish? Propose a change to the flow that fixes it.";
		case "spend.saving": {
			const saving = context.saving;
			if (!saving) return null;
			if (saving.kind === "unfinished") {
				return "This run did not finish, so its cost bought nothing. Find why, and propose a change to the flow so runs like it finish.";
			}
			if (saving.kind === "nothing") {
				return "This run found nothing to do, and it still cost money. Propose a check that ends the flow before the agents start when there is no work.";
			}
			const step = saving.step
				? ` Most of the extra cost was in the step ${saving.step}.`
				: "";
			return `This run cost over twice a usual run of this flow.${step} Find what made it cost more, and propose a change to the flow that keeps the cost near a usual run.`;
		}
		default:
			return null;
	}
}

/**
 * Who answers for one built-in agent on a computer right now: what the
 * person chose, or what the computer falls back to. `problem`: why nothing
 * can answer, in words for the person.
 */
export type BuiltinStatus = {
	id: BuiltinAgentId;
	/** The person chose it in Settings. False: the computer's own choice. */
	chosen: boolean;
	answers:
		| {
				kind: "agent";
				/** The Agent Profile, by its name. Null: a harness and a model. */
				profile: string | null;
				harness: AgentHarnessName;
				model: string;
				effort?: string;
		  }
		| {
				kind: "model";
				/** The Model Profile, by its name, when one answers. */
				profile?: string;
				decider: DeciderName;
				/** Unset: the decider's default model. */
				model?: string;
		  }
		| null;
	problem: string | null;
};

/**
 * What the check of one built-in agent found: it asked what answers for
 * the agent one small question. `ok`: it answered, in `ms` milliseconds.
 * Else `problem` says what happened and what to do, in words for the
 * person. `answers`: what was asked, or null when nothing could be.
 */
export type BuiltinCheck = {
	id: BuiltinAgentId;
	ok: boolean;
	/** How long the check took, in milliseconds. */
	ms: number;
	answers: BuiltinStatus["answers"];
	problem: string | null;
};
