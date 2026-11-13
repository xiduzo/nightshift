/**
 * PROTOTYPE, throw away. The pieces the settings variants share: the list
 * a slot opens, the state of a built-in agent, its detail, the lists of
 * what you connected, and the setup in four steps.
 */
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@nightshift/ui/components/dialog";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "@nightshift/ui/components/select";
import { Spinner } from "@nightshift/ui/components/spinner";
import { cn } from "@nightshift/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import {
	BotIcon,
	CircleAlertIcon,
	CircleCheckIcon,
	CircleDashedIcon,
	CpuIcon,
	PlusIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import {
	BUILTINS,
	type Builtin,
	type Engine,
	fits,
	SLOTS,
	type Slot,
	type SlotId,
	type Takes,
} from "./model";
import type { Proto } from "./use-proto";

const FOLLOW = "follow";

/** The list a slot or an agent opens: models and agents apart, what does not fit greyed with the reason. */
export function EngineSelect({
	proto,
	takes,
	value,
	follow,
	onPick,
	label,
	className,
}: {
	proto: Proto;
	takes: Takes;
	/** The engine that answers now. */
	value: Engine | null;
	/** The first row: follow something else, such as "The same as Helper". Picked when `following`. */
	follow?: { label: string; following: boolean };
	onPick: (id: string | null) => void;
	label: string;
	className?: string;
}) {
	const groups = [
		{ title: "Models", engines: proto.models },
		{ title: "Agents", engines: proto.agents },
	].filter((group) => group.engines.length > 0);
	const items = [
		...(follow ? [{ value: FOLLOW, label: follow.label }] : []),
		...proto.engines.map((engine) => ({
			value: engine.id,
			label: engine.name,
		})),
	];
	const current = follow?.following ? FOLLOW : (value?.id ?? null);

	if (proto.engines.length === 0) {
		return <span className="text-muted-foreground text-sm">Nothing yet</span>;
	}
	return (
		<Select
			items={items}
			value={current}
			onValueChange={(next) => {
				if (next === null) return;
				onPick(next === FOLLOW ? null : String(next));
			}}
		>
			<SelectTrigger aria-label={label} className={cn("w-56", className)}>
				<SelectValue placeholder="Choose" />
			</SelectTrigger>
			<SelectContent>
				{follow ? (
					<SelectGroup>
						<SelectItem value={FOLLOW}>{follow.label}</SelectItem>
					</SelectGroup>
				) : null}
				{groups.map((group) => (
					<SelectGroup key={group.title}>
						<SelectLabel>{group.title}</SelectLabel>
						{group.engines.map((engine) => {
							const fit = fits(takes, engine);
							return (
								<SelectItem
									key={engine.id}
									value={engine.id}
									disabled={!fit.ok}
								>
									<span className="flex flex-col">
										<span>{engine.name}</span>
										<span className="text-muted-foreground text-xs">
											{fit.ok ? engine.detail : fit.why}
										</span>
									</span>
								</SelectItem>
							);
						})}
					</SelectGroup>
				))}
			</SelectContent>
		</Select>
	);
}

/** The Select of one slot. */
export function SlotSelect({ proto, slot }: { proto: Proto; slot: Slot }) {
	return (
		<EngineSelect
			proto={proto}
			takes={slot.takes}
			value={proto.slotEngine(slot.id)}
			follow={
				slot.id === "quick"
					? { label: "The same as Helper", following: proto.quickFollows }
					: undefined
			}
			onPick={(id) => proto.pick(slot.id, id)}
			label={slot.title}
		/>
	);
}

/** Ready, or what is missing. */
export function StateBadge({
	proto,
	builtin,
}: {
	proto: Proto;
	builtin: Builtin;
}) {
	const state = proto.stateOf(builtin);
	return state.ready ? (
		<Badge variant="outline" className="gap-1.5">
			<CircleCheckIcon className="text-status-finished" />
			{state.engine.name}
		</Badge>
	) : (
		<Badge variant="outline" className="gap-1.5 text-status-waiting">
			<CircleAlertIcon />
			{state.text}
		</Badge>
	);
}

export function KindIcon({ kind }: { kind: Engine["kind"] }) {
	return kind === "agent" ? <BotIcon /> : <CpuIcon />;
}

