import { createFileRoute } from "@tanstack/react-router";

import { ProofPage } from "@/features/proof";

export const Route = createFileRoute("/proof")({
	component: ProofPage,
});
