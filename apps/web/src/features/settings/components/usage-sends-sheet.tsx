import {
	Alert,
	AlertAction,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Button } from "@nightshift/ui/components/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import { FieldLegend, FieldSet } from "@nightshift/ui/components/field";
import {
	Item,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { ScrollArea } from "@nightshift/ui/components/scroll-area";
import {
	Sheet,
	SheetContent,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@nightshift/ui/components/sheet";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlertIcon } from "lucide-react";
import { useId } from "react";
import { toast } from "sonner";
import { usageMutations, usageQueries } from "../queries";

/** Opens "What Night Shift sends". */
export function UsageSendsButton({ onClick }: { onClick: () => void }) {
	return (
		<Button
			type="button"
			variant="outline"
			size="sm"
			className="self-start"
			onClick={onClick}
		>
			What Night Shift sends
		</Button>
	);
}

/** The events that can be sent, what is waiting, and the last batch, as JSON. */
export function UsageSendsSheet({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const queryClient = useQueryClient();
	const catalog = useQuery({
		...usageQueries.catalog(),
		enabled: open,
	});
	const outbox = useQuery({
		...usageQueries.outbox(),
		enabled: open,
	});
	const resetId = useId();
	const reset = useMutation({
		...usageMutations.resetId(),
		onSuccess: () => {
			toast.success("This computer has a new anonymous id.");
			void queryClient.invalidateQueries({
				queryKey: usageQueries.outbox().queryKey,
			});
		},
		onError: (error) => toast.error(`Not reset: ${error.message}`),
	});

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent className="data-[side=right]:sm:max-w-lg">
				<SheetHeader className="border-b">
					<SheetTitle>What Night Shift sends</SheetTitle>
				</SheetHeader>
				<ScrollArea className="min-h-0 flex-1">
					<div className="flex flex-col gap-6 p-4">
						<FieldSet className="gap-3">
							<FieldLegend variant="label">Events that can be sent</FieldLegend>
							<CatalogList
								loading={catalog.isPending}
								error={catalog.error}
								events={catalog.data?.events}
								onRetry={() => void catalog.refetch()}
								retrying={catalog.isFetching}
							/>
						</FieldSet>
						{outbox.error ? (
							<LoadError
								title="This did not load"
								message={outbox.error.message}
								onRetry={() => void outbox.refetch()}
								retrying={outbox.isFetching}
							/>
						) : (
							<>
								<FieldSet className="gap-3">
									<FieldLegend variant="label">Waiting to send</FieldLegend>
									{outbox.isPending ? (
										<Skeleton className="h-24 w-full" />
									) : (
										<WaitingList waiting={outbox.data?.waiting} />
									)}
								</FieldSet>
								<FieldSet className="gap-3">
									<FieldLegend variant="label">Last batch sent</FieldLegend>
									{outbox.isPending ? (
										<Skeleton className="h-24 w-full" />
									) : (
										<JsonBlock value={outbox.data?.lastSent ?? []} />
									)}
								</FieldSet>
							</>
						)}
					</div>
				</ScrollArea>
				<SheetFooter className="border-t">
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="self-start"
						disabled={reset.isPending}
						aria-describedby={resetId}
						onClick={() => reset.mutate()}
					>
						{reset.isPending ? <Spinner data-icon="inline-start" /> : null}
						Reset id
					</Button>
					<p id={resetId} className="text-muted-foreground text-sm">
						This computer gets a new anonymous id, and older events no longer
						count as this computer.
					</p>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}

function CatalogList({
	loading,
	error,
	events,
	onRetry,
	retrying,
}: {
	loading: boolean;
	error: Error | null;
	events: { name: string; attributes: string[] }[] | undefined;
	onRetry: () => void;
	retrying: boolean;
}) {
	if (loading) return <Skeleton className="h-24 w-full" />;
	if (error) {
		return (
			<LoadError
				title="The events did not load"
				message={error.message}
				onRetry={onRetry}
				retrying={retrying}
			/>
		);
	}
	if (!events || events.length === 0) {
		return (
			<Empty>
				<EmptyHeader>
					<EmptyTitle>No events to list.</EmptyTitle>
				</EmptyHeader>
			</Empty>
		);
	}
	return (
		<ItemGroup>
			{events.map((event) => (
				<Item key={event.name} variant="outline" size="sm">
					<ItemContent>
						<ItemTitle className="font-mono">{event.name}</ItemTitle>
						{event.attributes.length > 0 ? (
							<ItemDescription className="font-mono">
								{event.attributes.join(", ")}
							</ItemDescription>
						) : null}
					</ItemContent>
				</Item>
			))}
		</ItemGroup>
	);
}

function WaitingList({ waiting }: { waiting: unknown }) {
	if (!Array.isArray(waiting) || waiting.length === 0) {
		return (
			<Empty>
				<EmptyHeader>
					<EmptyTitle>Nothing is waiting to send.</EmptyTitle>
					<EmptyDescription>Leave Send anonymous usage on.</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}
	return <JsonBlock value={waiting} />;
}

function JsonBlock({ value }: { value: unknown }) {
	return (
		<ScrollArea className="max-h-64 rounded-md border bg-muted/40">
			<pre className="whitespace-pre-wrap break-all p-3 font-mono text-xs">
				{JSON.stringify(value, null, 2)}
			</pre>
		</ScrollArea>
	);
}

function LoadError({
	title,
	message,
	onRetry,
	retrying,
}: {
	title: string;
	message: string;
	onRetry: () => void;
	retrying: boolean;
}) {
	return (
		<Alert variant="destructive">
			<CircleAlertIcon />
			<AlertTitle>{title}</AlertTitle>
			<AlertDescription>{message}</AlertDescription>
			<AlertAction>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={retrying}
					onClick={onRetry}
				>
					{retrying ? <Spinner data-icon="inline-start" /> : null}
					Try again
				</Button>
			</AlertAction>
		</Alert>
	);
}
