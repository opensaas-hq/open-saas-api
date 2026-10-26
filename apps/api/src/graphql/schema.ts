import type { GraphQLSchema } from "graphql";
import { GraphQLScalarType, valueFromASTUntyped } from "graphql";
import { createSchema } from "graphql-yoga";
import type { GraphqlContext } from "./context";
import { createResolvers } from "./resolvers";

/** The scalar used by the `metadata` field of a contact. */
const jsonScalar = new GraphQLScalarType({
  name: "JSON",
  description: "An arbitrary JSON value.",
  serialize: (value) => value,
  parseValue: (value) => value,
  parseLiteral: (valueNode, variables) =>
    valueFromASTUntyped(valueNode, variables),
});

/**
 * The GraphQL schema of the CRM domain (§4.11).
 *
 * The schema covers contacts, branches and the active organization — the
 * surface the service layer owns. The auth domain stays REST-only (§4.1):
 * Better Auth is the single source of truth for sign-up, sign-in and
 * membership.
 */
export const typeDefs = /* GraphQL */ `
  "An arbitrary JSON value."
  scalar JSON

  "The lifecycle status of a contact."
  enum ContactStatus {
    ACTIVE
    LEAD
    CHURNED
  }

  "The organization the session is active on."
  type Organization {
    id: ID!
    name: String!
    slug: String!
    createdAt: String!
  }

  "A branch of the organization."
  type Branch {
    id: ID!
    name: String!
    createdAt: String!
  }

  "A contact of the organization."
  type Contact {
    id: ID!
    name: String!
    phone: String
    email: String
    branchId: ID
    status: ContactStatus!
    optIn: Boolean!
    metadata: JSON!
    createdAt: String!
    updatedAt: String!
  }

  "Pagination of a list of contacts."
  type PageInfo {
    page: Int!
    limit: Int!
    total: Int!
    totalPages: Int!
  }

  "A page of contacts."
  type ContactPage {
    items: [Contact!]!
    pagination: PageInfo!
  }

  "Narrowing of a contacts query."
  input ContactFilter {
    status: ContactStatus
    branchId: ID
    search: String
  }

  "Payload of a contact creation."
  input CreateContactInput {
    name: String!
    phone: String
    email: String
    branchId: ID
    status: ContactStatus = ACTIVE
    optIn: Boolean = true
    metadata: JSON
  }

  "Payload of a partial contact update; absent fields are not written."
  input UpdateContactInput {
    name: String
    phone: String
    email: String
    branchId: ID
    status: ContactStatus
    optIn: Boolean
    metadata: JSON
  }

  "Payload of a branch creation."
  input CreateBranchInput {
    name: String!
  }

  "Payload of a branch update."
  input UpdateBranchInput {
    name: String!
  }

  "Result of a contact deletion."
  type DeleteContactPayload {
    id: ID!
  }

  "Result of a branch deletion."
  type DeleteBranchPayload {
    id: ID!
  }

  "Result of a bulk import."
  type ImportContactsPayload {
    count: Int!
    contacts: [Contact!]!
  }

  type Query {
    "The organization the session is active on."
    organization: Organization!
    "One contact of the organization, or null plus a NOT_FOUND error."
    contact(id: ID!): Contact
    "A page of the contacts of the organization."
    contacts(page: Int = 1, limit: Int = 20, filter: ContactFilter): ContactPage!
    "One branch of the organization, or null plus a NOT_FOUND error."
    branch(id: ID!): Branch
    "The branches of the organization."
    branches: [Branch!]!
  }

  type Mutation {
    "Create a contact."
    createContact(input: CreateContactInput!): Contact!
    "Update a contact; absent fields are not written."
    updateContact(id: ID!, input: UpdateContactInput!): Contact!
    "Delete a contact."
    deleteContact(id: ID!): DeleteContactPayload!
    "Import several contacts in one transaction."
    importContacts(
      contacts: [CreateContactInput!]!
      branchId: ID
    ): ImportContactsPayload!
    "Create a branch."
    createBranch(input: CreateBranchInput!): Branch!
    "Rename a branch."
    updateBranch(id: ID!, input: UpdateBranchInput!): Branch!
    "Delete a branch."
    deleteBranch(id: ID!): DeleteBranchPayload!
  }
`;

/**
 * Build the executable schema.
 *
 * The resolvers and the SDL are the two halves of the same contract: the SDL
 * snapshot is committed and drift-checked in CI, and the resolvers delegate
 * every operation to a service (§4.11).
 */
export const createGraphqlSchema = (): GraphQLSchema =>
  createSchema<GraphqlContext>({
    typeDefs,
    resolvers: {
      JSON: jsonScalar,
      ...createResolvers(),
    },
  });
