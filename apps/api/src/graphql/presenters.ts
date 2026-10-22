import type { ContactDto } from "../dto/contacts";

/** The GraphQL rendering of a contact status. */
export type ContactStatusView = "ACTIVE" | "LEAD" | "CHURNED";

/** A contact as the GraphQL schema exposes it. */
export type ContactView = Omit<ContactDto, "status"> & {
  status: ContactStatusView;
};

const STATUS_TO_VIEW: Record<ContactDto["status"], ContactStatusView> = {
  active: "ACTIVE",
  lead: "LEAD",
  churned: "CHURNED",
};

const STATUS_FROM_VIEW: Record<ContactStatusView, ContactDto["status"]> = {
  ACTIVE: "active",
  LEAD: "lead",
  CHURNED: "churned",
};

const STATUS_VALUES = new Set<string>(Object.keys(STATUS_FROM_VIEW));

/**
 * Map a service DTO to the GraphQL type.
 *
 * The REST wire format keeps the lowercase status; GraphQL exposes an enum,
 * which is SCREAMING_SNAKE by convention. The mapping lives here so neither
 * the services nor the resolvers know about the transport vocabulary.
 */
export const presentContact = (contact: ContactDto): ContactView => ({
  ...contact,
  status: STATUS_TO_VIEW[contact.status],
});

/** Translate a GraphQL status into the domain vocabulary. */
export const statusFromView = (
  value: string | null | undefined,
): ContactDto["status"] | undefined =>
  value !== null && value !== undefined && STATUS_VALUES.has(value)
    ? STATUS_FROM_VIEW[value as ContactStatusView]
    : undefined;
