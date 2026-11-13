/**
 * PROTOTYPE, throw away. Variant B: Settings is an overview with one card
 * for each part, and each part is its own page behind the breadcrumb.
 * There are no slots here: a table gives each of the six agents its own
 * choice, and "Automatic" picks for you.
 */
import { Button } from "@nightshift/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
import { Progress } from "@nightshift/ui/components/progress";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nightshift/ui/components/table";
import { Link } from "@tanstack/react-router";
import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { PageHeading, SiteHeader } from "@/shared/page";
import { BUILTINS, builtinOf, SLOTS } from "./model";
import {
	BuiltinDetail,
	EngineLists,
	EngineSelect,
	SetupWizard,
	StateBadge,
} from "./parts";
import type { VariantProps } from "./prototype-settings";
import { SECTIONS } from "./variant-menu";

export function OverviewVariant({
	proto,
	section,
	agent,
	real,
	go,
}: VariantProps) {
	const current = SECTIONS.find((item) => item.key === section);
	const builtin = current?.key === "builtin" ? builtinOf(agent) : undefined;
	const [wizard, setWizard] = useState(false);
	const missing = proto.total - proto.ready;

	const summary: Record<(typeof SECTIONS)[number]["key"], string> = {
		builtin:
			missing === 0
				? "All six can answer."
				: `${missing} of ${proto.total} cannot answer yet.`,
		yours: `${proto.agents.length} ${proto.agents.length === 1 ? "profile" : "profiles"} for the steps of a flow.`,
		engines: `${proto.agents.length} agents and ${proto.models.length} models connected.`,
		tools: "The programs and connections a profile gives its agent.",
		runs: "Schedules, how many runs at once, limits, cleanup.",
		computer: "Data folder, Host, network, phone, monitoring.",
		you: "Notifications and appearance.",
	};

	return (
		<>
			<SiteHeader
				crumbs={[
					current
						? {
								label: "Settings",
								link: { to: "/settings", search: go.to({}) },
							}
						: { label: "Settings" },
					...(current
						? [
								builtin
									? {
											label: current.label,
											link: {
												to: "/settings" as const,
												search: go.to({ section: current.key }),
											},
										}
									: {
											label: current.label,
											menu: SECTIONS.map((item) => ({
												label: item.label,
												icon: item.icon,
												link: {
													to: "/settings" as const,
													search: go.to({ section: item.key }),
												},
												current: item.key === current.key,
											})),
										},
							]
						: []),
					...(builtin ? [{ label: builtin.name }] : []),
				]}
			/>
			<div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 p-4 md:p-6">
				{builtin ? (
					<>
						<PageHeading title={builtin.name} description={builtin.job} />
						<BuiltinDetail proto={proto} builtin={builtin} />
					</>
				) : !current ? (
					<>
						<PageHeading
							title="Settings"
							description="Choose who answers, how flows run and how Night Shift tells you."
						/>
						<Card size="sm">
							<CardHeader>
								<CardTitle>
									{missing === 0
										? "Night Shift is set up"
										: `${missing} of Night Shift's agents cannot answer yet`}
								</CardTitle>
								<CardDescription>
									{missing === 0
										? "Every agent has a model that answers."
										: "Finish the setup to use every button."}
								</CardDescription>
							</CardHeader>
							<CardContent className="flex items-center gap-4">
								<Progress
									value={(proto.ready / proto.total) * 100}
									className="flex-1"
								/>
								<Button
									size="sm"
									variant={missing === 0 ? "outline" : "default"}
									onClick={() => setWizard(true)}
								>
									{missing === 0 ? "Check again" : "Continue the setup"}
								</Button>
							</CardContent>
						</Card>
						<div className="grid gap-4 sm:grid-cols-2">
							{SECTIONS.map((item) => (
								<Link
									key={item.key}
									to="/settings"
									search={go.to({ section: item.key })}
									className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
								>
									<Card size="sm" className="h-full hover:bg-muted/50">
										<CardHeader>
											<CardTitle className="flex items-center gap-2">
												<item.icon className="size-4 text-muted-foreground" />
												{item.label}
												<ChevronRightIcon className="ml-auto size-4 text-muted-foreground" />
											</CardTitle>
											<CardDescription>{summary[item.key]}</CardDescription>
										</CardHeader>
									</Card>
								</Link>
							))}
						</div>
					</>
				) : current.key === "builtin" ? (
					<>
						<PageHeading
							title="Night Shift's agents"
							description="Six agents help you build, explain and decide. Choose who answers for each."
						/>
						<div className="overflow-x-auto rounded-xl border">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Agent</TableHead>
										<TableHead>Needs</TableHead>
										<TableHead>Answers with</TableHead>
										<TableHead />
									</TableRow>
								</TableHeader>
								<TableBody>
									{BUILTINS.map((item) => {
										const state = proto.stateOf(item);
										return (
											<TableRow key={item.id}>
												<TableCell>
													<Link
														to="/settings"
														search={go.to({
															section: "builtin",
															agent: item.id,
														})}
														className="font-medium underline-offset-4 hover:underline"
													>
														{item.name}
													</Link>
													<div className="text-muted-foreground text-xs">
														{item.job}
													</div>
												</TableCell>
												<TableCell className="text-muted-foreground">
													{SLOTS.find((s) => s.id === item.slot)?.takesLabel}
												</TableCell>
												<TableCell>
													<EngineSelect
														proto={proto}
														takes={item.takes}
														value={state.ready ? state.engine : null}
														follow={{
															label: "Automatic",
															following: !proto.overrideOf(item.id),
														}}
														onPick={(id) => proto.override(item.id, id)}
														label={`${item.name} answers with`}
														className="w-48"
													/>
												</TableCell>
												<TableCell className="text-right">
													<StateBadge proto={proto} builtin={item} />
												</TableCell>
											</TableRow>
										);
									})}
								</TableBody>
							</Table>
						</div>
						{real.search}
					</>
				) : current.key === "yours" ? (
					<>
						<PageHeading
							title="Your agents"
							description="Profiles do the work of a step. A flow picks one by its name."
						/>
						{real.yours}
					</>
				) : current.key === "engines" ? (
					<>
						<PageHeading
							title="Agents and models"
							description="What you connected to this computer."
						/>
						<EngineLists proto={proto} />
					</>
				) : current.key === "tools" ? (
					<PageHeading
						title="Tools"
						description="The list of tools moves here from the Agents page."
					/>
				) : current.key === "runs" ? (
					<>
						<PageHeading title="Runs" description="Choose how flows run." />
						{real.runs}
					</>
				) : current.key === "computer" ? (
					<>
						<PageHeading title="This computer" />
						{real.computer}
					</>
				) : (
					<>
						<PageHeading title="You" />
						{real.you}
					</>
				)}
			</div>
			<SetupWizard proto={proto} open={wizard} onOpenChange={setWizard} />
		</>
	);
}
