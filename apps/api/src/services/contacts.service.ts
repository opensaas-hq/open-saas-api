import {
  type AuditEvent,
  type AuditPort,
  computeAuditDiff,
} from "@opensaas/core";
import {
  type ContactStatus,
  type Database,
  DatabaseAuditRepository,
  type Transaction,
  createContact,
  createContactsBulk,
  getContactsByOrganization,
  withTransaction,
} from "@opensaas/database";
import {
  type ContactDto,
  type CreateContactRequest,
  type PaginationDto,
  toContactDto,
} from "../dto/contacts";
import type { BranchesService } from "./branches.service";

/** Options of {@link ContactsService.list}. */
export type ListContactsInput = {
  organizationId: string;
  page?: number;
  limit?: number;
  status?: ContactStatus;
  branchId?: string;
  search?: string;
};

/** Options of {@link ContactsService.create}. */
export type CreateContactInput = {
  organizationId: string;
  /** The user performing the change; recorded in the audit event. */
  actorId: string;
  /** The branch of the request; used when the payload names none. */
  branchId?: string | null;
  contact: CreateContactRequest;
};

/** Options of {@link ContactsService.bulkCreate}. */
export type BulkCreateContactsInput = {
  organizationId: string;
  /** The user performing the change; recorded in the audit events. */
  actorId: string;
  /** The branch of the request; used when a payload names none. */
  branchId?: string | null;
  contacts: CreateContactRequest[];
};

/** A page of contacts plus its pagination. */
export type ContactPage = {
  items: ContactDto[];
  pagination: PaginationDto;
};

/** The contacts service: the only place that writes contacts (§4.4). */
export type ContactsService = {
  /** List the contacts of one organization. */
  list: (input: ListContactsInput) => Promise<ContactPage>;
  /** Create one contact and audit the change. */
  create: (input: CreateContactInput) => Promise<ContactDto>;
  /**
   * Create several contacts in a single transaction and audit every row.
   *
   * A failure in the middle of the batch rolls the whole batch back: a partial
   * import never happens (§4.4).
   */
  bulkCreate: (input: BulkCreateContactsInput) => Promise<ContactDto[]>;
};

/** Dependencies of {@link createContactsService}. */
export type ContactsServiceDeps = {
  /** Branch ownership rules, applied to every branch a payload references. */
  branches: BranchesService;
  /** Sink for the audit events written outside a transaction. */
  audit: AuditPort;
  /**
   * Handle the repositories run on. Defaults to the process-global proxy; the
   * app factory injects its own handle (TD-23).
   */
  db?: Database;
  /**
   * Sink for the audit events written inside a transaction.
   *
   * It receives the transaction so the audit rows are written inside it and
   * are rolled back with the batch they describe. Defaults to the database
   * repository bound to the transaction.
   */
  auditInTransaction?: (tx: Transaction) => AuditPort;
};

/**
 * Build the contacts service.
 *
 * The service owns the rules of the contacts domain: the branches a payload
 * references must belong to the tenant, the writes are transactional and
 * every mutation is audited. The routes only parse the request, call the
 * service and serialize the envelope (§4.4).
 */
export const createContactsService = (
  deps: ContactsServiceDeps,
): ContactsService => {
  const assertBranches = async (
    organizationId: string,
    branchIds: (string | null | undefined)[],
  ): Promise<void> => {
    for (const branchId of new Set(
      branchIds.filter((id): id is string => typeof id === "string"),
    )) {
      await deps.branches.assertBelongsToOrganization({
        organizationId,
        branchId,
      });
    }
  };

  const list: ContactsService["list"] = async (input) => {
    const result = await getContactsByOrganization({
      organizationId: input.organizationId,
      page: input.page,
      limit: input.limit,
      status: input.status,
      branchId: input.branchId,
      search: input.search,
      db: deps.db,
    });

    return {
      items: result.items.map(toContactDto),
      pagination: result.pagination,
    };
  };

  const create: ContactsService["create"] = async (input) => {
    // A contact without a branch belongs to the branch of the request.
    const branchId = input.contact.branchId ?? input.branchId;

    await assertBranches(input.organizationId, [branchId]);

    const row = await createContact({
      organizationId: input.organizationId,
      db: deps.db,
      branchId,
      name: input.contact.name,
      phone: input.contact.phone,
      email: input.contact.email,
      status: input.contact.status,
      optIn: input.contact.optIn,
      metadata: input.contact.metadata,
    });

    const dto = toContactDto(row);

    await deps.audit.record(
      contactEvent({
        action: "contact.created",
        organizationId: input.organizationId,
        actorId: input.actorId,
        contact: dto,
      }),
    );

    return dto;
  };

  const bulkCreate: ContactsService["bulkCreate"] = async (input) => {
    // A contact without a branch belongs to the branch of the request.
    const contacts = input.contacts.map((contact) => ({
      ...contact,
      branchId: contact.branchId ?? input.branchId,
    }));

    await assertBranches(
      input.organizationId,
      contacts.map((contact) => contact.branchId),
    );

    const rows = await withTransaction({
      organizationId: input.organizationId,
      db: deps.db,
      callback: async (tx) => {
        const inserted = await createContactsBulk({
          organizationId: input.organizationId,
          contacts: contacts.map((contact) => ({
            branchId: contact.branchId,
            name: contact.name,
            phone: contact.phone,
            email: contact.email,
            status: contact.status,
            optIn: contact.optIn,
            metadata: contact.metadata,
          })),
          tx,
        });

        // The audit rows are written inside the same transaction, so a rolled
        // back import never leaves audit events behind.
        const auditTx = deps.auditInTransaction
          ? deps.auditInTransaction(tx)
          : new DatabaseAuditRepository(tx);

        await auditTx.recordMany(
          inserted.map((row) =>
            contactEvent({
              action: "contact.created",
              organizationId: input.organizationId,
              actorId: input.actorId,
              contact: toContactDto(row),
            }),
          ),
        );

        return inserted;
      },
    });

    return rows.map(toContactDto);
  };

  return { list, create, bulkCreate };
};

/** Build the audit event of a contact mutation. */
const contactEvent = (input: {
  action: string;
  organizationId: string;
  actorId: string;
  contact: ContactDto;
}): AuditEvent => ({
  action: input.action,
  entityType: "contact",
  entityId: input.contact.id,
  actorId: input.actorId,
  organizationId: input.organizationId,
  changes: computeAuditDiff({}, input.contact),
  timestamp: new Date().toISOString(),
});
