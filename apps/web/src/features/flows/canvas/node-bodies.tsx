/** The body of a node card on the canvas, one view per node type. */
import {
	type AgentNode,
	type CallEachNode,
	type CallNode,
	type DecisionNode,
	isCustomHarness,
	type ListSource,
	type ToolNode,
	type ValueNode,
	type WaitNode,
	type WaitUntil,
} from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import { cn } from "@nightshift/ui/lib/utils";
import {
	AlarmClockIcon,
	BracesIcon,
	FilesIcon,
	GitBranchIcon,
	HourglassIcon,
	PlugIcon,
	RadioIcon,
	SquareTerminalIcon,
	WorkflowIcon,
} from "lucide-react";
import { useContext } from "react";
import { harnessInfo } from "@/features/agents";
import {
	agentSummary,
	firstLine,
	sourceSummary,
	valueSummary,
	WAIT_KINDS,
	waitSummary,
} from "../flow-draft";
import { OpenFlowContext } from "./open-flow-context";

/** A small mark with the CLI tools the node may run. */
function CliTools({ tools }: { tools: readonly string[] }) {
	if (tools.length === 0) return null;
	return (
		<>
			{" · "}
			<span
				className="inline-flex items-center gap-0.5 align-bottom font-mono text-foreground/80"
				title={`CLI tools: ${tools.join(", ")}`}
			>
				<SquareTerminalIcon className="size-3" aria-hidden="true" />
				{tools.join(", ")}
			</span>
		</>
	);
}

/**
 * What the node sets itself: its harness (unless the default Claude Code
 * without a profile), model and effort. A profile's own values show on the
 * Agents page, not here.
 */
function agentParts(node: AgentNode): string[] {
	const parts: string[] = [];
	if (
		node.harness !== undefined &&
		(node.harness !== "claude-code" || node.profile !== undefined)
	) {
		parts.push(
			isCustomHarness(node.harness)
				? node.harness
				: harnessInfo(node.harness).label,
		);
	}
	if (node.model !== undefined) parts.push(node.model);
	if (node.effort !== undefined) parts.push(node.effort);
	return parts;
}

export function AgentBody({ node }: { node: AgentNode }) {
	const summary = agentSummary(node);
	return (
		<>
			<span className="truncate text-[11px] text-muted-foreground">
				{node.profile !== undefined ? (
					<span className="font-mono text-foreground/80">{node.profile}</span>
				) : null}
				{agentParts(node)
					.map((part, i) =>
						i === 0 && node.profile === undefined ? part : ` · ${part}`,
					)
					.join("")}
				{node.session === "resume" ? " · resumes session" : ""}
				{node.output ? " · data schema" : ""}
				<CliTools tools={node.clis ?? []} />
			</span>
			<p
				className={cn(
					"line-clamp-2 break-words",
					node.skill && "font-mono text-[11px]",
					summary === "" && "text-muted-foreground italic",
				)}
			>
				{summary === "" ? "No prompt yet" : summary}
			</p>
		</>
	);
}

/** Who decides, then the prompt: the question for you, the brief for a model, a note for a rule. */
export function DecisionBody({ node }: { node: DecisionNode }) {
	const summary = firstLine(node.prompt);
	const who =
		node.by === "person"
			? "You decide"
			: node.by === "rule"
				? "A rule decides"
				: `A model decides${node.model ? ` · ${node.model}` : ""}`;
	const empty =
		node.by === "person"
			? "No question yet"
			: node.by === "rule"
				? "No note"
				: "No prompt yet";
	return (
		<>
			<span className="truncate text-[11px] text-muted-foreground">{who}</span>
			<p
				className={cn(
					"line-clamp-2 break-words",
					summary === "" && "text-muted-foreground italic",
				)}
			>
				{summary === "" ? empty : summary}
			</p>
		</>
	);
}

/** The called flow's name: a link in the editor, plain text elsewhere. */
function CalledFlowName({ name, prefix }: { name: string; prefix: string }) {
	const openFlow = useContext(OpenFlowContext);
	return (
		<span className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
			<WorkflowIcon className="size-3 shrink-0" aria-hidden="true" />
			<span className="shrink-0">{prefix}</span>
			{name === "" ? (
				<span className="italic">no flow picked yet</span>
			) : openFlow ? (
				<Button
					variant="link"
					size="xs"
					className="nodrag nopan h-auto min-w-0 justify-start truncate px-0 font-mono text-[11px] text-foreground underline decoration-foreground/30 hover:decoration-foreground"
					title={`Open the flow ${name}`}
					onClick={(event) => {
						event.stopPropagation();
						openFlow(name);
					}}
				>
					<span className="truncate">{name}</span>
				</Button>
			) : (
				<span className="min-w-0 truncate font-mono text-foreground">
					{name}
				</span>
			)}
		</span>
	);
}

/** The inputs bound by templates, one per line: `epic ← {{epic}}`. */
function Bindings({ bindings }: { bindings: Record<string, string> }) {
	const entries = Object.entries(bindings);
	if (entries.length === 0) return null;
	return (
		<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-1.5 gap-y-0.5 rounded-md bg-muted px-2 py-1 font-mono text-[11px]">
			{entries.slice(0, 4).map(([name, value]) => (
				<div key={name} className="contents">
					<dt className="text-muted-foreground">{name} ←</dt>
					<dd className="truncate" title={value}>
						{value}
					</dd>
				</div>
			))}
			{entries.length > 4 ? (
				<dd className="col-span-2 text-muted-foreground">
					+{entries.length - 4} more
				</dd>
			) : null}
		</dl>
	);
}

