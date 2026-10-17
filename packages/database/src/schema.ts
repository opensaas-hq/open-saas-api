import {
  boolean,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Organizations table (Main multi-tenant entity representing a business/workspace)
 */
export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Branches table (Optional physical locations or sub-units belonging to an organization)
 */
export const branches = pgTable("branches", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Contacts table (Base CRM entity, sector-agnostic with built-in consent/DND tracking)
 */
export const contacts = pgTable("contacts", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),
  branchId: uuid("branch_id").references(() => branches.id, {
    onDelete: "set null",
  }),
  name: text("name").notNull(),
  phone: text("phone"),
  email: text("email"),
  status: text("status").default("active").notNull(), // active, lead, churned
  optIn: boolean("opt_in").default(true).notNull(), // Consent / DND management
  metadata: jsonb("metadata").default({}).notNull(), // Flexible custom fields
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
