import { describe, expect, test } from "bun:test";
import {
  createBranch,
  deleteBranch,
  listBranches,
  updateBranch,
} from "../repositories/branch";
import { createOrganization } from "../repositories/organization";
import { useTestDatabase } from "./setup";

useTestDatabase();

const createOrg = async (suffix: string, label: string) => {
  const id = `org_${label}_${suffix}`;
  await createOrganization({ id, name: label, slug: `${label}-${suffix}` });
  return id;
};

const required = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error("expected a row");
  return value;
};

describe("@opensaas/database - Branch repository", () => {
  const suffix = Date.now().toString();

  test("creates and lists branches scoped to an organization", async () => {
    const orgId = await createOrg(suffix, "branchorg");
    await createBranch({ organizationId: orgId, name: "Main" });
    await createBranch({ organizationId: orgId, name: "Second" });

    const list = await listBranches({ organizationId: orgId });

    expect(list).toHaveLength(2);
    expect(list.map((b) => b.name).sort()).toEqual(["Main", "Second"]);
  });

  test("isolation: a branch is invisible to another organization", async () => {
    const orgA = await createOrg(suffix, "branchisoA");
    const orgB = await createOrg(suffix, "branchisoB");

    await createBranch({ organizationId: orgA, name: "A only" });

    const listB = await listBranches({ organizationId: orgB });
    expect(listB).toHaveLength(0);
  });

  test("update is scoped by organization and cannot touch another tenant", async () => {
    const orgA = await createOrg(suffix, "branchupdA");
    const orgB = await createOrg(suffix, "branchupdB");

    const branch = required(
      await createBranch({ organizationId: orgA, name: "Orig" }),
    );

    // A cross-tenant update matches nothing.
    const stolen = await updateBranch({
      organizationId: orgB,
      id: branch.id,
      name: "Hacked",
    });
    expect(stolen).toBeUndefined();

    const listA = await listBranches({ organizationId: orgA });
    expect(listA[0]?.name).toBe("Orig");

    // The owning tenant can update it.
    const updated = await updateBranch({
      organizationId: orgA,
      id: branch.id,
      name: "Renamed",
    });
    expect(updated?.name).toBe("Renamed");
  });

  test("delete is scoped by organization", async () => {
    const orgA = await createOrg(suffix, "branchdelA");
    const orgB = await createOrg(suffix, "branchdelB");

    const branch = required(
      await createBranch({ organizationId: orgA, name: "Temp" }),
    );

    const notFound = await deleteBranch({
      organizationId: orgB,
      id: branch.id,
    });
    expect(notFound).toBeUndefined();

    const deleted = await deleteBranch({
      organizationId: orgA,
      id: branch.id,
    });
    expect(deleted?.id).toBe(branch.id);
    expect(await listBranches({ organizationId: orgA })).toHaveLength(0);
  });
});
