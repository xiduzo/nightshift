import { KNOWLEDGE_TOOLS_INSTRUCTION, knowledgeTools } from "../tools";

/**
 * The knowledge tools of an Agent step over a fake index: one file,
 * `wiki/deploy.md`, found by any word. For the harness tests: each
 * harness must hand them to its agent, or leave them out with their word.
 */
export function fakeKnowledgeTools() {
	return {
		tools: knowledgeTools(
			{
				searchKnowledge: async () => [
					{
						path: "wiki/deploy.md",
						title: "Deploy",
						snippet: [
							{ text: "We ", match: false },
							{ text: "deploy", match: true },
							{ text: " at night.", match: false },
						],
					},
				],
				readKnowledge: async () => null,
			},
			{ project: { id: "p1" } },
		),
		toolsInstruction: KNOWLEDGE_TOOLS_INSTRUCTION,
	};
}
