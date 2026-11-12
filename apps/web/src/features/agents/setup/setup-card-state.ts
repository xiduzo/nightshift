/**
 * The Get started card on Home as it reads: one row for each thing a
 * first run needs (an agent, a decider, a project), whether it is done,
 * and what the row offers. Pure: the facts come from the profiles, the
 * projects and the two setup statuses. A status is `undefined` while it
 * loads and `null` when it did not load.
 */
import type { AgentSetupStatus, DeciderSetupStatus } from "@/shared/api";
import { readyText } from "./decider-state";
import { setupRuns, setupStep } from "./setup-state";

/** What a row offers. */
export type SetupCardAction =
	/** Opens the setup of an agent. `running`: a setup is busy, the button says so. */
	| { kind: "set-up"; running: "installing" | "signing-in" | null }
	/** Opens the setup on the choice of a decider. */
	| { kind: "choose" }
	| { kind: "add-project" }
	/** The setup cannot act here: the page where the person does it. */
	| { kind: "open"; page: "agents" | "settings" };

export type SetupCardRow = {
	done: boolean;
	text: string;
	action: SetupCardAction | null;
};

const AGENT_TEXT = "An agent does the work in your flows.";
const DECIDER_TEXT = "A decider makes the small choices in your flows.";

/** The agent row: done when this computer has an Agent Profile. */
export function agentRow(
	profiles: readonly { name: string }[],
	setup: AgentSetupStatus | null | undefined,
): SetupCardRow {
	const [first] = profiles;
	if (first) {
		return {
			done: true,
			text:
				profiles.length === 1
					? `Agent nodes can use the profile ${first.name}.`
					: `Agent nodes can use ${profiles.length} profiles.`,
			action: null,
		};
	}
	if (setup === undefined) {
		return { done: false, text: AGENT_TEXT, action: null };
	}
	if (setup?.available && setup.agents.length > 0) {
		const busy = setup.agents.find((agent) => setupRuns(agent.job));
		const names = setup.agents.map((agent) => agent.label).join(" or ");
		return {
			done: false,
			text: `${AGENT_TEXT} Night Shift installs ${names} and helps you sign in.`,
			action: {
				kind: "set-up",
				running: !busy
					? null
					: setupStep(busy).kind === "installing"
						? "installing"
						: "signing-in",
			},
		};
	}
	return {
		done: false,
		text: `${AGENT_TEXT} ${setup?.message ?? "Add one on the Agents page."}`,
		action: { kind: "open", page: "agents" },
	};
}

/** The decider row: done when the person chose the decider of new Decision nodes. */
export function deciderRow(
	status: DeciderSetupStatus | null | undefined,
): SetupCardRow {
	if (status === undefined) {
		return { done: false, text: DECIDER_TEXT, action: null };
	}
	if (status?.current.chosen) {
		return {
			done: true,
			text: readyText(status.current.decider),
			action: null,
		};
	}
	if (status?.available) {
		return { done: false, text: DECIDER_TEXT, action: { kind: "choose" } };
	}
	return {
		done: false,
		text: `${DECIDER_TEXT} ${status?.message ?? "Choose one in Settings."}`,
		action: { kind: "open", page: "settings" },
	};
}

/** The project row: done when there is a project. */
export function projectRow(
	projects: readonly { name: string }[] | undefined,
): SetupCardRow {
	const [first] = projects ?? [];
	if (first && projects) {
		return {
			done: true,
			text:
				projects.length === 1
					? `You have the project ${first.name}.`
					: `You have ${projects.length} projects.`,
			action: null,
		};
	}
	return {
		done: false,
		text: "A project holds your flows and their runs. It needs no folder.",
		action: projects ? { kind: "add-project" } : null,
	};
}

/** The line under the title: what is left, or what to do next. */
export function setupCardLine(agentDone: boolean, projectDone: boolean) {
	return agentDone && projectDone
		? "You are ready. Open a project and start a run."
		: "Set up an agent and add a project. Then start your first run.";
}

/** Where this browser remembers "Later" until the tab closes. */
const LATER_KEY = "nightshift.get-started.later";

/** The person chose Later in this session. A store that throws counts as no. */
export function laterChosen(store: Pick<Storage, "getItem"> | undefined) {
	try {
		return store?.getItem(LATER_KEY) === "1";
	} catch {
		return false;
	}
}

/** Remembers Later for this session, when the store lets it. */
export function chooseLater(store: Pick<Storage, "setItem"> | undefined) {
	try {
		store?.setItem(LATER_KEY, "1");
	} catch {
		// Private mode or blocked storage: the card shows again on the next visit.
	}
}
