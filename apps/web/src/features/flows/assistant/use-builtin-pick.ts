/**
 * Who answers one ask of one of Night Shift's own agents: its default from
 * Settings, or what the person picks in the box they type in. The pick
 * changes only who answers. The agent's prompt, tools and limits stay.
 */
import { type BuiltinAgentId, builtinAgent } from "@nightshift/flows";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { harnessInfo, useCustomAgents } from "@/features/agents";
import {
	answerOfModel,
	settingsQueries,
	shownAnswer,
	useModelOptions,
} from "@/features/settings";
import { answersLabel, useBuiltinAgent } from "@/shared/agent-button";
import type { AgentChoice } from "./agent-choice";
import type { AgentMenusProps } from "./agent-picker";
import {
	defaultRequest,
	overrideRequest,
	type PickedAnswer,
} from "./picked-answer";

/** What the person picked here. Null: the default answers. */
type Override = { agent: AgentChoice } | { model: string } | null;

/**
 * The menus of a Prompt Input that asks `id`, and the fields its request
 * sends. The menus start on the default. A pick holds until `reset`, or
 * until another agent answers here.
 */
export function useBuiltinPick(id: BuiltinAgentId): {
	menus: AgentMenusProps;
	request: PickedAnswer;
	reset: () => void;
} {
	const { takes } = builtinAgent(id);
	// A pick belongs to the agent it was made for: another agent starts on its default.
	const [picked, setPicked] = useState<{
		id: BuiltinAgentId;
		pick: Override;
	}>({ id, pick: null });
	const override = picked.id === id ? picked.pick : null;
	const setOverride = (pick: Override) => setPicked({ id, pick });
	const status = useBuiltinAgent(id);
	const settings = useQuery({
		...settingsQueries.get(),
		staleTime: 30_000,
		meta: { quietErrors: true },
	});
	const customAgents = useCustomAgents();
	const modelOptions = useModelOptions();
	const saved = settings.data?.values.builtinAgents[id];
	const fallback = shownAnswer(saved, status);
	const shown =
		override === null
			? fallback
			: "agent" in override
				? { agent: override.agent, model: undefined }
				: { agent: {}, model: override.model };
	const label = status?.answers
		? answersLabel(
				status.answers,
				(harness) => harnessInfo(harness, customAgents).label,
			)
		: "Not set";
	const defaultModel = (harness: NonNullable<AgentChoice["harness"]>) =>
		harnessInfo(harness, customAgents).defaultModel;

	return {
		menus: {
			// An agent that works in turns needs a harness that takes Night Shift's tools.
			purpose: takes === "agent-with-tools" ? "chat" : "suggest",
			choice: shown.agent,
			onChoiceChange: (agent) => setOverride({ agent }),
			agents: takes !== "model",
			...(takes === "either"
				? {
						models: {
							label: "Models",
							options: modelOptions,
							value: shown.model,
							// The menu clears the model before it sets an agent: the agent comes next.
							onPick: (value) => {
								if (value) setOverride({ model: value });
							},
						},
					}
				: {}),
			fallback: {
				agent: id,
				label,
				active: override === null,
				onPick: () => setOverride(null),
			},
		},
		request:
			override === null
				? defaultRequest(saved, status)
				: overrideRequest(
						"agent" in override
							? override
							: { model: answerOfModel(override.model) },
						defaultModel,
					),
		reset: () => setOverride(null),
	};
}
