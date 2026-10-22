import { fromZodError } from "@opensaas/core";
import type { ZodType, z } from "zod";
import type { BranchDto } from "../dto/branches";
import {
  branchIdParamSchema,
  createBranchRequestSchema,
  updateBranchRequestSchema,
} from "../dto/branches";
import type { ContactDto, PaginationDto } from "../dto/contacts";
import {
  contactIdParamSchema,
  contactsQuerySchema,
  createBulkContactsRequestSchema,
  createContactRequestSchema,
  updateContactRequestSchema,
} from "../dto/contacts";
import type { OrganizationDto } from "../dto/organizations";
import type { GraphqlContext } from "./context";
import { run } from "./errors";
import { authorize } from "./guards";
import { type ContactView, presentContact, statusFromView } from "./presenters";

/** A create-contact input as GraphQL delivers it. */
type CreateContactInput = {
  name: string;
  phone?: string | null;
  email?: string | null;
  branchId?: string | null;
  status?: string | null;
  optIn?: boolean | null;
  metadata?: unknown;
};

/** An update-contact input as GraphQL delivers it. */
type UpdateContactInput = {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  branchId?: string | null;
  status?: string | null;
  optIn?: boolean | null;
  metadata?: unknown;
};

/** Signature of a resolver: the services, never a repository, are in reach. */
type Resolver<TArgs, TResult> = (
  parent: unknown,
  args: TArgs,
  context: GraphqlContext,
) => Promise<TResult>;

/**
 * Validate a resolver argument with the very same schema the REST route uses.
 *
 * A validation failure is turned into the shared `ValidationError`, so the
 * GraphQL error carries the same `VALIDATION_ERROR` code and the same
 * `fieldErrors` as the REST envelope (§4.11).
 */
const parse = <S extends ZodType>(schema: S, value: unknown): z.infer<S> => {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw fromZodError(result.error, "The request is invalid");
  }

  return result.data;
};

/** Build the payload of a contact creation from a GraphQL input. */
const toCreateContactPayload = (input: CreateContactInput) => ({
  name: input.name,
  phone: input.phone ?? undefined,
  email: input.email ?? undefined,
  branchId: input.branchId ?? undefined,
  status: statusFromView(input.status),
  optIn: input.optIn ?? undefined,
  metadata: input.metadata ?? undefined,
});

/**
 * Build the payload of a partial update.
 *
 * An explicit `null` is kept, so the shared schema decides what it means: a
 * null is only accepted where the column is nullable, exactly like REST.
 */
const toUpdateContactPayload = (input: UpdateContactInput) => ({
  ...input,
  ...(input.status === null || input.status === undefined
    ? {}
    : { status: statusFromView(input.status) }),
});

/**
 * The resolvers of the CRM schema (§4.11).
 *
 * Every resolver delegates to the service layer: no repository, no SQL and no
 * second authorization path. The permission of a mutation is the same entry
 * of the matrix the REST route uses.
 */
