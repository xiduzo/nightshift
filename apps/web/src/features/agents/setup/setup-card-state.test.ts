import { describe, expect, test } from "bun:test";
import type {
	AgentSetupJob,
	AgentSetupStatus,
	AgentSetupView,
	DeciderSetupStatus,
} from "@/shared/api";
import {
	agentRow,
	checkRow,
	chooseLater,
	deciderRow,
	laterChosen,
	projectRow,
	requiredStepOpen,
	setupCardLine,
} from "./setup-card-state";

const agent = (
	harness: AgentSetupView["harness"],
	label: string,
	job: AgentSetupJob = { state: "idle" },
): AgentSetupView => ({
	harness,
	label,
	vendor: "Vendor",
	path: null,
	install: { command: "install", source: "https://example.com/install.sh" },
	signIn: { command: "sign in" },
	job,
});

const setup = (fields: Partial<AgentSetupStatus> = {}): AgentSetupStatus => ({
	available: true,
	reason: null,
	message: null,
	agents: [agent("claude-code", "Claude Code"), agent("codex", "Codex")],
	...fields,
});

const decider = (
	fields: Partial<DeciderSetupStatus> = {},
): DeciderSetupStatus => ({
	available: true,
	reason: null,
	message: null,
	current: { decider: "ollama", chosen: false },
	local: {
		model: "llama3.2:latest",
		bytes: 2e9,
		where: null,
		installed: false,
		answers: false,
		hasModel: false,
		install: null,
	},
	typesafe: { keySaved: false, keyPage: "https://typesafe.ai" },
	job: { state: "idle" },
	...fields,
});

describe("the agent row", () => {
	test("a profile makes it done", () => {
		expect(agentRow([{ name: "claude" }], setup())).toEqual({
			done: true,
			text: "Agent nodes can use the profile claude.",
			action: null,
		});
		expect(agentRow([{ name: "a" }, { name: "b" }], undefined).text).toBe(
			"Agent nodes can use 2 profiles.",
		);
	});

	test("without a profile it offers the setup, with the agents it installs", () => {
		expect(agentRow([], setup())).toEqual({
			done: false,
			text: "An agent does the work in your flows. Night Shift installs Claude Code or Codex and helps you sign in.",
			action: { kind: "set-up", running: null },
		});
	});

	test("a setup that runs shows on the button", () => {
		const installing = setup({
			agents: [
				agent("claude-code", "Claude Code", { state: "installing", since: 1 }),
			],
		});
		expect(agentRow([], installing).action).toEqual({
			kind: "set-up",
			running: "installing",
		});
		const signingIn = setup({
			agents: [
				agent("codex", "Codex", {
					state: "signing-in",
					url: null,
					since: 1,
				}),
			],
		});
		expect(agentRow([], signingIn).action).toEqual({
			kind: "set-up",
			running: "signing-in",
		});
	});

	test("while the setup loads, the row offers nothing yet", () => {
		expect(agentRow([], undefined).action).toBeNull();
	});

	test("where the setup cannot act, it says why and links to the Agents page", () => {
		const elsewhere = setup({
			available: false,
			reason: "elsewhere",
			message: "Open Night Shift on that computer to set up an agent there.",
		});
		expect(agentRow([], elsewhere)).toEqual({
			done: false,
			text: "An agent does the work in your flows. Open Night Shift on that computer to set up an agent there.",
			action: { kind: "open", page: "agents" },
		});
		expect(agentRow([], null)).toEqual({
			done: false,
			text: "An agent does the work in your flows. Add one in Settings.",
			action: { kind: "open", page: "agents" },
		});
	});
});

describe("the decider row", () => {
	test("a chosen decider makes it done", () => {
		expect(
			deciderRow(decider({ current: { decider: "typesafe", chosen: true } })),
		).toEqual({
			done: true,
			text: "New Decision nodes use TypeSafe Jev.",
			action: null,
		});
	});

	test("an unchosen decider offers the choice", () => {
		expect(deciderRow(decider())).toEqual({
			done: false,
			text: "A flow can let a model pick the next step.",
			action: { kind: "choose" },
		});
		expect(deciderRow(undefined).action).toBeNull();
	});

	test("where the setup cannot act, it links to Settings", () => {
		const container = decider({
			available: false,
			reason: "container",
			message: "Choose the decider in Settings.",
		});
		expect(deciderRow(container)).toEqual({
			done: false,
			text: "A flow can let a model pick the next step. Choose the decider in Settings.",
			action: { kind: "open", page: "settings" },
		});
		expect(deciderRow(null).action).toEqual({
			kind: "open",
			page: "settings",
		});
	});
});