/** One built-in agent: what it does in words, and its two settings. */
export function BuiltinDetail({
	proto,
	builtin,
}: {
	proto: Proto;
	builtin: Builtin;
}) {
	const slot = SLOTS.find((s) => s.id === builtin.slot);
	const state = proto.stateOf(builtin);
	const own = proto.overrideOf(builtin.id);
	const facts: [string, string][] = [
		["You start it with", builtin.startedBy],
		["Reads", builtin.reads],
		["Proposes", builtin.proposes],
		["Never", builtin.never],
	];
	return (
		<div className="flex flex-col gap-6">
			<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
				{facts.map(([term, text]) => (
					<div key={term} className="contents">
						<dt className="text-muted-foreground">{term}</dt>
						<dd>{text}</dd>
					</div>
				))}
			</dl>
			<ItemGroup className="gap-2">
				<Item variant="outline" size="sm">
					<ItemContent>
						<ItemTitle>Answers with</ItemTitle>
						<ItemDescription>
							{state.ready
								? `${slot?.takesLabel}. Now: ${state.engine.name}.`
								: `${slot?.takesLabel}. ${state.text}.`}
						</ItemDescription>
					</ItemContent>
					<ItemActions>
						<EngineSelect
							proto={proto}
							takes={builtin.takes}
							value={state.ready ? state.engine : null}
							follow={{
								label: `The ${slot?.title} choice`,
								following: !own,
							}}
							onPick={(id) => proto.override(builtin.id, id)}
							label="Answers with"
						/>
					</ItemActions>
				</Item>
				<Item variant="outline" size="sm">
					<ItemContent>
						<ItemTitle>Most it spends on one answer</ItemTitle>
					</ItemContent>
					<ItemActions>
						<span className="text-muted-foreground text-sm tabular-nums">
							{builtin.limit}
						</span>
					</ItemActions>
				</Item>
			</ItemGroup>
		</div>
	);
}

/** What you connected, in two lists: agents and models. */
export function EngineLists({ proto }: { proto: Proto }) {
	const list = (
		title: string,
		description: string,
		engines: Engine[],
		empty: string,
		add: ReactNode,
	) => (
		<section className="flex flex-col gap-3">
			<div className="flex items-end gap-4">
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<h3 className="font-medium">{title}</h3>
					<p className="text-muted-foreground text-sm">{description}</p>
				</div>
				{add}
			</div>
			{engines.length === 0 ? (
				<p className="text-muted-foreground text-sm">{empty}</p>
			) : (
				<ItemGroup className="gap-2">
					{engines.map((engine) => (
						<Item key={engine.id} variant="outline" size="sm">
							<ItemMedia variant="icon">
								<KindIcon kind={engine.kind} />
							</ItemMedia>
							<ItemContent>
								<ItemTitle className="font-mono">{engine.name}</ItemTitle>
								<ItemDescription>
									{engine.problem ?? `${engine.detail} · ${usesOf(engine)}`}
								</ItemDescription>
							</ItemContent>
							<ItemActions>
								{engine.ready ? (
									<Badge variant="outline">Ready</Badge>
								) : (
									<Button size="sm" variant="outline">
										Sign in
									</Button>
								)}
							</ItemActions>
						</Item>
					))}
				</ItemGroup>
			)}
		</section>
	);
	return (
		<div className="flex flex-col gap-8">
			{list(
				"Agents",
				"Programs that do work in steps. Install one and sign in.",
				proto.agents,
				"No agent yet.",
				<Button
					size="sm"
					variant="outline"
					onClick={() => proto.connect("agent")}
				>
					<PlusIcon data-icon="inline-start" />
					Connect an agent
				</Button>,
			)}
			{list(
				"Models",
				"Give one answer at a time. Used to decide and for short answers.",
				proto.models,
				"No model yet.",
				<Button
					size="sm"
					variant="outline"
					onClick={() => proto.connect("model")}
				>
					<PlusIcon data-icon="inline-start" />
					Add a model
				</Button>,
			)}
		</div>
	);
}

/** What an engine can be used for. */
function usesOf(engine: Engine): string {
	if (engine.kind === "model") return "For Quick and to decide";
	return engine.takesTools
		? "For steps, Helper and Quick"
		: "For steps and Quick. Not for Helper";
}

const STEPS = [
	"Connect an agent",
	"Decision model",
	"Check",
	"Add a project",
] as const;

