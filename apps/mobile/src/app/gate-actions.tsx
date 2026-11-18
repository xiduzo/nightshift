import { SignedInOnly } from "@/features/access";
import { GateActionsScreen } from "@/features/gates";

export default function GateActionsRoute() {
	return (
		<SignedInOnly>
			<GateActionsScreen />
		</SignedInOnly>
	);
}
