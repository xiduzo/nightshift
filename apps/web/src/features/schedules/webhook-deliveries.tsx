import { webhookSecretName } from "@nightshift/flows";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@nightshift/ui/components/dialog";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@nightshift/ui/components/field";
import {
	Item,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Link } from "@tanstack/react-router";
import { useId } from "react";
import type { ScheduleSummary } from "@/shared/api";
import { formatDateTime, formatDayTime } from "@/shared/format";
import { WebhookAddress, webhookAddress } from "./webhook-fields";

/** One webhook a schedule received. */
export type WebhookDelivery = ScheduleSummary["deliveries"][number];

const RESULT_WORDS: Record<WebhookDelivery["result"], string> = {
	accepted: "Accepted",
	filtered: "Filtered out",
	refused: "Refused",
};

/** What a webhook did, in a few words: the run it started, the runs it woke. */
function outcomeOf(delivery: WebhookDelivery): string | null {
	const parts: string[] = [];
	if (delivery.woke > 0) {
		parts.push(
			delivery.woke === 1 ? "Woke 1 run." : `Woke ${delivery.woke} runs.`,
		);
	}
	if (delivery.reason) parts.push(delivery.reason);
	return parts.length > 0 ? parts.join(" ") : null;
}

/** The latest webhook, as one line of the schedule list. */
export function LastDelivery({ delivery }: { delivery: WebhookDelivery }) {
	return (
		<p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 whitespace-normal text-muted-foreground text-xs">
			<time
				dateTime={new Date(delivery.at).toISOString()}
				title={formatDateTime(delivery.at)}
			>
				{formatDayTime(delivery.at)}
			</time>
			<Badge
				variant={delivery.result === "refused" ? "destructive" : "secondary"}
			>
				{RESULT_WORDS[delivery.result]}
			</Badge>
			{delivery.runId ? (
				<Link
					to="/runs/$runId"
					params={{ runId: delivery.runId }}
					className="underline underline-offset-2"
				>
					Open the run
				</Link>
			) : null}
		</p>
	);
}

/**
 * A webhook schedule's address, its secret and its latest webhooks:
 * accepted, filtered out by its rule, or refused.
 */
export function WebhookDialog({
	open,
	onOpenChange,
	projectId,
	schedule,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	projectId: string;
	schedule: ScheduleSummary | null;
}) {
	const id = useId();
	const secret = webhookSecretName(schedule?.webhook?.secret ?? "");
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Webhook</DialogTitle>
					<DialogDescription>
						Send the webhook to this address. Night Shift checks its secret,
						then starts the flow or wakes the runs that wait.
					</DialogDescription>
				</DialogHeader>
				{schedule ? (
					<FieldGroup className="gap-5">
						<WebhookAddress
							id={`${id}-address`}
							address={webhookAddress(projectId, schedule.id)}
						/>
						<Field>
							<FieldLabel>Secret</FieldLabel>
							<p className="font-mono text-sm">{secret ?? "—"}</p>
							<FieldDescription>
								Give the value of this secret to the sender. You find it under
								Agents, Secrets.
							</FieldDescription>
						</Field>
						<Field>
							<FieldLabel>Recent webhooks</FieldLabel>
							{schedule.deliveries.length === 0 ? (
								<Empty className="border py-6">
									<EmptyHeader>
										<EmptyTitle>No webhooks yet</EmptyTitle>
										<EmptyDescription>
											Each webhook that arrives shows here, also the ones Night
											Shift refused.
										</EmptyDescription>
									</EmptyHeader>
								</Empty>
							) : (
								<ItemGroup>
									{schedule.deliveries.map((delivery) => (
										<Item
											key={`${delivery.at}-${delivery.result}-${delivery.runId ?? ""}`}
											size="xs"
											className="px-0"
										>
											<ItemContent className="min-w-0">
												<ItemTitle>
													<LastDelivery delivery={delivery} />
												</ItemTitle>
												{outcomeOf(delivery) ? (
													<ItemDescription className="line-clamp-none">
														{outcomeOf(delivery)}
													</ItemDescription>
												) : null}
											</ItemContent>
										</Item>
									))}
								</ItemGroup>
							)}
						</Field>
					</FieldGroup>
				) : null}
				<DialogFooter>
					<DialogClose render={<Button type="button" />}>Done</DialogClose>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
