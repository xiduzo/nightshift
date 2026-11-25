import type { OwnDevice } from "@nightshift/engine";
import type { DeviceRegistry } from "../../registry";
import { ownerIn } from "../domain/acts-for";
import {
	fromCopies,
	fromHost,
	othersPaired,
} from "../domain/devices-of-person";
import { hasProject, projectOn } from "../domain/takes-work";
import type {
	DeviceCopies,
	HostDevices,
	OtherDevices,
	SpacePeople,
	SpaceProjects,
	Spaces,
	ThisComputer,
} from "./ports";

export type ListOwnDevicesPorts = {
	here: Pick<ThisComputer, "device" | "walkerId" | "ownProfiles">;
	spaces: Spaces;
	people: Pick<SpacePeople, "personInSpace" | "keptByHomeHost">;
	registry: Pick<DeviceRegistry, "selfOwnerId" | "list">;
	projects: SpaceProjects;
	copies: DeviceCopies;
	host: HostDevices;
	others: Pick<OtherDevices, "relay">;
};

/** Lists a Person's own Devices for a project of a Space: this computer first, then their others, each with whether it is online and has a Clone. */
export function listOwnDevices(ports: ListOwnDevicesPorts) {
	const { here, spaces, people, registry, projects, copies, host } = ports;

	/** The copies that count for a Person in a Space: only in a Space of the home Host, and only for this computer's own Person there. */
	async function copiesFor(spaceId: string, personId: string) {
		if (!(await people.keptByHomeHost(spaceId))) return [];
		const owner = await ownerIn(ports, spaceId);
		return owner === personId ? copies.list() : [];
	}

	return async (
		spaceId: string,
		personId: string,
		projectId: string,
	): Promise<OwnDevice[]> => {
		const project = await projects.find(projectId, spaceId);
		const selfId = await here.walkerId();
		const profiles = here.ownProfiles();
		const self: OwnDevice = {
			deviceId: selfId,
			name: here.device.name,
			thisDevice: true,
			online: true,
			hasClone: hasProject(project, project.repoPath !== null),
			...(profiles ? { profiles: [...profiles] } : {}),
		};
		if ((await spaces.hostOf(spaceId)) !== null) {
			const own = await copiesFor(spaceId, personId);
			const listed = await host.list({ spaceId, projectId });
			if (listed) return [self, ...fromHost(listed, own, selfId)];
			const { deviceName } = await spaces.open(spaceId);
			const clones = await projects.clones(spaceId, projectId);
			return [
				self,
				...fromCopies(own, {
					deviceName,
					hasProject: projectOn(project, clones),
				}),
			];
		}
		const has = projectOn(project, await projects.clones(spaceId, projectId));
		const others: OwnDevice[] = [];
		for (const d of othersPaired(await registry.list(personId), selfId)) {
			// Known only when this Replica keeps a copy of its Device document.
			const known = (await copies.kept(d.id))?.profiles;
			others.push({
				deviceId: d.id,
				name: d.name,
				thisDevice: false,
				online: await ports.others.relay.online(d.id, spaceId),
				hasClone: has(d.id),
				...(d.dev ? { dev: true } : {}),
				...(known ? { profiles: known } : {}),
			});
		}
		return [self, ...others];
	};
}
