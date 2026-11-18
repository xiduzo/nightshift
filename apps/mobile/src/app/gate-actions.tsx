import { GateActionsScreen } from "@/features/gates";
import { SignedInOnly } from "@/features/host";

export default function GateActionsRoute() {
	return (
		<SignedInOnly>
			<GateActionsScreen />
		</SignedInOnly>
	);
}
