/**
 * PROTOTYPE, throw away. Three other shapes of the Agents page, switched
 * with `?variant=` on `/agents`. A is the page as it is today.
 *
 * - B Overview: one page like Settings and Flows. Sections of cards and
 *   rows; a pick opens its detail as a page of its own, with a way back.
 * - C Tabs: Profiles, Harnesses, Tools, Secrets as tabs with tables; a pick
 *   opens in a sheet over the list.
 * - D Lanes: Home-style lanes of equal height, one per kind; a pick opens
 *   in a dialog.
 *
 * In every variant the programs found on this computer sit in the list
 * they belong to (agent CLIs under Harnesses, tools under Tools), not in a
 * card of their own on top.
 */
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
import {
	Dialog,
	DialogContent,
	DialogTitle,
} from "@nightshift/ui/components/dialog";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { ScrollArea } from "@nightshift/ui/components/scroll-area";
import {
	Sheet,
	SheetContent,
	SheetTitle,
} from "@nightshift/ui/components/sheet";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nightshift/ui/components/table";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@nightshift/ui/components/tabs";
import {
	ArrowLeftIcon,
	ChevronRightIcon,
	KeyRoundIcon,
	PlusIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { PageHeading, PageSection } from "@/shared/page";
import { CliToolCheckBadge } from "../cli-tool";
import { CliCheckBadge } from "../connections/cli-panel";
import { harnessInfo } from "../harnesses";
import {
	CliToolItem,
	ConnectionItem,
	HarnessItem,
	ProfileCard,
	type PrototypeProps,
	usedInLabel,
	useFoundPrograms,
} from "./parts";

export const AGENTS_VARIANTS = [
	{ key: "A", name: "Today: list on the right" },
	{ key: "B", name: "Overview, detail as a page" },
	{ key: "C", name: "Tabs and tables, detail in a sheet" },
	{ key: "D", name: "Lanes, detail in a dialog" },
] as const;

const DESCRIPTION =
	"Profiles give Agent nodes a harness, a model and tools under one name. Change one here and every flow that uses it follows.";

function SecretsItem({
	props,
	onOpen,
}: {
	props: PrototypeProps;
	onOpen: () => void;
}) {
	return (
		<Item
			variant="outline"
			size="sm"
			render={<button type="button" onClick={onOpen} />}
			className="text-left"
		>
			<ItemContent>
				<ItemTitle>
					<KeyRoundIcon className="size-4" />
					Secrets
				</ItemTitle>
				<ItemDescription>The keys your tools read.</ItemDescription>
			</ItemContent>
			<ItemActions>
				{props.missingSecrets > 0 ? (
					<Badge variant="outline" className="text-status-waiting">
						{props.missingSecrets} missing
					</Badge>
				) : (
					<Badge variant="secondary">{props.secrets.length}</Badge>
				)}
				<ChevronRightIcon className="size-4 text-muted-foreground" />
			</ItemActions>
		</Item>
	);
}

// ---------------------------------------------------------------- B

export function VariantOverview(props: PrototypeProps) {
	const { selection, select } = props;
	const found = useFoundPrograms(select);

	if (selection) {
		return (
			<div className="flex flex-col">
				<div className="mx-auto w-full max-w-6xl px-4 pt-6 md:px-8">
					<Button variant="ghost" size="sm" onClick={() => select(null)}>
						<ArrowLeftIcon data-icon="inline-start" />
						All agents
					</Button>
				</div>
				{props.detail}
			</div>
		);
	}

	return (
		<div className="mx-auto flex w-full max-w-5xl flex-col gap-10 p-4 md:p-8">
			<PageHeading
				title="Agents"
				description={DESCRIPTION}
				actions={
					<Button onClick={() => select({ kind: "new-profile" })}>
						<PlusIcon data-icon="inline-start" />
						Add profile
					</Button>
				}
			/>

			<PageSection title="Profiles" description="For Agent nodes.">
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{props.agentProfiles.map((p) => (
						<ProfileCard
							key={p.id}
							profile={p}
							onOpen={() => select({ kind: "profile", id: p.id })}
						/>
					))}
				</div>
			</PageSection>

			<PageSection
				title="Model profiles"
				description="For Decision and Value nodes that a model decides."
				actions={
					<Button
						size="sm"
						variant="outline"
						onClick={() => select({ kind: "new-model-profile" })}
					>
						<PlusIcon data-icon="inline-start" />
						Add model profile
					</Button>
				}
			>
				{props.modelProfiles.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						No model profiles yet. Decisions use the default model.
					</p>
				) : (
					<ItemGroup className="gap-2">
						{props.modelProfiles.map((p) => (
							<Item
								key={p.id}
								variant="outline"
								size="sm"
								render={
									<button
										type="button"
										onClick={() => select({ kind: "profile", id: p.id })}
									/>
								}
							>
								<ItemContent>
									<ItemTitle className="font-mono">{p.name}</ItemTitle>
									<ItemDescription>
										{props.deciderLabel(p.decider)} ·{" "}
										{p.model ?? "default model"}
									</ItemDescription>
								</ItemContent>
								<ItemActions className="text-muted-foreground text-xs">
									{usedInLabel(p.usedBy)}
								</ItemActions>
							</Item>
						))}
					</ItemGroup>
				)}
			</PageSection>

			<div className="grid gap-10 lg:grid-cols-2">
				<PageSection
					title="Harnesses"
					description="The coding agents a profile runs on."
					actions={
						<Button size="sm" variant="outline" onClick={props.onAddHarness}>
							<PlusIcon data-icon="inline-start" />
							Add
						</Button>
					}
				>
					<ItemGroup className="gap-2">
						{props.harnesses.map((h) => (
							<HarnessItem
								key={h.name}
								harness={h}
								onOpen={() => select({ kind: "harness", name: h.name })}
							/>
						))}
						{found.agents.map(found.row)}
					</ItemGroup>
				</PageSection>

				<PageSection
					title="Tools"
					description="What a profile hands to its agent."
					actions={
						<Button size="sm" variant="outline" onClick={props.onAddTool}>
							<PlusIcon data-icon="inline-start" />
							Add
						</Button>
					}
				>
					<ItemGroup className="gap-2">
						{props.cliTools.map((t) => (
							<CliToolItem
								key={t.name}
								tool={t}
								onOpen={() => select({ kind: "cli", name: t.name })}
							/>
						))}
						{props.connections.map((c) => (
							<ConnectionItem
								key={c.name}
								connection={c}
								onOpen={() => select({ kind: "tool", name: c.name })}
							/>
						))}
						{found.tools.map(found.row)}
						<SecretsItem
							props={props}
							onOpen={() => select({ kind: "secrets" })}
						/>
					</ItemGroup>
				</PageSection>
			</div>

			{props.otherDevices.length > 0 ? (
				<PageSection
					title="On your other devices"
					description="Their profiles and secrets. You change them on that device."
				>
					<ItemGroup className="gap-2">
						{props.otherDevices.map((d) => (
							<Item
								key={d.id}
								variant="outline"
								size="sm"
								render={
									<button
										type="button"
										onClick={() => select({ kind: "device", id: d.id })}
									/>
								}
							>
								<ItemContent>
									<ItemTitle>{d.name}</ItemTitle>
									<ItemDescription>
										{d.profiles.length} profiles · {d.secrets.length} secrets
									</ItemDescription>
								</ItemContent>
								<ItemActions>
									<ChevronRightIcon className="size-4 text-muted-foreground" />
								</ItemActions>
							</Item>
						))}
					</ItemGroup>
				</PageSection>
			) : null}
		</div>
	);
}