describe("the check row", () => {
	const summary = (failed: number, checked = true) => ({
		checked,
		failed,
		total: 3,
	});

	test("without an agent it waits for one", () => {
		expect(checkRow(false, summary(0, false))).toEqual({
			done: false,
			text: "Night Shift asks each of its agents one small question. Connect an agent first.",
			action: null,
		});
	});

	test("while this computer has not said who answers, it offers nothing", () => {
		expect(checkRow(true, null).action).toBeNull();
		expect(
			checkRow(true, { checked: false, failed: 0, total: 0 }).action,
		).toBeNull();
	});

	test("not checked yet: it offers the check", () => {
		expect(checkRow(true, summary(0, false))).toEqual({
			done: false,
			text: "Night Shift asks each of its agents one small question.",
			action: { kind: "check", again: false },
		});
	});

	test("every agent answered: done", () => {
		expect(checkRow(true, summary(0))).toEqual({
			done: true,
			text: "Night Shift's agents answer.",
			action: null,
		});
	});

	test("a problem: the row says how many, and opens the check again", () => {
		expect(checkRow(true, summary(1))).toEqual({
			done: false,
			text: "One check found a problem. Open the check to fix it.",
			action: { kind: "check", again: true },
		});
		expect(checkRow(true, summary(2)).text).toBe(
			"2 checks found a problem. Open the check to fix them.",
		);
		// A problem shows before every question has its result.
		expect(checkRow(true, summary(1, false)).action).toEqual({
			kind: "check",
			again: true,
		});
	});
});

describe("the project row", () => {
	test("a project makes it done", () => {
		expect(projectRow([{ name: "research" }])).toEqual({
			done: true,
			text: "You have the project research.",
			action: null,
		});
		expect(projectRow([{ name: "a" }, { name: "b" }]).text).toBe(
			"You have 2 projects.",
		);
	});

	test("without one it offers Add project, and says a folder is not needed", () => {
		expect(projectRow([])).toEqual({
			done: false,
			text: "A project holds your flows and their runs. It needs no folder.",
			action: { kind: "add-project" },
		});
		expect(projectRow(undefined).action).toBeNull();
	});
});

test("the line under the title says what is next", () => {
	expect(setupCardLine(false, true)).toBe(
		"Connect an agent and add a project. Then start your first run.",
	);
	expect(setupCardLine(true, true)).toBe(
		"You are ready. Open a project and start a run.",
	);
});

describe("Later", () => {
	const memory = () => {
		const values = new Map<string, string>();
		return {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => void values.set(key, value),
		};
	};

	test("the store remembers it", () => {
		const store = memory();
		expect(laterChosen(store)).toBe(false);
		chooseLater(store);
		expect(laterChosen(store)).toBe(true);
	});

	test("a missing or failing store counts as not chosen, and never throws", () => {
		const failing = {
			getItem: () => {
				throw new Error("blocked");
			},
			setItem: () => {
				throw new Error("blocked");
			},
		};
		expect(laterChosen(undefined)).toBe(false);
		expect(laterChosen(failing)).toBe(false);
		expect(() => chooseLater(failing)).not.toThrow();
		expect(() => chooseLater(undefined)).not.toThrow();
	});
});

describe("requiredStepOpen", () => {
	test("no Agent Profile: the card shows", () => {
		expect(requiredStepOpen([], [{ name: "site" }])).toBe(true);
	});

	test("an Agent Profile and no project: the card shows", () => {
		expect(requiredStepOpen([{ name: "worker" }], [])).toBe(true);
	});

	test("an Agent Profile and a project: the optional steps do not show it", () => {
		expect(requiredStepOpen([{ name: "worker" }], [{ name: "site" }])).toBe(
			false,
		);
	});

	test("a list that loads still, or did not load: the card waits", () => {
		expect(requiredStepOpen(undefined, [])).toBe(false);
		expect(requiredStepOpen([], undefined)).toBe(false);
	});
});
