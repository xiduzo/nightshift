import { Button } from "@nightshift/ui/components/button";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useEffect } from "react";

/**
 * PROTOTYPE, throw away. A floating bar that flips between the variants of a
 * page through `?variant=`. Arrow keys flip too. Hidden in production builds.
 */
export function PrototypeSwitcher({
	variants,
	current,
	children,
}: {
	variants: readonly { key: string; name: string }[];
	current: string;
	/** More controls for the bar, such as a sample data switch. */
	children?: React.ReactNode;
}) {
	const navigate = useNavigate();
	const index = Math.max(
		0,
		variants.findIndex((variant) => variant.key === current),
	);

	const go = (step: number) => {
		const next = variants[(index + step + variants.length) % variants.length];
		if (!next) return;
		void navigate({
			to: ".",
			search: (prev: Record<string, unknown>) => ({
				...prev,
				variant: next.key,
			}),
			replace: true,
		});
	};

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			if (
				target?.closest("input, textarea, select, [contenteditable='true']")
			) {
				return;
			}
			if (event.key === "ArrowLeft") go(-1);
			if (event.key === "ArrowRight") go(1);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});

	if (import.meta.env.PROD) return null;
	const variant = variants[index];

	return (
		<div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border-2 border-fuchsia-500 bg-zinc-950 p-1 text-zinc-50 shadow-2xl">
			<Button
				size="icon-sm"
				variant="ghost"
				className="rounded-full hover:bg-zinc-800"
				aria-label="Previous variant"
				onClick={() => go(-1)}
			>
				<ChevronLeftIcon />
			</Button>
			<span className="min-w-56 px-2 text-center font-mono text-xs">
				{variant ? `${variant.key} · ${variant.name}` : current}
				<span className="ml-2 text-zinc-400">
					{index + 1}/{variants.length}
				</span>
			</span>
			<Button
				size="icon-sm"
				variant="ghost"
				className="rounded-full hover:bg-zinc-800"
				aria-label="Next variant"
				onClick={() => go(1)}
			>
				<ChevronRightIcon />
			</Button>
			{children}
		</div>
	);
}
