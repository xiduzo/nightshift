import { type Flow, withFlowDevices } from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@nightshift/ui/components/select";
import { useQuery } from "@tanstack/react-query";
import { PlusIcon, XIcon } from "lucide-react";
import { useId } from "react";
import { runQueries } from "@/features/runs/flows-port";
import { missingDeviceMessage } from "../flow-draft";
import { Field } from "./fields";

/**
 * The devices that run a flow's steps without a profile, first one first.
 * Each next device is a backup for one that is offline or cannot run a step.
 * A step with a profile runs on that profile's device, then on its backups. An empty list means
 * the Host. A development install shows only on itself, or when the flow
 * names it already.
 */
export function FlowDevicesField({
	flow,
	projectId,
	onChange,
}: {
	flow: Flow;
	projectId: string;
	onChange: (change: (flow: Flow) => Flow) => void;
}) {
	const id = useId();
	const devices = useQuery({
		...runQueries.devices(projectId),
		meta: { quietErrors: true },
	});
	const chosen = flow.devices ?? [];
	const listed = devices.data ?? [];
	const nameOf = (deviceId: string) =>
		listed.find((d) => d.deviceId === deviceId)?.name ??
		"A device that is not in this Space";
	const open = listed.filter(
		(d) => !chosen.includes(d.deviceId) && (!d.dev || d.thisDevice),
	);
	const setAll = (next: string[]) =>
		onChange((current) => withFlowDevices(current, next));
	const missing =
		devices.data !== undefined &&
		chosen.some((deviceId) => !listed.some((d) => d.deviceId === deviceId));
	return (
		<Field
			id={id}
			label="Runs on"
			optional
			hint="Night Shift uses the first device that can run the steps without a profile. Empty: your Host, then the computer you start from."
			error={missing ? missingDeviceMessage({ type: "command" }) : null}
		>
			<div className="flex flex-col gap-2">
				{chosen.map((deviceId, index) => {
					const items = [
						{ value: deviceId, label: nameOf(deviceId) },
						...open.map((d) => ({ value: d.deviceId, label: d.name })),
					];
					return (
						<div key={deviceId} className="flex items-center gap-2">
							<Select
								items={items}
								value={deviceId}
								onValueChange={(next) => {
									if (!next) return;
									setAll(chosen.map((d, i) => (i === index ? next : d)));
								}}
							>
								<SelectTrigger
									className="w-full"
									aria-label={`Device ${index + 1}`}
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectGroup>
										{items.map((item) => (
											<SelectItem key={item.value} value={item.value}>
												{item.label}
											</SelectItem>
										))}
									</SelectGroup>
								</SelectContent>
							</Select>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								aria-label={`Remove ${nameOf(deviceId)}`}
								onClick={() => setAll(chosen.filter((d) => d !== deviceId))}
							>
								<XIcon aria-hidden="true" />
							</Button>
						</div>
					);
				})}
				{open.length > 0 ? (
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="self-start"
						onClick={() => {
							const [first] = open;
							if (first) setAll([...chosen, first.deviceId]);
						}}
					>
						<PlusIcon data-icon="inline-start" />
						Add device
					</Button>
				) : null}
			</div>
		</Field>
	);
}
