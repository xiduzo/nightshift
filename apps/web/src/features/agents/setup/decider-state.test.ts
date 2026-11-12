import { describe, expect, test } from "bun:test";
import type { DeciderSetupJob, DeciderSetupStatus } from "@/shared/api";
import {
	aboutSize,
	choiceOf,
	deciderRuns,
	deciderStep,
	downloadLine,
	justChosen,
	localAction,
	localSummary,
	offerDecider,
	readyText,
} from "./decider-state";

const status = (
	fields: {
		local?: Partial<DeciderSetupStatus["local"]>;
		current?: DeciderSetupStatus["current"];
	} = {},
	job: DeciderSetupJob = { state: "idle" },
): DeciderSetupStatus => ({
	available: true,
	reason: null,
	message: null,
	current: fields.current ?? { decider: "ollama", chosen: false },
	local: {
		model: "llama3.2:latest",
		bytes: 2_000_000_000,
		where: null,
		installed: true,
		answers: true,
		hasModel: false,
		install: null,
		...fields.local,
	},
	typesafe: { keySaved: false, keyPage: "https://typesafe.ai" },
	job,
});

describe("the step of a decider setup", () => {
	test("nothing runs: the choice, with how the last try ended", () => {
		expect(deciderStep({ state: "idle" })).toEqual({
			kind: "choose",
			note: null,
		});
		expect(
			deciderStep({
				state: "ready",
				decider: "ollama",
				profileId: "p-1",
				profileName: "local",
				at: 1,
			}),
		).toEqual({
			kind: "choose",
			note: {
				tone: "done",
				text: "New Decision nodes use Ollama on this computer.",
			},
		});
		expect(
			deciderStep({
				state: "install-failed",
				problem: "Night Shift could not install Ollama.",
				output: "Error: no bottle\n",
				at: 1,
			}),
		).toEqual({
			kind: "choose",
			note: {
				tone: "problem",
				text: "Night Shift could not install Ollama.",
				output: "Error: no bottle\n",
			},
		});
		expect(
			deciderStep({ state: "failed", problem: "It stopped.", at: 1 }),
		).toMatchObject({ note: { tone: "problem", output: null } });
	});

	test("a job that runs shows its progress", () => {
		expect(deciderStep({ state: "installing", since: 5 })).toEqual({
			kind: "installing",
			since: 5,
		});
		expect(deciderStep({ state: "starting", since: 5 })).toEqual({
			kind: "starting",
		});
		expect(
			deciderStep({ state: "downloading", percent: 40, since: 5 }),
		).toEqual({ kind: "downloading", percent: 40 });
		expect(deciderRuns({ state: "downloading", percent: 1, since: 1 })).toBe(
			true,
		);
		expect(deciderRuns({ state: "cancelled", at: 1 })).toBe(false);
	});

	test("a decider counts as just chosen only after the screen saw its job run", () => {
		const ready: DeciderSetupJob = {
			state: "ready",
			decider: "ollama",
			profileId: "p-1",
			profileName: "local",
			at: 2,
		};
		expect(justChosen(undefined, ready)).toBeNull();
		expect(justChosen({ state: "idle" }, ready)).toBeNull();
		expect(
			justChosen({ state: "downloading", percent: 99, since: 1 }, ready),
		).toBe(ready);
	});
});

describe("the words of the choices", () => {
	test("the size of the download shows before it starts", () => {
		expect(aboutSize(2_000_000_000)).toBe("about 2 GB");
		expect(aboutSize(639_000_000)).toBe("about 639 MB");
		expect(localSummary(status())).toBe(
			"Private. No account. Downloads a model of about 2 GB.",
		);
		expect(localSummary(status({ local: { hasModel: true } }))).toBe(
			"Private. No account. The model is on this computer.",
		);
		expect(downloadLine(40.4, 2_000_000_000)).toBe("40% of about 2 GB");
	});

	test("the step follows an agent only while no decider was chosen, here", () => {
		expect(offerDecider(undefined)).toBe(false);
		expect(offerDecider(status())).toBe(true);
		expect(
			offerDecider(status({ current: { decider: "ollama", chosen: true } })),
		).toBe(false);
		expect(offerDecider({ ...status(), available: false })).toBe(false);
	});

	test("the step opens on the decider new nodes use now", () => {
		expect(choiceOf(status())).toBe("local");
		expect(
			choiceOf(status({ current: { decider: "typesafe", chosen: false } })),
		).toBe("typesafe");
		expect(readyText("typesafe")).toBe("New Decision nodes use TypeSafe Jev.");
	});

	test("Local installs Ollama with Homebrew, sends to its page, or uses it", () => {
		expect(localAction(status())).toEqual({ kind: "use" });
		expect(
			localAction(
				status({
					local: {
						install: { kind: "brew", command: "brew install ollama" },
					},
				}),
			),
		).toEqual({ kind: "install", command: "brew install ollama" });
		expect(
			localAction(
				status({
					local: {
						install: {
							kind: "download",
							url: "https://ollama.com/download/mac",
						},
					},
				}),
			),
		).toEqual({ kind: "download", url: "https://ollama.com/download/mac" });
	});
});