/** The body of one setup step: the dialog and the path variant both show it. */
export function SetupStep({ proto, step }: { proto: Proto; step: number }) {
	if (step === 0) {
		const helper = proto.slotEngine("helper");
		return (
			<div className="flex flex-col gap-3">
				<p className="text-muted-foreground text-sm">
					An agent does the work of a step. The same agent builds and improves
					flows with you.
				</p>
				{proto.agents.length > 0 ? (
					<ItemGroup className="gap-2">
						{proto.agents.map((engine) => (
							<Item key={engine.id} variant="outline" size="sm">
								<ItemMedia variant="icon">
									<BotIcon />
								</ItemMedia>
								<ItemContent>
									<ItemTitle className="font-mono">{engine.name}</ItemTitle>
									<ItemDescription>
										{engine.problem ?? engine.detail}
									</ItemDescription>
								</ItemContent>
								<ItemActions>
									{helper?.id === engine.id ? (
										<Badge>Your Helper</Badge>
									) : fits("agent-with-tools", engine).ok ? (
										<Button
											size="sm"
											variant="ghost"
											onClick={() => proto.pick("helper", engine.id)}
										>
											Make it your Helper
										</Button>
									) : (
										<span className="text-muted-foreground text-xs">
											For steps and short answers
										</span>
									)}
								</ItemActions>
							</Item>
						))}
					</ItemGroup>
				) : null}
				<div>
					<Button
						size="sm"
						variant={proto.agents.length === 0 ? "default" : "outline"}
						onClick={() => proto.connect("agent")}
					>
						<PlusIcon data-icon="inline-start" />
						{proto.agents.length === 0
							? "Set up Claude Code"
							: "Connect another agent"}
					</Button>
				</div>
			</div>
		);
	}
	if (step === 1) {
		const decision = proto.slotEngine("decision");
		const row = (
			active: boolean,
			title: string,
			description: string,
			action: ReactNode,
		) => (
			<Item variant={active ? "muted" : "outline"} size="sm">
				<ItemMedia variant="icon">
					{active ? (
						<CircleCheckIcon className="text-status-finished" />
					) : (
						<CircleDashedIcon className="text-muted-foreground" />
					)}
				</ItemMedia>
				<ItemContent>
					<ItemTitle>{title}</ItemTitle>
					<ItemDescription>{description}</ItemDescription>
				</ItemContent>
				<ItemActions>{action}</ItemActions>
			</Item>
		);
		return (
			<div className="flex flex-col gap-3">
				<p className="text-muted-foreground text-sm">
					A flow can let a model pick the next step. The same model writes what
					a Gate asks you.
				</p>
				<ItemGroup className="gap-2">
					{proto.models.length > 0
						? row(
								decision !== null,
								decision?.name ?? "A model you connected",
								decision?.detail ?? "Choose one of your models.",
								<SlotSelect proto={proto} slot={SLOTS[2] as Slot} />,
							)
						: row(
								false,
								"A model on this computer",
								"Free and private. Night Shift downloads it (2 GB).",
								<Button
									size="sm"
									onClick={() => {
										proto.setDecisionLater(false);
										proto.connect("model");
									}}
								>
									Download
								</Button>,
							)}
					{row(
						false,
						"A provider with a key",
						"Faster. You pay the provider for each decision.",
						<Button size="sm" variant="outline">
							Add a key
						</Button>,
					)}
					{row(
						proto.decisionLater && decision === null,
						"Choose later",
						"Decisions by a model and Gate briefs stay off.",
						<Button
							size="sm"
							variant="ghost"
							onClick={() => proto.setDecisionLater(true)}
						>
							Later
						</Button>,
					)}
				</ItemGroup>
			</div>
		);
	}
	if (step === 2) {
		return (
			<div className="flex flex-col gap-3">
				<p className="text-muted-foreground text-sm">
					Each choice gets one small question.
				</p>
				<ItemGroup className="gap-2">
					{SLOTS.map((slot) => (
						<CheckRow key={slot.id} proto={proto} slot={slot} />
					))}
				</ItemGroup>
				<div>
					<Button size="sm" variant="outline" onClick={proto.runCheck}>
						Check again
					</Button>
				</div>
			</div>
		);
	}
	return (
		<div className="flex flex-col gap-3">
			<p className="text-muted-foreground text-sm">
				A project is a folder Night Shift works in: research notes, a site, a
				set of reports, code.
			</p>
			<div>
				<Button size="sm" nativeButton={false} render={<Link to="/" />}>
					<PlusIcon data-icon="inline-start" />
					Add a project
				</Button>
			</div>
		</div>
	);
}

