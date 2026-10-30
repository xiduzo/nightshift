/** The advanced section of an Agent node. */
import { type AgentNode, withConnections } from "@nightshift/flows";
import { Badge } from "@nightshift/ui/components/badge";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { cliToolQueries } from "@/features/agents";
import type { DaemonConnection } from "../connections-field";
import { Field, InspectorSection, Note } from "../fields";
import { OutputSchemaField } from "../output-schema-field";
import { NodeProgramsField, ToolsField } from "../tools-field";
import { useProfile } from "./agent-fields";

/** The node with these CLI tools: no `clis` field when there are none. */
function withClis(node: AgentNode, clis: string[]): AgentNode {
	const { clis: _, ...rest } = node;
	return clis.length > 0 ? { ...rest, clis } : rest;
}

/** The node's knowledge choice, as the select shows it. */
type KnowledgeChoice = "auto" | "always" | "never";

const KNOWLEDGE_HINTS: Record<KnowledgeChoice, string> = {
	auto: "The agent reads the project's knowledge when there is some.",
	always:
		"The agent is told where the project's knowledge is, also when there is none yet.",
	never: "The agent works from the project and its task only.",
};

function knowledgeChoice(node: AgentNode): KnowledgeChoice {
	return node.knowledge === true
		? "always"
		: node.knowledge === false
			? "never"
			: "auto";
}

/** The node with this choice: no `knowledge` field for the default. */
function withKnowledge(node: AgentNode, choice: KnowledgeChoice): AgentNode {
	const { knowledge: _, ...rest } = node;
	return choice === "auto" ? rest : { ...rest, knowledge: choice === "always" };
}

/** An Agent node's output data, tools and knowledge. */
export function AgentAdvanced({
	projectId,
	node,
	connections,
	onChange,
}: {
	projectId: string;
	node: AgentNode;
	connections: readonly DaemonConnection[] | undefined;
	onChange: (change: (node: AgentNode) => AgentNode) => void;
}) {
	const { profile } = useProfile(projectId, node);
	const id = useId();
	const cliTools = useQuery({
		...cliToolQueries.list(),
		staleTime: 30_000,
		meta: { quietErrors: true },
	});
	const clis = node.clis ?? [];
	const named = node.connections ?? [];
	// One list in the file: the CLI tools added under Agents → Tools, and
	// other programs on this computer.
	const added = new Set(cliTools.data?.map((tool) => tool.name));
	const tools = clis.filter((name) => added.has(name));
	const programs = clis.filter((name) => !added.has(name));
	const missing = connections
		? named.filter((name) => !connections.some((c) => c.name === name))
		: [];
	const toolCount = clis.length + named.length;
	const fromProfile = profile ? [...profile.clis, ...profile.connections] : [];

	return (
		<>
			<InspectorSection
				title="Output"
				tab="results"
				defaultOpen={node.output !== undefined}
				aside={
					node.output !== undefined ? (
						<Badge variant="secondary">schema</Badge>
					) : null
				}
			>
				<OutputSchemaField
					id={`${id}-output`}
					nodeId={node.id}
					output={node.output}
					rootObject
					assist
					description="The data the agent reports, besides its outcome and a summary. The step fails when the data does not fit."
					onChange={(output) =>
						onChange(({ output: _, ...rest }) =>
							output === undefined ? rest : { ...rest, output },
						)
					}
				/>
			</InspectorSection>

			<InspectorSection
				title="Tools"
				tab="setup"
				defaultOpen={toolCount > 0}
				aside={
					missing.length > 0 ? (
						<Badge variant="destructive" className="tabular-nums">
							{missing.length} missing
						</Badge>
					) : toolCount > 0 ? (
						<Badge variant="secondary" className="tabular-nums">
							{toolCount}
						</Badge>
					) : null
				}
			>
				{fromProfile.length > 0 ? (
					<Note>
						The profile adds{" "}
						<span className="font-mono text-foreground">
							{fromProfile.join(", ")}
						</span>
						. Pick more here for this node only.
					</Note>
				) : null}
				<ToolsField
					id={`${id}-tools`}
					clis={tools}
					connections={named}
					cliTools={cliTools.data}
					daemonConnections={connections}
					onChange={(next) =>
						onChange((current) =>
							withClis(withConnections(current, next.connections), [
								...next.clis,
								...programs,
							]),
						)
					}
				/>
				{cliTools.data ? (
					<NodeProgramsField
						id={`${id}-programs`}
						names={programs}
						onChange={(names) =>
							onChange((current) => withClis(current, [...tools, ...names]))
						}
					/>
				) : null}
			</InspectorSection>

			<InspectorSection
				title="Knowledge"
				tab="setup"
				defaultOpen={node.knowledge !== undefined}
			>
				<Field
					id={`${id}-knowledge`}
					label="Project knowledge"
					hint={KNOWLEDGE_HINTS[knowledgeChoice(node)]}
				>
					<NativeSelect
						id={`${id}-knowledge`}
						value={knowledgeChoice(node)}
						aria-describedby={`${id}-knowledge-hint`}
						onChange={(event) => {
							const choice = event.target.value as KnowledgeChoice;
							onChange((current) => withKnowledge(current, choice));
						}}
					>
						<NativeSelectOption value="auto">
							When there is some
						</NativeSelectOption>
						<NativeSelectOption value="always">Always</NativeSelectOption>
						<NativeSelectOption value="never">Never</NativeSelectOption>
					</NativeSelect>
				</Field>
			</InspectorSection>
		</>
	);
}
