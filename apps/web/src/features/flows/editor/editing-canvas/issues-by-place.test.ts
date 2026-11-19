import { describe, expect, test } from "bun:test";
import type { FlowIssue } from "@nightshift/flows";
import { issuesByPlace } from "./issues-by-place";

const issue = (fields: Omit<FlowIssue, "message">): FlowIssue => ({
	message: "An issue",
	...fields,
});

describe("the issues of a check by place", () => {
	test("groups the issues of each node and of each Section, in order", () => {
		const first = issue({ severity: "error", nodeId: "a" });
		const second = issue({ severity: "warning", nodeId: "a" });
		const other = issue({ severity: "warning", nodeId: "b" });
		const framed = issue({ severity: "warning", sectionId: "s1" });
		const { byNode, bySection } = issuesByPlace({
			issues: [first, other, second, framed],
			validatorError: null,
		});
		expect([...byNode]).toEqual([
			["a", [first, second]],
			["b", [other]],
		]);
		expect([...bySection]).toEqual([["s1", [framed]]]);
	});

	test("an issue on a node in a Section counts for both", () => {
		const both = issue({ severity: "error", nodeId: "a", sectionId: "s1" });
		const { byNode, bySection } = issuesByPlace({
			issues: [both],
			validatorError: null,
		});
		expect(byNode.get("a")).toEqual([both]);
		expect(bySection.get("s1")).toEqual([both]);
	});

	test("marks only the edges that have an error", () => {
		const { edgeErrors } = issuesByPlace({
			issues: [
				issue({ severity: "error", edgeId: "a-b" }),
				issue({ severity: "warning", edgeId: "b-c" }),
				issue({ severity: "error", edgeId: "a-b" }),
			],
			validatorError: null,
		});
		expect([...edgeErrors]).toEqual(["a-b"]);
	});

	test("a check without issues has empty places", () => {
		const places = issuesByPlace({ issues: [], validatorError: null });
		expect(places.byNode.size).toBe(0);
		expect(places.bySection.size).toBe(0);
		expect(places.edgeErrors.size).toBe(0);
	});
});
