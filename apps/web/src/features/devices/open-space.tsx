import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Button } from "@nightshift/ui/components/button";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRightIcon, ServerIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useSwitchSpace } from "@/features/spaces";
import type { ThisComputer } from "@/shared/api";

/**
 * A Space a Host keeps is not this computer's own: joining a Host adds it
 * beside this computer's Spaces, in the Space switcher. These lead into it.
 */

/** A Space a Host keeps. Its name says the Host when it is personal. */
export type HostKeptSpace = { id: string; name: string };

/** The Spaces the Hosts this computer joined keep for it, revoked Hosts left out. */
export function hostKeptSpaces(hosts: ThisComputer["hosts"]): HostKeptSpace[] {
	return hosts
		.filter((host) => host.status !== "revoked")
		.flatMap((host) =>
			host.spaces.map((space) => ({ id: space.id, name: space.name })),
		);
}

/** Switches to the Space and opens its Devices page. */
function useOpenSpace() {
	const switchSpace = useSwitchSpace();
	const navigate = useNavigate();
	return {
		open: async (spaceId: string) => {
			try {
				await switchSpace.mutateAsync({ spaceId });
			} catch {
				// useSwitchSpace shows the error.
				return;
			}
			await navigate({ to: "/devices" });
		},
		opening: switchSpace.isPending ? switchSpace.variables?.spaceId : undefined,
	};
}

/** Opens a Space a Host keeps: it becomes the Space you work in. */
export function OpenSpaceButton({
	spaceId,
	children = "Open",
}: {
	spaceId: string;
	children?: ReactNode;
}) {
	const { open, opening } = useOpenSpace();
	return (
		<Button
			variant="outline"
			size="sm"
			disabled={opening !== undefined}
			onClick={() => void open(spaceId)}
		>
			{opening === spaceId ? <Spinner data-icon="inline-start" /> : null}
			{children}
			{opening === spaceId ? null : <ArrowRightIcon data-icon="inline-end" />}
		</Button>
	);
}

/**
 * On the Devices page of a Space this computer keeps: the Spaces your Hosts
 * keep are elsewhere, with a button to open each.
 */
export function HostSpacesAlert({ spaces }: { spaces: HostKeptSpace[] }) {
	if (spaces.length === 0) return null;
	return (
		<Alert>
			<ServerIcon />
			<AlertTitle>Your Hosts keep other Spaces</AlertTitle>
			<AlertDescription>
				<p>
					This Space stays on this computer. Open a Space of a Host to see its
					computers and projects.
				</p>
				<div className="mt-2 flex flex-wrap gap-2">
					{spaces.map((space) => (
						<OpenSpaceButton key={space.id} spaceId={space.id}>
							{space.name}
						</OpenSpaceButton>
					))}
				</div>
			</AlertDescription>
		</Alert>
	);
}
