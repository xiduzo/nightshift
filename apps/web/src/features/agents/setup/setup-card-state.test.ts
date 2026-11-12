import { describe, expect, test } from "bun:test";
import type {
	AgentSetupJob,
	AgentSetupStatus,
	AgentSetupView,
	DeciderSetupStatus,
} from "@/shared/api";
import {
	agentRow,
	chooseLater,
	deciderRow,
	laterChosen,
	projectRow,
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
			text: "An agent does the work in your flows. Add one on the Agents page.",
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
			text: "A decider makes the small choices in your flows.",
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
			text: "A decider makes the small choices in your flows. Choose the decider in Settings.",
			action: { kind: "open", page: "settings" },
		});
		expect(deciderRow(null).action).toEqual({
			kind: "open",
			page: "settings",
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
		"Set up an agent and add a project. Then start your first run.",
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
