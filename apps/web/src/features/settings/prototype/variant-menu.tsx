/**
 * PROTOTYPE, throw away. Variant A: Settings with a side menu of seven
 * sections. Night Shift's agents come first: three choices, then the six
 * agents with their state. An agent opens in place.
 */
import { Button } from "@nightshift/ui/components/button";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { cn } from "@nightshift/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import {
	BotIcon,
	ChevronRightIcon,
	CpuIcon,
	MonitorIcon,
	PlayIcon,
	SparklesIcon,
	UserIcon,
	WrenchIcon,
} from "lucide-react";
import { useState } from "react";
import { PageHeading, PageSection, SiteHeader } from "@/shared/page";
import { BUILTINS, builtinOf, SLOTS } from "./model";
import {
	BuiltinDetail,
	EngineLists,
	SetupWizard,
	SlotSelect,
	StateBadge,
} from "./parts";
import type { VariantProps } from "./prototype-settings";

export const SECTIONS = [
	{ key: "builtin", label: "Night Shift's agents", icon: SparklesIcon },
	{ key: "yours", label: "Your agents", icon: BotIcon },
	{ key: "engines", label: "Agents and models", icon: CpuIcon },
	{ key: "tools", label: "Tools", icon: WrenchIcon },
	{ key: "runs", label: "Runs", icon: PlayIcon },
	{ key: "computer", label: "This computer", icon: MonitorIcon },
	{ key: "you", label: "You", icon: UserIcon },
] as const;

export function MenuVariant({ proto, section, agent, real, go }: VariantProps) {
	const current = SECTIONS.find((item) => item.key === section) ?? SECTIONS[0];
	const builtin = current.key === "builtin" ? builtinOf(agent) : undefined;
	const [wizard, setWizard] = useState(false);

	return (
		<>
			<SiteHeader
				crumbs={[
					{ label: "Settings", link: { to: "/settings", search: go.to({}) } },
					builtin
						? {
								label: current.label,
								link: {
									to: "/settings",
									search: go.to({ section: current.key }),
								},
							}
						: { label: current.label },
					...(builtin ? [{ label: builtin.name }] : []),
				]}
			/>
			<div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-4 md:flex-row md:p-6">
				<nav
					aria-label="Settings"
					className="flex shrink-0 flex-row flex-wrap gap-1 md:w-56 md:flex-col"
				>
					{SECTIONS.map((item, index) => (
						<Button
							key={item.key}
							variant="ghost"
							size="sm"
							nativeButton={false}
							className={cn(
								"justify-start",
								item.key === current.key && "bg-muted font-medium",
								index === 4 && "md:mt-4",
							)}
							render={
								<Link to="/settings" search={go.to({ section: item.key })} />
							}
						>
							<item.icon data-icon="inline-start" />
							{item.label}
						</Button>
					))}
				</nav>

				<div className="flex min-w-0 max-w-3xl flex-1 flex-col gap-8">
					{builtin ? (
						<>
							<PageHeading title={builtin.name} description={builtin.job} />
							<BuiltinDetail proto={proto} builtin={builtin} />
						</>
					) : current.key === "builtin" ? (
						<>
							<PageHeading
								title="Night Shift's agents"
								description="These agents help you build, explain and decide. Choose which model answers."
								actions={
									<Button
										variant="outline"
										size="sm"
										onClick={() => setWizard(true)}
									>
										Set up
									</Button>
								}
							/>
							<ItemGroup className="gap-2">
								{SLOTS.map((slot) => (
									<Item key={slot.id} variant="outline" size="sm">
										<ItemContent>
											<ItemTitle>{slot.title}</ItemTitle>
											<ItemDescription>
												{slot.what} {slot.takesLabel}.
											</ItemDescription>
										</ItemContent>
										<ItemActions>
											<SlotSelect proto={proto} slot={slot} />
										</ItemActions>
									</Item>
								))}
							</ItemGroup>
							<PageSection
								title="The agents"
								description={`${proto.ready} of ${proto.total} can answer.`}
							>
								<ItemGroup className="gap-2">
									{BUILTINS.map((item) => (
										<Item
											key={item.id}
											variant="outline"
											size="sm"
											render={
												<Link
													to="/settings"
													search={go.to({ section: "builtin", agent: item.id })}
												/>
											}
										>
											<ItemContent>
												<ItemTitle>{item.name}</ItemTitle>
												<ItemDescription>{item.job}</ItemDescription>
											</ItemContent>
											<ItemActions>
												<StateBadge proto={proto} builtin={item} />
												<ChevronRightIcon className="size-4 text-muted-foreground" />
											</ItemActions>
										</Item>
									))}
								</ItemGroup>
								<p className="text-muted-foreground text-sm">
									Help cost $4.12 this month.{" "}
									<Link to="/spend" className="underline underline-offset-4">
										See it on Spend
									</Link>
								</p>
							</PageSection>
							{real.search}
						</>
					) : current.key === "yours" ? (
						<>
							<PageHeading
								title="Your agents"
								description="Profiles do the work of a step. A flow picks one by its name."
								actions={
									<Button
										variant="outline"
										size="sm"
										nativeButton={false}
										render={<Link to="/agents" />}
									>
										Open profiles
									</Button>
								}
							/>
							<ItemGroup className="gap-2">
								{proto.agents.map((engine) => (
									<Item key={engine.id} variant="outline" size="sm">
										<ItemContent>
											<ItemTitle className="font-mono">{engine.name}</ItemTitle>
											<ItemDescription>{engine.detail}</ItemDescription>
										</ItemContent>
									</Item>
								))}
							</ItemGroup>
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
						<>
							<PageHeading
								title="Tools"
								description="The programs and connections a profile gives its agent."
							/>
							<p className="text-muted-foreground text-sm">
								The list of tools moves here from the Agents page.{" "}
								<Link to="/agents" className="underline underline-offset-4">
									Open it there
								</Link>
							</p>
						</>
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
			</div>
			<SetupWizard proto={proto} open={wizard} onOpenChange={setWizard} />
		</>
	);
}
