import { describe, expect, test } from "bun:test";
import { harnessNameSchema } from "@nightshift/flows";

import { HARNESS_ADAPTERS, harnessViews } from "./registry";

describe("harnessViews", () => {
	test("lists every built-in harness, then the custom agents", () => {
		const views = harnessViews({
			added: ["codex"],
			customAgents: [
				{ slug: "kiro", label: "Kiro", command: "kiro-acp", args: [], env: {} },
			],
			bin: (name) => ({
				bin: `/bin/${name}`,
				setting: `${name}Bin`,
				source: "default",
			}),
			profilesOn: (name) => (name === "acp:kiro" ? ["night"] : []),
		});
		expect(views.map((v) => v.name)).toEqual([
			...harnessNameSchema.options,
			"acp:kiro",
		]);
		const codex = views.find((v) => v.name === "codex");
		expect(codex).toMatchObject({
			label: HARNESS_ADAPTERS.codex.label,
			added: true,
			bin: "/bin/codex",
			binSetting: "codexBin",
			binSource: "default",
			custom: null,
		});
		expect(views.find((v) => v.name === "opencode")?.added).toBe(false);
		expect(views.at(-1)).toEqual({
			name: "acp:kiro",
			label: "Kiro",
			initials: "KI",
			pkg: "@tanstack/ai-acp",
			note: "Model default: the model set in Kiro. You can type another model it offers.",
			offMachine: "Prompts and code go wherever Kiro sends them.",
			defaultModel: "default",
			models: ["default"],
			listing: null,
			added: true,
			bin: "kiro-acp",
			binSetting: null,
			binSource: null,
			profiles: ["night"],
			custom: {
				slug: "kiro",
				label: "Kiro",
				command: "kiro-acp",
				args: [],
				env: {},
			},
		});
	});
});
