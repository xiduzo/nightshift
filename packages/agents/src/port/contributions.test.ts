import { describe, expect, test } from "bun:test";
import { foldContributions } from "./contributions";
import type { BridgedTool } from "./types";

const tool = (name: string) => ({ name }) as BridgedTool;

describe("foldContributions", () => {
	test("nothing added: the prompt alone, and no empty fields", () => {
		expect(foldContributions({ prompt: "Go" }, [])).toEqual({ prompt: "Go" });
		expect(foldContributions({ prompt: "Go" }, [{}, {}])).toEqual({
			prompt: "Go",
		});
	});

	test("lists and texts keep the order of the contributions", () => {
		const one = tool("one");
		const two = tool("two");
		expect(
			foldContributions({ prompt: "Go" }, [
				{
					addDirs: ["/a"],
					afterPrompt: "After a.",
					instructions: "Line a.",
					tools: [one],
					toolsInstruction: "Use one.",
				},
				{
					addDirs: ["/b"],
					afterPrompt: "After b.",
					instructions: "Line b.",
					tools: [two],
					toolsInstruction: "Use two.",
				},
			]),
		).toEqual({
			prompt: "Go\n\nAfter a.\n\nAfter b.",
			addDirs: ["/a", "/b"],
			instructions: "Line a.\n\nLine b.",
			tools: [one, two],
			toolsInstruction: "Use one.\n\nUse two.",
		});
	});

	test("a later env value wins", () => {
		expect(
			foldContributions({ prompt: "Go" }, [
				{ env: { A: "1", B: "1" } },
				{ env: { B: "2" } },
			]).env,
		).toEqual({ A: "1", B: "2" });
	});

	test("a report gets the fields, and a session without one stays without one", () => {
		const report = { report: { learnings: true } };
		expect(
			foldContributions({ prompt: "Go", stepReport: true }, [report])
				.stepReport,
		).toEqual({ learnings: true });
		expect(
			foldContributions({ prompt: "Go", stepReport: { outcome: false } }, [
				report,
			]).stepReport,
		).toEqual({ outcome: false, learnings: true });
		expect(
			foldContributions({ prompt: "Go", stepReport: true }, [{}]).stepReport,
		).toBe(true);
		expect(foldContributions({ prompt: "Go" }, [report])).toEqual({
			prompt: "Go",
		});
	});
});
