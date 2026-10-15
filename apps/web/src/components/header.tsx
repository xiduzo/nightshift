import { Link } from "@tanstack/react-router";
import { MoonStarIcon } from "lucide-react";

import { useOpenGates } from "@/hooks/use-open-gates";

const NAV_LINK =
	"flex items-center gap-1.5 outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring data-[status=active]:text-foreground";

// Local single-user mode: no sign-in. The auth pieces (user-menu, /login) stay
// in the tree for later but are not linked from here.
export default function Header() {
	const gates = useOpenGates();
	const open = gates.data?.length ?? 0;

	return (
		<header className="flex h-10 items-center gap-4 border-b px-4">
			<Link
				to="/"
				className="flex items-center gap-1.5 font-medium text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
			>
				<MoonStarIcon className="size-4" aria-hidden="true" />
				Night Shift
			</Link>
			<nav
				aria-label="Main"
				className="flex gap-3 text-muted-foreground text-xs"
			>
				<Link to="/" className={NAV_LINK} activeOptions={{ exact: true }}>
					Projects
				</Link>
				<Link
					to="/inbox"
					className={NAV_LINK}
					aria-label={
						open > 0
							? `Inbox, ${open} ${open === 1 ? "gate waits" : "gates wait"} for you`
							: "Inbox"
					}
				>
					Inbox
					{open > 0 ? (
						<span
							aria-hidden="true"
							className="min-w-4 bg-status-waiting px-1 text-center font-medium text-[10px] text-background tabular-nums leading-4"
						>
							{open}
						</span>
					) : null}
				</Link>
			</nav>
		</header>
	);
}
