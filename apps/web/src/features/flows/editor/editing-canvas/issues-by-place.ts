// The issues of a check by where they show on the canvas: on a node, on a
// Section's frame or box, and on an edge (errors only).

import type { FlowCheck, FlowIssue } from "@nightshift/flows";

/** The issues of `check` by node and by Section, and the edges that have an error. */
export function issuesByPlace(check: FlowCheck) {
	const byNode = new Map<string, FlowIssue[]>();
	const bySection = new Map<string, FlowIssue[]>();
	const edgeErrors = new Set<string>();
	for (const issue of check.issues) {
		if (issue.nodeId) {
			const issues = byNode.get(issue.nodeId) ?? [];
			issues.push(issue);
			byNode.set(issue.nodeId, issues);
		}
		if (issue.sectionId) {
			const issues = bySection.get(issue.sectionId) ?? [];
			issues.push(issue);
			bySection.set(issue.sectionId, issues);
		}
		if (issue.edgeId && issue.severity === "error")
			edgeErrors.add(issue.edgeId);
	}
	return { byNode, bySection, edgeErrors };
}
