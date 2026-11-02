import { Card, CardContent } from "@nightshift/ui/components/card";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@nightshift/ui/components/field";
import { Switch } from "@nightshift/ui/components/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";
import { PageSection } from "@/shared/page";
import { spaceMutations, spaceQueries } from "./queries";

/** An owner can do everything an admin can, so both may set this. */
function isSpaceAdmin(role: string | null | undefined): boolean {
	return role === "owner" || role === "admin";
}

/** The saved value on the Space, when the list carries it. Missing means on. */
function usageFrom(space: object | undefined): boolean | undefined {
	if (space && "usage" in space && typeof space.usage === "boolean") {
		return space.usage;
	}
	return undefined;
}

/**
 * "Send anonymous usage" for the active Space. Only an owner or an admin
 * sees it. The list may not carry `usage` until that field lands: a change
 * stays for this visit, and the list wins once it has the value.
 */
export function SpaceUsageSection() {
	const id = useId();
	const queryClient = useQueryClient();
	const queryKey = spaceQueries.list().queryKey;
	const spaces = useQuery(spaceQueries.list());
	const active = spaces.data?.spaces.find(
		(space) => space.id === spaces.data?.active,
	);
	const [override, setOverride] = useState<{
		spaceId: string;
		enabled: boolean;
	} | null>(null);

	const undo = useMutation({
		...spaceMutations.setUsage(),
		onMutate: async (input) => {
			await queryClient.cancelQueries({ queryKey });
			const before = queryClient.getQueryData(queryKey);
			writeUsage(input.enabled);
			return { before };
		},
		onError: (error, _input, context) => {
			if (context?.before !== undefined) {
				queryClient.setQueryData(queryKey, context.before);
			}
			toast.error(`Not undone: ${error.message}`);
		},
		onSuccess: () => {
			toast.info("Change undone");
		},
	});

	const setUsage = useMutation({
		...spaceMutations.setUsage(),
		onMutate: async (input) => {
			await queryClient.cancelQueries({ queryKey });
			const before = queryClient.getQueryData(queryKey);
			if (active) setOverride({ spaceId: active.id, enabled: input.enabled });
			writeUsage(input.enabled);
			return { before };
		},
		onError: (error, _input, context) => {
			setOverride(null);
			if (context?.before !== undefined) {
				queryClient.setQueryData(queryKey, context.before);
			}
			toast.error(`Not saved: ${error.message}`);
		},
		onSuccess: (_data, _input, context) => {
			const previous = usageFrom(
				context?.before?.spaces.find(
					(space) => space.id === context.before?.active,
				),
			);
			toast.success("This Space saved", {
				action: {
					label: "Undo",
					onClick: () => undo.mutate({ enabled: previous ?? true }),
				},
			});
		},
	});

	function writeUsage(enabled: boolean) {
		queryClient.setQueryData(queryKey, (current) => {
			if (!current) return current;
			return {
				...current,
				spaces: current.spaces.map((space) =>
					space.id === current.active ? { ...space, usage: enabled } : space,
				),
			};
		});
	}

	if (!active || !isSpaceAdmin(active.role)) return null;

	const fromList = usageFrom(active);
	const local = override?.spaceId === active.id ? override.enabled : undefined;
	const enabled = fromList ?? local ?? true;
	const pending = setUsage.isPending || undo.isPending;

	return (
		<PageSection title="This Space">
			<Card>
				<CardContent>
					<FieldGroup>
						<Field orientation="horizontal">
							<FieldContent>
								<FieldLabel htmlFor={id}>Send anonymous usage</FieldLabel>
								<FieldDescription>
									This turns anonymous usage off on every computer in this
									Space.
								</FieldDescription>
							</FieldContent>
							<Switch
								id={id}
								checked={enabled}
								disabled={pending}
								onCheckedChange={(checked) =>
									setUsage.mutate({ enabled: checked })
								}
							/>
						</Field>
					</FieldGroup>
				</CardContent>
			</Card>
		</PageSection>
	);
}
