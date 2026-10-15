import { Link } from "@tanstack/react-router";
import { MoonStarIcon } from "lucide-react";

// Local single-user mode: no sign-in. The auth pieces (user-menu, /login) stay
// in the tree for later but are not linked from here.
export default function Header() {
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
				<Link
					to="/"
					className="outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring data-[status=active]:text-foreground"
					activeOptions={{ exact: true }}
				>
					Projects
				</Link>
			</nav>
		</header>
	);
}
