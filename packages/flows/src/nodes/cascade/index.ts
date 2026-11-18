/** A cascade (ADR 6): the tiers a node climbs, the person tier, and the title and deadline of its Gate. */

export {
	ASK_TIER_CHOICES,
	CASCADE_TEMPLATE_FIELDS,
	cascadeOutputFields,
	checkCascade,
	checkGateTitle,
	checkModelTier,
	GATE_TITLE_MAX,
	type GateDeadline,
	gateDeadlineSchema,
	gateTitleSchema,
	isPersonTier,
	type PersonTier,
	personTierSchema,
	personTierTexts,
	probabilityProblem,
	RETRY_CHOICES,
	tierBase,
	tierLabel,
} from "./cascade";