/** A Call that runs once: which flow it calls, and the inputs it binds. */
export function CallBody({ node }: { node: CallNode }) {
	return (
		<>
			<CalledFlowName name={node.flow} prefix="Runs" />
			<Bindings bindings={node.inputs} />
		</>
	);
}

const SOURCE_ICON: Record<ListSource["kind"], typeof BracesIcon> = {
	json: BracesIcon,
	command: SquareTerminalIcon,
	files: FilesIcon,
};

const SOURCE_EMPTY: Record<ListSource["kind"], string> = {
	json: "No list yet",
	command: "No source command yet",
	files: "No file pattern yet",
};

/** A Call that runs once per item: where the items come from, which flow runs per item, and on which branch. */
export function EachBody({ node }: { node: CallEachNode }) {
	const { each } = node;
	const summary = sourceSummary(each.source);
	const SourceIcon = SOURCE_ICON[each.source.kind];
	return (
		<>
			<p
				className="flex min-w-0 items-center gap-1.5 rounded-md bg-muted px-2 py-1 font-mono text-[11px]"
				title={summary}
			>
				<SourceIcon
					className="size-3 shrink-0 text-muted-foreground"
					aria-label={`From ${each.source.kind}`}
				/>
				{summary === "" ? (
					<span className="font-sans text-muted-foreground italic">
						{SOURCE_EMPTY[each.source.kind]}
					</span>
				) : (
					<span className="truncate">
						{each.source.kind === "command" ? (
							<span className="text-muted-foreground" aria-hidden="true">
								${" "}
							</span>
						) : null}
						{summary}
					</span>
				)}
			</p>
			<CalledFlowName name={node.flow} prefix="Each runs" />
			<span className="truncate font-mono text-[11px] text-muted-foreground">
				as {each.as}
				{Object.keys(node.inputs).length > 0
					? ` · binds ${Object.keys(node.inputs).join(", ")}`
					: ""}
			</span>
			<span className="flex min-w-0 items-center gap-1 truncate text-[11px] text-muted-foreground">
				<GitBranchIcon className="size-3 shrink-0" aria-hidden="true" />
				{each.branch === "per-item" ? "Branch per item" : "One shared branch"}
				{each.maxItems ? ` · max ${each.maxItems}` : ""}
			</span>
		</>
	);
}

/** Who makes the value, then the expression or the prompt. */
export function ValueBody({ node }: { node: ValueNode }) {
	const summary = valueSummary(node);
	const who =
		node.by === "rule"
			? "A rule makes it"
			: `A model makes it${node.model ? ` · ${node.model}` : ""}`;
	const empty = node.by === "rule" ? "No expression yet" : "No prompt yet";
	return (
		<>
			<span className="truncate text-[11px] text-muted-foreground">{who}</span>
			<p
				className={cn(
					"line-clamp-2 break-words",
					node.by === "rule" && summary !== "" && "font-mono text-[11px]",
					summary === "" && "text-muted-foreground italic",
				)}
			>
				{summary === "" ? empty : summary}
			</p>
		</>
	);
}

const WAIT_ICON: Record<WaitUntil["kind"], typeof HourglassIcon> = {
	duration: HourglassIcon,
	time: AlarmClockIcon,
	command: SquareTerminalIcon,
	signal: RadioIcon,
};

const WAIT_EMPTY: Record<WaitUntil["kind"], string> = {
	duration: "No duration yet",
	time: "No time yet",
	command: "No command yet",
	signal: "No signal name yet",
};

/** What the node waits for, and how long it may: a duration, a time, a command, or a signal. */
export function WaitBody({ node }: { node: WaitNode }) {
	const { until } = node;
	const summary = waitSummary(until);
	const Icon = WAIT_ICON[until.kind];
	const mono = until.kind !== "duration";
	return (
		<>
			<span className="truncate text-[11px] text-muted-foreground">
				Waits for {WAIT_KINDS[until.kind].toLowerCase()}
				{until.kind === "command" ? ` · every ${until.everyMinutes} min` : ""}
				{node.timeoutMinutes ? ` · up to ${node.timeoutMinutes} min` : ""}
			</span>
			<p
				className={cn(
					"flex min-w-0 items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-[11px]",
					mono && "font-mono",
				)}
				title={summary}
			>
				<Icon
					className="size-3 shrink-0 text-muted-foreground"
					aria-hidden="true"
				/>
				{summary === "" ? (
					<span className="font-sans text-muted-foreground italic">
						{WAIT_EMPTY[until.kind]}
					</span>
				) : (
					<span className="truncate">
						{until.kind === "command" ? (
							<span className="text-muted-foreground" aria-hidden="true">
								${" "}
							</span>
						) : null}
						{summary}
					</span>
				)}
			</p>
		</>
	);
}

/** Which connection it calls, which tool, and how many arguments it fills. */
export function ToolBody({ node }: { node: ToolNode }) {
	const count = Object.keys(node.arguments).length;
	return (
		<>
			<span className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
				<PlugIcon className="size-3 shrink-0" aria-hidden="true" />
				{node.connection === "" ? (
					<span className="italic">no connection picked yet</span>
				) : (
					<span className="min-w-0 truncate font-mono text-foreground">
						{node.connection}
					</span>
				)}
			</span>
			<p
				className={cn(
					"truncate rounded-md bg-muted px-2 py-1 font-mono text-[11px]",
					node.tool === "" && "font-sans text-muted-foreground italic",
				)}
				title={node.tool}
			>
				{node.tool === "" ? "No tool picked yet" : node.tool}
			</p>
			{count > 0 ? (
				<span className="truncate text-[11px] text-muted-foreground tabular-nums">
					{count} {count === 1 ? "argument" : "arguments"}:{" "}
					<span className="font-mono">
						{Object.keys(node.arguments).join(", ")}
					</span>
				</span>
			) : null}
		</>
	);
}
