import type { ApiOutputs } from "../api";

/** The Members page: the Space, its Members, its pending invitations, and what you may change. */
export type MembersOverview = ApiOutputs["members"]["list"];
export type SpaceMember = MembersOverview["members"][number];
export type PendingInvitation = MembersOverview["invitations"][number];
export type SpaceRole = SpaceMember["role"];
/** An invitation as its link's page shows it. */
export type InvitationView = ApiOutputs["invitations"]["get"];
