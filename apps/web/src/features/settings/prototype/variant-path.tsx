/**
 * PROTOTYPE, throw away. Variant C: Settings is one column that starts with
 * the setup as four steps you open in place, then what you can do now by
 * what you get (not by agent or slot), then every other setting folded.
 */
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@nightshift/ui/components/accordion";
import { CircleCheckIcon, CircleDashedIcon } from "lucide-react";
import { useState } from "react";
import { PageHeading, PageSection, SiteHeader } from "@/shared/page";
import { SLOTS } from "./model";
import {
	Abilities,
	EngineLists,
	SetupStep,
	SlotSelect,
	STEPS,
	stepsDone,
} from "./parts";
import type { VariantProps } from "./prototype-settings";

export function PathVariant({ proto, real }: VariantProps) {
	const done = stepsDone(proto);
	const firstOpen = done.findIndex((step) => !step);
	const [open, setOpen] = useState<string[]>([String(firstOpen)]);
	const left = done.slice(0, 3).filter((step) => !step).length;

	const more: [string, string, React.ReactNode][] = [
		[
			"choices",
			"Who answers",
			<div key="choices" className="flex flex-col gap-4">
				{SLOTS.map((slot) => (
					<div
						key={slot.id}
						className="flex flex-wrap items-center justify-between gap-2"
					>
						<div className="min-w-0">
							<div className="font-medium text-sm">{slot.title}</div>
							<div className="text-muted-foreground text-sm">{slot.what}</div>
						</div>
						<SlotSelect proto={proto} slot={slot} />
					</div>
				))}
			</div>,
		],
		["engines", "Agents and models", <EngineLists key="e" proto={proto} />],
		["yours", "New Agent nodes", real.yours],
		["search", "Meaning search", real.search],
		["runs", "Runs", real.runs],
		["computer", "This computer", real.computer],
		["you", "You", real.you],
	];

	return (
		<>
			<SiteHeader crumbs={[{ label: "Settings" }]} />
			<div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 p-4 md:p-6">
				<PageHeading
					title="Settings"
					description={
						left === 0
							? "Night Shift is set up."
							: `${left} ${left === 1 ? "step" : "steps"} left to set up Night Shift.`
					}
				/>

				<PageSection title="Set up Night Shift">
					<Accordion
						value={open}
						onValueChange={(value) => {
							setOpen(value as string[]);
							if ((value as string[]).includes("2")) proto.runCheck();
						}}
						className="rounded-xl border px-4"
					>
						{STEPS.map((name, index) => (
							<AccordionItem key={name} value={String(index)}>
								<AccordionTrigger>
									<span className="flex items-center gap-3">
										{done[index] ? (
											<CircleCheckIcon className="size-4 text-status-finished" />
										) : (
											<CircleDashedIcon className="size-4 text-muted-foreground" />
										)}
										<span>
											{index + 1}. {name}
										</span>
										<span className="font-normal text-muted-foreground">
											{stepLine(proto, index)}
										</span>
									</span>
								</AccordionTrigger>
								<AccordionContent>
									<SetupStep proto={proto} step={index} />
								</AccordionContent>
							</AccordionItem>
						))}
					</Accordion>
				</PageSection>

				<PageSection
					title="What you can do now"
					description={`${proto.ready} of ${proto.total} work on this computer.`}
				>
					<Abilities proto={proto} onFix={(step) => setOpen([String(step)])} />
				</PageSection>

				<PageSection title="More settings">
					<Accordion className="rounded-xl border px-4">
						{more.map(([key, title, content]) => (
							<AccordionItem key={key} value={key}>
								<AccordionTrigger>{title}</AccordionTrigger>
								<AccordionContent>
									<div className="flex flex-col gap-6 py-2">{content}</div>
								</AccordionContent>
							</AccordionItem>
						))}
					</Accordion>
				</PageSection>
			</div>
		</>
	);
}

/** What a step holds now, beside its name. */
function stepLine(proto: VariantProps["proto"], step: number): string {
	if (step === 0) return proto.slotEngine("helper")?.name ?? "";
	if (step === 1) {
		return (
			proto.slotEngine("decision")?.name ?? (proto.decisionLater ? "Later" : "")
		);
	}
	return "";
}
