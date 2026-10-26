import type { AssistantAgent } from "@nightshift/flows";
import { useSyncExternalStore } from "react";

/**
 * Which agent answers the field helpers and the chat, as the person
 * picked it: the profile for help (nothing set), an Agent Profile with
 * overrides, or no profile and a harness and model. This browser keeps
 * it, and every suggestion and chat request sends it.
 */
export type AgentChoice = AssistantAgent;

const KEY = "nightshift.assistant.agent";
const NO_CHOICE: AgentChoice = {};

function store(): Storage | undefined {
	try {
		return window.localStorage;
	} catch {
		return undefined;
	}
}

/** The choice as `raw` holds it. Anything else: the profile for help. */
export function parseAgentChoice(raw: string | null | undefined): AgentChoice {
	if (!raw) return {};
	try {
		const value = JSON.parse(raw) as Record<string, unknown>;
		const choice: AgentChoice = {};
		for (const key of ["profile", "harness", "model", "effort"] as const) {
			const field = value?.[key];
			if (typeof field === "string" && field !== "")
				(choice as Record<string, string>)[key] = field;
		}
		return choice;
	} catch {
		return {};
	}
}

function read(): AgentChoice {
	try {
		return parseAgentChoice(store()?.getItem(KEY));
	} catch {
		return {};
	}
}

let current: AgentChoice | null = null;
const listeners = new Set<() => void>();

/** The choice now: also outside React, for a request sent from a callback. */
export function currentAgentChoice(): AgentChoice {
	current ??= read();
	return current;
}

export function setAgentChoice(choice: AgentChoice): void {
	current = choice;
	try {
		store()?.setItem(KEY, JSON.stringify(choice));
	} catch {
		// Without storage the choice lasts until the page reloads.
	}
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** The choice, shared by every picker on the page. */
export function useAgentChoice(): AgentChoice {
	return useSyncExternalStore(subscribe, currentAgentChoice, () => NO_CHOICE);
}

/**
 * The request's agent fields for a choice. Without a profile, a blank
 * model is the harness's default model (`defaultModel`), as its field
 * shows; a blank model on a profile is no override.
 */
export function requestAgent(
	choice: AgentChoice,
	defaultModel: (harness: NonNullable<AgentChoice["harness"]>) => string,
): AssistantAgent {
	const model = choice.model?.trim() || undefined;
	if (choice.profile !== undefined) {
		return {
			profile: choice.profile,
			...(choice.harness ? { harness: choice.harness } : {}),
			...(model ? { model } : {}),
			...(choice.effort ? { effort: choice.effort } : {}),
		};
	}
	if (choice.harness === undefined) return {};
	return {
		harness: choice.harness,
		model: model ?? defaultModel(choice.harness),
		...(choice.effort ? { effort: choice.effort } : {}),
	};
}
