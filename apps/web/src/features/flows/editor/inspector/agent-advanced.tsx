/** The advanced section of an Agent node. */
import { type AgentNode, withConnections } from "@nightshift/flows";
import { Badge } from "@nightshift/ui/components/badge";
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { cliToolQueries } from "@/features/agents";
import type { DaemonConnection } from "../connections-field";
import { InspectorSection, Note } from "../fields";
import { McpServersField } from "../mcp-servers-field";
import { OutputSchemaField } from "../output-schema-field";
import { NodeProgramsField, ToolsField } from "../tools-field";
import { useProfile } from "./agent-fields";

/** An Agent node's output data and tools. */
export function AgentAdvanced({
	node,
	connections,
	onChange,
}: {
	node: AgentNode;
	connections: readonly DaemonConnection[] | undefined;
	onChange: (change: (node: AgentNode) => AgentNode) => void;
}) {
	const { profile } = useProfile(node);
	const id = useId();
	const cliTools = useQuery({
		...cliToolQueries.list(),
		staleTime: 30_000,
		meta: { quietErrors: true },
	});
	const clis = node.clis ?? [];
	const named = node.connections ?? [];
	const nodeClis = node.nodeClis ?? [];
	const serverCount = Object.keys(node.mcpServers ?? {}).length;
	const missing = [
		...(cliTools.data
			? clis.filter((name) => !cliTools.data.some((t) => t.name === name))
			: []),
		...(connections
			? named.filter((name) => !connections.some((c) => c.name === name))
			: []),
	];
	const toolCount = clis.length + named.length + nodeClis.length + serverCount;
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
					clis={clis}
					connections={named}
					cliTools={cliTools.data}
					daemonConnections={connections}
					onChange={(next) =>
						onChange((current) => {
							const { clis: _, ...rest } = withConnections(
								current,
								next.connections,
							);
							return next.clis.length > 0 ? { ...rest, clis: next.clis } : rest;
						})
					}
				/>
				<NodeProgramsField
					id={`${id}-node-clis`}
					names={nodeClis}
					onChange={(names) =>
						onChange(({ nodeClis: _, ...rest }) =>
							names.length > 0 ? { ...rest, nodeClis: names } : rest,
						)
					}
				/>
				<McpServersField
					id={`${id}-mcp`}
					servers={node.mcpServers}
					onChange={(mcpServers) =>
						onChange(({ mcpServers: _, ...rest }) =>
							mcpServers === undefined ? rest : { ...rest, mcpServers },
						)
					}
				/>
			</InspectorSection>
		</>
	);
}