// ---------------------------------------------------------------- C

type Tab = "profiles" | "harnesses" | "tools" | "secrets";

const tabOf = (kind: string | undefined): Tab =>
	kind === "harness"
		? "harnesses"
		: kind === "cli" || kind === "tool"
			? "tools"
			: kind === "secrets" || kind === "device"
				? "secrets"
				: "profiles";

export function VariantTabs(props: PrototypeProps) {
	const { selection, select } = props;
	const found = useFoundPrograms(select);
	const [tab, setTab] = useState<Tab>(tabOf(selection?.kind));
	const problems = found.agents.length + found.tools.length;

	return (
		<div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-8">
			<PageHeading
				title="Agents"
				description={DESCRIPTION}
				actions={
					<Button onClick={() => select({ kind: "new-profile" })}>
						<PlusIcon data-icon="inline-start" />
						Add profile
					</Button>
				}
			/>
			<Tabs value={tab} onValueChange={(next) => setTab(next as Tab)}>
				<TabsList>
					<TabsTrigger value="profiles">
						Profiles
						<Badge variant="secondary">
							{props.agentProfiles.length + props.modelProfiles.length}
						</Badge>
					</TabsTrigger>
					<TabsTrigger value="harnesses">
						Harnesses
						<Badge variant="secondary">{props.harnesses.length}</Badge>
					</TabsTrigger>
					<TabsTrigger value="tools">
						Tools
						<Badge variant="secondary">
							{props.cliTools.length + props.connections.length}
						</Badge>
					</TabsTrigger>
					<TabsTrigger value="secrets">
						Secrets
						{props.missingSecrets > 0 ? (
							<Badge variant="outline" className="text-status-waiting">
								{props.missingSecrets} missing
							</Badge>
						) : null}
					</TabsTrigger>
				</TabsList>

				<TabsContent value="profiles" className="pt-4">
					<Card className="py-0">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead className="pl-4">Name</TableHead>
									<TableHead>Runs on</TableHead>
									<TableHead>Model</TableHead>
									<TableHead>Tools</TableHead>
									<TableHead className="pr-4 text-right">Used</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{props.agentProfiles.map((p) => (
									<TableRow
										key={p.id}
										className="cursor-pointer"
										onClick={() => select({ kind: "profile", id: p.id })}
									>
										<TableCell className="pl-4 font-mono">{p.name}</TableCell>
										<TableCell>{harnessInfo(p.harness).label}</TableCell>
										<TableCell>
											{p.model}
											{p.effort ? (
												<span className="text-muted-foreground">
													{" "}
													· {p.effort}
												</span>
											) : null}
										</TableCell>
										<TableCell className="tabular-nums">
											{p.clis.length + p.connections.length}
										</TableCell>
										<TableCell className="pr-4 text-right text-muted-foreground">
											{usedInLabel(p.usedBy)}
										</TableCell>
									</TableRow>
								))}
								{props.modelProfiles.map((p) => (
									<TableRow
										key={p.id}
										className="cursor-pointer"
										onClick={() => select({ kind: "profile", id: p.id })}
									>
										<TableCell className="pl-4 font-mono">
											{p.name} <Badge variant="outline">Model profile</Badge>
										</TableCell>
										<TableCell>{props.deciderLabel(p.decider)}</TableCell>
										<TableCell>{p.model ?? "default model"}</TableCell>
										<TableCell>—</TableCell>
										<TableCell className="pr-4 text-right text-muted-foreground">
											{usedInLabel(p.usedBy)}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</Card>
					<div className="pt-3">
						<Button
							size="sm"
							variant="ghost"
							onClick={() => select({ kind: "new-model-profile" })}
						>
							<PlusIcon data-icon="inline-start" />
							Add model profile
						</Button>
					</div>
				</TabsContent>

				<TabsContent value="harnesses" className="pt-4">
					<Card className="py-0">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead className="pl-4">Harness</TableHead>
									<TableHead>Profiles</TableHead>
									<TableHead className="pr-4 text-right">Status</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{props.harnesses.map((h) => (
									<TableRow
										key={h.name}
										className="cursor-pointer"
										onClick={() => select({ kind: "harness", name: h.name })}
									>
										<TableCell className="pl-4">{h.label}</TableCell>
										<TableCell className="text-muted-foreground">
											{
												props.agentProfiles.filter((p) => p.harness === h.name)
													.length
											}
										</TableCell>
										<TableCell className="pr-4 text-right">
											<CliCheckBadge target={h.name} />
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</Card>
					{found.agents.length > 0 ? (
						<ItemGroup className="gap-2 pt-4">
							{found.agents.map(found.row)}
						</ItemGroup>
					) : null}
					<div className="pt-3">
						<Button size="sm" variant="ghost" onClick={props.onAddHarness}>
							<PlusIcon data-icon="inline-start" />
							Add harness
						</Button>
					</div>
				</TabsContent>

				<TabsContent value="tools" className="pt-4">
					<Card className="py-0">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead className="pl-4">Tool</TableHead>
									<TableHead>Kind</TableHead>
									<TableHead>Profiles</TableHead>
									<TableHead className="pr-4 text-right">Status</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{props.cliTools.map((t) => (
									<TableRow
										key={t.name}
										className="cursor-pointer"
										onClick={() => select({ kind: "cli", name: t.name })}
									>
										<TableCell className="pl-4 font-mono">{t.name}</TableCell>
										<TableCell>CLI</TableCell>
										<TableCell className="text-muted-foreground">
											{
												props.agentProfiles.filter((p) =>
													p.clis.includes(t.name),
												).length
											}
										</TableCell>
										<TableCell className="pr-4 text-right">
											<CliToolCheckBadge name={t.name} />
										</TableCell>
									</TableRow>
								))}
								{props.connections.map((c) => (
									<TableRow
										key={c.name}
										className="cursor-pointer"
										onClick={() => select({ kind: "tool", name: c.name })}
									>
										<TableCell className="pl-4 font-mono">{c.name}</TableCell>
										<TableCell>MCP server</TableCell>
										<TableCell className="text-muted-foreground">
											{
												props.agentProfiles.filter((p) =>
													p.connections.includes(c.name),
												).length
											}
										</TableCell>
										<TableCell className="pr-4 text-right" />
									</TableRow>
								))}
							</TableBody>
						</Table>
					</Card>
					{found.tools.length > 0 ? (
						<ItemGroup className="gap-2 pt-4">
							{found.tools.map(found.row)}
						</ItemGroup>
					) : null}
					<div className="pt-3">
						<Button size="sm" variant="ghost" onClick={props.onAddTool}>
							<PlusIcon data-icon="inline-start" />
							Add tool
						</Button>
					</div>
				</TabsContent>

				<TabsContent value="secrets" className="pt-4">
					{/* The secrets page as it is: no sheet for this one. */}
					{tab === "secrets" && selection?.kind === "secrets" ? (
						<div className="-mx-4 md:-mx-8">{props.detail}</div>
					) : (
						<Button onClick={() => select({ kind: "secrets" })}>
							Show secrets
						</Button>
					)}
				</TabsContent>
			</Tabs>
			{problems > 0 && tab === "profiles" ? (
				<p className="text-muted-foreground text-sm">
					{problems} {problems === 1 ? "program" : "programs"} on this computer
					can be set up. See Harnesses and Tools.
				</p>
			) : null}

			<Sheet
				open={selection !== null && selection.kind !== "secrets"}
				onOpenChange={(open) => (open ? null : select(null))}
			>
				<SheetContent className="w-full p-0 data-[side=right]:sm:max-w-4xl">
					<SheetTitle className="sr-only">Details</SheetTitle>
					<ScrollArea className="h-full min-h-0">{props.detail}</ScrollArea>
				</SheetContent>
			</Sheet>
		</div>
	);
}

// ---------------------------------------------------------------- D

function Lane({
	title,
	description,
	count,
	onAdd,
	addLabel,
	children,
}: {
	title: string;
	description: string;
	count: number;
	onAdd: () => void;
	addLabel: string;
	children: ReactNode;
}) {
	return (
		<Card className="min-h-0 gap-0 py-0">
			<CardHeader className="border-b py-4">
				<CardTitle className="flex items-center gap-2">
					{title}
					<Badge variant="secondary">{count}</Badge>
				</CardTitle>
				<CardDescription>{description}</CardDescription>
				<CardAction>
					<Button
						size="icon-sm"
						variant="ghost"
						aria-label={addLabel}
						onClick={onAdd}
					>
						<PlusIcon />
					</Button>
				</CardAction>
			</CardHeader>
			<CardContent className="min-h-0 flex-1 p-0">
				<ScrollArea className="h-full">
					<ItemGroup className="gap-2 p-3">{children}</ItemGroup>
				</ScrollArea>
			</CardContent>
		</Card>
	);
}

export function VariantLanes(props: PrototypeProps) {
	const { selection, select } = props;
	const found = useFoundPrograms(select);

	return (
		<div className="flex h-full flex-col gap-6 p-4 md:p-6">
			<PageHeading title="Agents" description={DESCRIPTION} />
			<div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-3">
				<Lane
					title="Profiles"
					description="What Agent and Decision nodes name."
					count={props.agentProfiles.length + props.modelProfiles.length}
					addLabel="Add a profile"
					onAdd={() => select({ kind: "new-profile" })}
				>
					{props.agentProfiles.map((p) => (
						<Item
							key={p.id}
							variant="outline"
							size="sm"
							render={
								<button
									type="button"
									onClick={() => select({ kind: "profile", id: p.id })}
								/>
							}
						>
							<ItemContent>
								<ItemTitle className="font-mono">{p.name}</ItemTitle>
								<ItemDescription>
									{harnessInfo(p.harness).label} · {p.model}
									{p.effort ? ` · ${p.effort}` : ""}
								</ItemDescription>
							</ItemContent>
							<ItemActions className="text-muted-foreground text-xs">
								{usedInLabel(p.usedBy)}
							</ItemActions>
						</Item>
					))}
					{props.modelProfiles.map((p) => (
						<Item
							key={p.id}
							variant="outline"
							size="sm"
							render={
								<button
									type="button"
									onClick={() => select({ kind: "profile", id: p.id })}
								/>
							}
						>
							<ItemContent>
								<ItemTitle className="font-mono">{p.name}</ItemTitle>
								<ItemDescription>
									Model profile · {props.deciderLabel(p.decider)}
								</ItemDescription>
							</ItemContent>
						</Item>
					))}
				</Lane>
				<Lane
					title="Harnesses"
					description="The coding agents a profile runs on."
					count={props.harnesses.length}
					addLabel="Add a harness"
					onAdd={props.onAddHarness}
				>
					{props.harnesses.map((h) => (
						<HarnessItem
							key={h.name}
							harness={h}
							onOpen={() => select({ kind: "harness", name: h.name })}
						/>
					))}
					{found.agents.map(found.row)}
				</Lane>
				<Lane
					title="Tools"
					description="What a profile hands to its agent."
					count={props.cliTools.length + props.connections.length}
					addLabel="Add a tool"
					onAdd={props.onAddTool}
				>
					{props.cliTools.map((t) => (
						<CliToolItem
							key={t.name}
							tool={t}
							onOpen={() => select({ kind: "cli", name: t.name })}
						/>
					))}
					{props.connections.map((c) => (
						<ConnectionItem
							key={c.name}
							connection={c}
							onOpen={() => select({ kind: "tool", name: c.name })}
						/>
					))}
					{found.tools.map(found.row)}
					<SecretsItem
						props={props}
						onOpen={() => select({ kind: "secrets" })}
					/>
				</Lane>
			</div>

			<Dialog
				open={selection !== null}
				onOpenChange={(open) => (open ? null : select(null))}
			>
				<DialogContent className="flex max-h-[90svh] flex-col p-0 sm:max-w-5xl">
					<DialogTitle className="sr-only">Details</DialogTitle>
					<ScrollArea className="min-h-0 flex-1">{props.detail}</ScrollArea>
				</DialogContent>
			</Dialog>
		</div>
	);
}
