import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Lifecycle status of a contact. A `pgEnum` (rather than free-form text) makes
 * an invalid value a database-level error, not a silent application bug.
 */
export const contactStatus = pgEnum("contact_status", [
  "active",
  "lead",
  "churned",
]);

/** Type of a contact status, derived from the enum (single source of truth). */
export type ContactStatus = (typeof contactStatus.enumValues)[number];

/**
 * Better Auth - Core User Table
 */
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Better Auth - Sessions Table (Con Telemetría & Fingerprint Avanzado)
 */
export const session = pgTable("session", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .references(() => user.id, { onDelete: "cascade" })
    .notNull(),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  activeOrganizationId: text("active_organization_id"),

  // 🌐 Network & Basic Telemetry
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),

  // 💻 Extracted Fingerprint & Client Device Specs
  browser: text("browser"), // e.g., "Chrome 122"
  os: text("os"), // e.g., "macOS 14.3"
  deviceType: text("device_type"), // e.g., "desktop", "mobile", "tablet"
  language: text("language"), // e.g., "es-MX", "en-US"
  timezone: text("timezone"), // e.g., "America/Mexico_City"

  // 📍 Geo-location (Proporcionado por Cloudflare / Headers de Proxy)
  country: text("country"), // e.g., "MX"
  city: text("city"), // e.g., "Mexico City"

  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Better Auth - Accounts Table (OAuth & Credentials)
 */
export const account = pgTable("account", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .references(() => user.id, { onDelete: "cascade" })
    .notNull(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", {
    withTimezone: true,
  }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
    withTimezone: true,
  }),
  scope: text("scope"),
  password: text("password"),
  idToken: text("id_token"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Better Auth - Verifications Table
 */
export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

/**
 * Better Auth - Organization Plugin Table
 */
export const organization = pgTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Better Auth - Member Plugin Table
 */
export const member = pgTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .references(() => organization.id, { onDelete: "cascade" })
      .notNull(),
    userId: text("user_id")
      .references(() => user.id, { onDelete: "cascade" })
      .notNull(),
    role: text("role").default("member").notNull(), // owner, admin, member
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // Tenant-scoped membership lookups (§4.3 cache, RLS in §2.5).
    index("member_organization_id_user_id_idx").on(
      table.organizationId,
      table.userId,
    ),
  ],
);

/**
 * Better Auth - Invitation Plugin Table
 */
export const invitation = pgTable("invitation", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .references(() => organization.id, { onDelete: "cascade" })
    .notNull(),
  email: text("email").notNull(),
  role: text("role"),
  status: text("status").notNull(), // pending, accepted, etc.
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  inviterId: text("inviter_id")
    .references(() => user.id, { onDelete: "cascade" })
    .notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Custom Business Logic - Branches
 */
export const branches = pgTable("branches", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: text("organization_id")
    .references(() => organization.id, { onDelete: "cascade" })
    .notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Custom Business Logic - Contacts (CRM Base)
 */
export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .references(() => organization.id, { onDelete: "cascade" })
      .notNull(),
    branchId: uuid("branch_id").references(() => branches.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    status: contactStatus("status").default("active").notNull(),
    optIn: boolean("opt_in").default(true).notNull(),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    // Makes the tenant-filtered list query cheap (§2.2 AC1).
    index("contacts_organization_id_status_idx").on(
      table.organizationId,
      table.status,
    ),
    index("contacts_organization_id_branch_id_idx").on(
      table.organizationId,
      table.branchId,
    ),
    // A contact email is unique per organization, but only when present.
    uniqueIndex("contacts_organization_id_email_idx")
      .on(table.organizationId, table.email)
      .where(sql`${table.email} IS NOT NULL`),
  ],
);

/**
 * Append-only audit trail: who did what, to which entity, within which tenant.
 * The `jsonb` diff is produced by `@opensaas/core`'s audit helpers and this
 * table is written through `repositories/audit.ts`, which implements the
 * `AuditPort` interface (§1.6, §2.2).
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    actorId: text("actor_id").notNull(),
    organizationId: text("organization_id").notNull(),
    changes: jsonb("changes"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("audit_log_organization_id_created_at_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    index("audit_log_entity_type_entity_id_idx").on(
      table.entityType,
      table.entityId,
    ),
  ],
);