function CheckRow({ proto, slot }: { proto: Proto; slot: Slot }) {
	const engine = proto.slotEngine(slot.id);
	const check = proto.checkOf(slot.id);
	return (
		<Item variant="outline" size="sm">
			<ItemContent>
				<ItemTitle>{slot.title}</ItemTitle>
				<ItemDescription>
					{engine === null
						? slot.takes === "model"
							? "No model yet. Decisions by a model stay off."
							: "No agent yet."
						: slot.id === "quick" && proto.quickFollows
							? `The same as Helper: ${engine.name}`
							: check === "failed"
								? (engine.problem ?? "It did not answer.")
								: engine.name}
				</ItemDescription>
			</ItemContent>
			<ItemActions>
				{engine === null ? (
					<Badge variant="outline" className="text-status-waiting">
						Not set
					</Badge>
				) : check === "running" ? (
					<Spinner />
				) : check === "ok" ? (
					<Badge variant="outline" className="gap-1.5">
						<CircleCheckIcon className="text-status-finished" />
						Answers
					</Badge>
				) : check === "failed" ? (
					<Badge variant="outline" className="text-status-failed">
						No answer
					</Badge>
				) : (
					<Badge variant="outline">Not checked</Badge>
				)}
			</ItemActions>
		</Item>
	);
}

/** Whether each setup step is done. */
export function stepsDone(proto: Proto): boolean[] {
	return [
		proto.slotEngine("helper") !== null,
		proto.slotEngine("decision") !== null || proto.decisionLater,
		(["helper", "quick", "decision"] as SlotId[]).every(
			(slot) => proto.slotEngine(slot) === null || proto.checkOf(slot) === "ok",
		) && proto.checkOf("helper") === "ok",
		false,
	];
}

export { STEPS };

/** The setup as a dialog of four steps. */
export function SetupWizard({
	proto,
	open,
	onOpenChange,
	start = 0,
}: {
	proto: Proto;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	start?: number;
}) {
	const [step, setStep] = useState(start);
	const [opened, setOpened] = useState(open);
	if (open !== opened) {
		setOpened(open);
		if (open) setStep(start);
	}
	const go = (next: number) => {
		setStep(next);
		if (next === 2) proto.runCheck();
	};
	const titles = [
		"Connect an agent",
		"Choose a model that decides",
		"Night Shift's agents answer",
		"Add your first project",
	];
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<ol className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs">
						{STEPS.map((name, index) => (
							<li
								key={name}
								aria-current={index === step ? "step" : undefined}
								className={cn(index === step && "font-medium text-foreground")}
							>
								{index < step ? "✓" : index + 1} {name}
							</li>
						))}
					</ol>
					<DialogTitle>{titles[step]}</DialogTitle>
					<DialogDescription className="sr-only">
						Step {step + 1} of {STEPS.length}
					</DialogDescription>
				</DialogHeader>
				<SetupStep proto={proto} step={step} />
				<DialogFooter>
					{step > 0 ? (
						<Button variant="ghost" onClick={() => go(step - 1)}>
							Back
						</Button>
					) : null}
					{step < STEPS.length - 1 ? (
						<Button
							disabled={step === 0 && proto.slotEngine("helper") === null}
							onClick={() => go(step + 1)}
						>
							Continue
						</Button>
					) : (
						<Button variant="outline" onClick={() => onOpenChange(false)}>
							Done
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** What a person can do now, by what they get and not by agent. */
export function Abilities({
	proto,
	onFix,
}: {
	proto: Proto;
	onFix: (step: number) => void;
}) {
	return (
		<ItemGroup className="grid gap-2 sm:grid-cols-2">
			{BUILTINS.map((builtin) => {
				const state = proto.stateOf(builtin);
				return (
					<Item key={builtin.id} variant="outline" size="sm">
						<ItemMedia variant="icon">
							{state.ready ? (
								<CircleCheckIcon className="text-status-finished" />
							) : (
								<CircleDashedIcon className="text-muted-foreground" />
							)}
						</ItemMedia>
						<ItemContent>
							<ItemTitle>{builtin.gives}</ItemTitle>
							<ItemDescription>
								{state.ready
									? `Answers with ${state.engine.name}`
									: state.fix === "model"
										? "Needs a model that decides"
										: state.fix === "agent"
											? "Needs an agent"
											: state.text}
							</ItemDescription>
						</ItemContent>
						{state.ready ? null : (
							<ItemActions>
								<Button
									size="sm"
									variant="outline"
									onClick={() => onFix(state.fix === "model" ? 1 : 0)}
								>
									Set up
								</Button>
							</ItemActions>
						)}
					</Item>
				);
			})}
		</ItemGroup>
	);
}
