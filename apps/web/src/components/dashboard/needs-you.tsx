import { GateCard } from "@/components/gate/gate-card";
import { useNow } from "@/hooks/use-now";
import { useOpenGates } from "@/hooks/use-open-gates";

/** The project's open Gates, to answer in place. Nothing when none wait. */
export function NeedsYou({ projectId }: { projectId: string }) {
	const gates = useOpenGates();
	const now = useNow(30_000);
	const open = gates.data?.filter((gate) => gate.projectId === projectId) ?? [];
	if (open.length === 0) return null;

	return (
		<section
			aria-labelledby="needs-you-heading"
			className="flex flex-col gap-3"
		>
			<div className="flex flex-col gap-1">
				<h2
					id="needs-you-heading"
					className="font-semibold text-lg tracking-tight"
				>
					Needs you
				</h2>
				<p className="text-muted-foreground text-sm">
					{open.length === 1 ? "A run waits" : `${open.length} runs wait`} at a
					Gate for your answer.
				</p>
			</div>
			<ol className="flex flex-col gap-4" aria-label="Open gates">
				{open.map((gate) => (
					<li key={gate.stepId}>
						<GateCard gate={gate} now={now} />
					</li>
				))}
			</ol>
		</section>
	);
}
