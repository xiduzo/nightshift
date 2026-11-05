import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { LaptopIcon, UserIcon } from "lucide-react";
import type { SecretView } from "@/shared/api";
import { formatRelative } from "@/shared/format";
import { LocalTime } from "@/shared/time";

/** A `${NAME}`: a letter or _, then letters, digits and _. */
export const SECRET_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

/** Where a saved secret of this computer's owner lives (ADR 13). */
export type SecretScope = SecretView["scope"];

/** What each scope is called, and what it means for the person. */
export const SCOPE: Record<
	SecretScope,
	{ label: string; hint: string; icon: typeof UserIcon }
> = {
	personal: {
		label: "Personal",
		hint: "Your steps on your own computers can use it. Steps on the Host cannot.",
		icon: UserIcon,
	},
	computer: {
		label: "This computer",
		hint: "Only steps on this computer can use it.",
		icon: LaptopIcon,
	},
};

/** How many users the Used by column names before "+N more". */
const USERS_SHOWN = 2;

/** The first users of a secret, and "+N more" with the rest on hover. */
export function UsedBy({ users }: { users: readonly string[] }) {
	if (users.length === 0) return "—";
	const shown = users.slice(0, USERS_SHOWN);
	const rest = users.slice(USERS_SHOWN);
	return (
		<span className="flex flex-wrap items-baseline gap-x-1">
			<span>
				{shown.join(", ")}
				{rest.length > 0 ? "," : null}
			</span>
			{rest.length > 0 ? (
				<Tooltip>
					<TooltipTrigger
						render={
							<span className="cursor-default whitespace-nowrap font-sans text-foreground underline decoration-dotted underline-offset-4" />
						}
					>
						+{rest.length} more
					</TooltipTrigger>
					<TooltipContent className="flex max-w-80 flex-col gap-0.5 font-mono">
						{rest.map((user) => (
							<span key={user}>{user}</span>
						))}
					</TooltipContent>
				</Tooltip>
			) : null}
		</span>
	);
}

/** A moment as "3 minutes ago", with the UTC time on hover. */
export function Ago({ at, now }: { at: number; now: number }) {
	return <LocalTime at={at}>{formatRelative(at, now)}</LocalTime>;
}