export const createResolvers = () => ({
  Query: {
    organization: (async (_parent, _args, context) =>
      run(context.logger, async () =>
        context.services.organizations.getById({
          organizationId: context.tenant.organizationId,
        }),
      )) satisfies Resolver<Record<string, never>, OrganizationDto>,

    contact: (async (_parent, args: { id: string }, context) =>
      run(context.logger, async () =>
        presentContact(
          await context.services.contacts.getById({
            organizationId: context.tenant.organizationId,
            id: parse(contactIdParamSchema, args).id,
          }),
        ),
      )) satisfies Resolver<{ id: string }, ContactView>,

    contacts: (async (
      _parent,
      args: {
        page?: number | null;
        limit?: number | null;
        filter?: {
          status?: string | null;
          branchId?: string | null;
          search?: string | null;
        } | null;
      },
      context,
    ) =>
      run(context.logger, async () => {
        const query = parse(contactsQuerySchema, {
          page: args.page ?? undefined,
          limit: args.limit ?? undefined,
          status: statusFromView(args.filter?.status),
          branchId: args.filter?.branchId ?? undefined,
          search: args.filter?.search ?? undefined,
        });

        const page = await context.services.contacts.list({
          organizationId: context.tenant.organizationId,
          ...query,
        });

        return {
          items: page.items.map(presentContact),
          pagination: page.pagination,
        };
      })) satisfies Resolver<
      Record<string, unknown>,
      { items: ContactView[]; pagination: PaginationDto }
    >,

    branch: (async (_parent, args: { id: string }, context) =>
      run(context.logger, async () =>
        context.services.branches.getById({
          organizationId: context.tenant.organizationId,
          id: parse(branchIdParamSchema, args).id,
        }),
      )) satisfies Resolver<{ id: string }, BranchDto>,

    branches: (async (_parent, _args, context) =>
      run(context.logger, async () =>
        context.services.branches.list({
          organizationId: context.tenant.organizationId,
        }),
      )) satisfies Resolver<Record<string, never>, BranchDto[]>,
  },

  Mutation: {
    createContact: (async (
      _parent,
      args: { input: CreateContactInput },
      context,
    ) =>
      run(context.logger, async () => {
        authorize(context, "contacts:write");

        return presentContact(
          await context.services.contacts.create({
            organizationId: context.tenant.organizationId,
            actorId: context.user.id,
            branchId: context.tenant.branchId,
            contact: parse(
              createContactRequestSchema,
              toCreateContactPayload(args.input),
            ),
          }),
        );
      })) satisfies Resolver<{ input: CreateContactInput }, ContactView>,

    updateContact: (async (
      _parent,
      args: { id: string; input: UpdateContactInput },
      context,
    ) =>
      run(context.logger, async () => {
        authorize(context, "contacts:write");

        return presentContact(
          await context.services.contacts.update({
            organizationId: context.tenant.organizationId,
            actorId: context.user.id,
            id: parse(contactIdParamSchema, args).id,
            contact: parse(
              updateContactRequestSchema,
              toUpdateContactPayload(args.input),
            ),
          }),
        );
      })) satisfies Resolver<
      { id: string; input: UpdateContactInput },
      ContactView
    >,

    deleteContact: (async (_parent, args: { id: string }, context) =>
      run(context.logger, async () => {
        authorize(context, "contacts:delete");

        const { id } = parse(contactIdParamSchema, args);

        await context.services.contacts.remove({
          organizationId: context.tenant.organizationId,
          actorId: context.user.id,
          id,
        });

        return { id };
      })) satisfies Resolver<{ id: string }, { id: string }>,

    importContacts: (async (
      _parent,
      args: { contacts: CreateContactInput[]; branchId?: string | null },
      context,
    ) =>
      run(context.logger, async () => {
        authorize(context, "contacts:bulk");

        const { contacts } = parse(
          createBulkContactsRequestSchema(context.env.BULK_MAX_CONTACTS),
          { contacts: args.contacts.map(toCreateContactPayload) },
        );

        const created = await context.services.contacts.bulkCreate({
          organizationId: context.tenant.organizationId,
          actorId: context.user.id,
          branchId: args.branchId ?? context.tenant.branchId,
          contacts,
        });

        return {
          count: created.length,
          contacts: created.map(presentContact),
        };
      })) satisfies Resolver<
      { contacts: CreateContactInput[]; branchId?: string | null },
      { count: number; contacts: ContactView[] }
    >,

    createBranch: (async (
      _parent,
      args: { input: { name: string } },
      context,
    ) =>
      run(context.logger, async () => {
        authorize(context, "branches:write");

        const { name } = parse(createBranchRequestSchema, args.input);

        return await context.services.branches.create({
          organizationId: context.tenant.organizationId,
          actorId: context.user.id,
          name,
        });
      })) satisfies Resolver<{ input: { name: string } }, BranchDto>,

    updateBranch: (async (
      _parent,
      args: { id: string; input: { name: string } },
      context,
    ) =>
      run(context.logger, async () => {
        authorize(context, "branches:write");

        return await context.services.branches.update({
          organizationId: context.tenant.organizationId,
          actorId: context.user.id,
          id: parse(branchIdParamSchema, args).id,
          name: parse(updateBranchRequestSchema, args.input).name,
        });
      })) satisfies Resolver<
      { id: string; input: { name: string } },
      BranchDto
    >,

    deleteBranch: (async (_parent, args: { id: string }, context) =>
      run(context.logger, async () => {
        authorize(context, "branches:write");

        const { id } = parse(branchIdParamSchema, args);

        await context.services.branches.remove({
          organizationId: context.tenant.organizationId,
          actorId: context.user.id,
          id,
        });

        return { id };
      })) satisfies Resolver<{ id: string }, { id: string }>,
  },
});
