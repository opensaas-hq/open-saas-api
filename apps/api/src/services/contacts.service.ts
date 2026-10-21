import {
  type AuditEvent,
  type AuditPort,
  NotFoundError,
  computeAuditDiff,
} from "@opensaas/core";
import {
  type ContactStatus,
  type Database,
  DatabaseAuditRepository,
  type Transaction,
  createContact,
  createContactsBulk,
  deleteContact,
  getContactById,
  getContactsByOrganization,
  updateContact,
  withTransaction,
} from "@opensaas/database";
import {
  type ContactDto,
  type CreateContactRequest,
  type PaginationDto,
  type UpdateContactRequest,
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

/** Options of {@link ContactsService.getById}. */
export type GetContactInput = {
  organizationId: string;
  id: string;
};

/** Options of {@link ContactsService.update}. */
export type UpdateContactInput = {
  organizationId: string;
  /** The user performing the change; recorded in the audit event. */
  actorId: string;
  id: string;
  contact: UpdateContactRequest;
};

/** Options of {@link ContactsService.remove}. */
export type RemoveContactInput = {
  organizationId: string;
  /** The user performing the change; recorded in the audit event. */
  actorId: string;
  id: string;
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
  /** Read one contact of one organization. */
  getById: (input: GetContactInput) => Promise<ContactDto>;
  /** Create one contact and audit the change. */
  create: (input: CreateContactInput) => Promise<ContactDto>;
  /** Update one contact and audit the change. */
  update: (input: UpdateContactInput) => Promise<ContactDto>;
  /** Delete one contact and audit the change. */
  remove: (input: RemoveContactInput) => Promise<void>;
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

  const getById: ContactsService["getById"] = async (input) => {
    const row = await getContactById({
      organizationId: input.organizationId,
      id: input.id,
      db: deps.db,
    });

    // A contact of another tenant is reported as missing: the response never
    // confirms that the id exists somewhere else (§4.3).
    if (!row) {
      throw new NotFoundError("Contact not found", {
        organizationId: input.organizationId,
        contactId: input.id,
      });
    }

    return toContactDto(row);
  };

  const update: ContactsService["update"] = async (input) => {
    // The branch of the payload, if any, must belong to the tenant.
    await assertBranches(input.organizationId, [input.contact.branchId]);

    // The previous state is read first, so the audit event carries the real
    // diff instead of the whole row.
    const before = await getById({
      organizationId: input.organizationId,
      id: input.id,
    });

    const row = await updateContact({
      organizationId: input.organizationId,
      id: input.id,
      db: deps.db,
      name: input.contact.name,
      phone: input.contact.phone,
      email: input.contact.email,
      branchId: input.contact.branchId,
      status: input.contact.status,
      optIn: input.contact.optIn,
      metadata: input.contact.metadata,
    });

    if (!row) {
      throw new NotFoundError("Contact not found", {
        organizationId: input.organizationId,
        contactId: input.id,
      });
    }

    const dto = toContactDto(row);

    await deps.audit.record(
      contactEvent({
        action: "contact.updated",
        organizationId: input.organizationId,
        actorId: input.actorId,
        contact: dto,
        previous: before,
      }),
    );

    return dto;
  };

  const remove: ContactsService["remove"] = async (input) => {
    const before = await getById({
      organizationId: input.organizationId,
      id: input.id,
    });

    const row = await deleteContact({
      organizationId: input.organizationId,
      id: input.id,
      db: deps.db,
    });

    if (!row) {
      throw new NotFoundError("Contact not found", {
        organizationId: input.organizationId,
        contactId: input.id,
      });
    }

    await deps.audit.record(
      contactEvent({
        action: "contact.deleted",
        organizationId: input.organizationId,
        actorId: input.actorId,
        contact: toContactDto(row),
        previous: before,
      }),
    );
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

  return { list, getById, create, update, remove, bulkCreate };
};

/** Build the audit event of a contact mutation. */
const contactEvent = (input: {
  action: string;
  organizationId: string;
  actorId: string;
  contact: ContactDto;
  /** The state before the mutation, when the event describes a change. */
  previous?: ContactDto;
}): AuditEvent => ({
  action: input.action,
  entityType: "contact",
  entityId: input.contact.id,
  actorId: input.actorId,
  organizationId: input.organizationId,
  changes: computeAuditDiff(input.previous ?? {}, input.contact),
  timestamp: new Date().toISOString(),
});
