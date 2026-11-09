import { readFileSync } from "node:fs";
import path from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  addDoc,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const PROJECT_ID = "demo-salespilot";
const ORG_A = "orgA";
const ORG_B = "orgB";
const ORG_C = "orgC";
const BUSINESS = ["customers", "products", "categories", "inventory", "agents"] as const;
const LOCKED = [
  "rateLimits",
  "auditLogs",
  "customerPhones",
  "productSkus",
  "productSlugs",
  "categoryNames",
  "uploads",
  "agentSessions",
  "conversations",
] as const;
const ROLES = ["owner", "admin", "agent", "viewer"] as const;

let testEnv: RulesTestEnvironment;

function emulatorHostPort(): { host: string; port: number } {
  const raw = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8085";
  const idx = raw.lastIndexOf(":");
  return { host: raw.slice(0, idx), port: Number(raw.slice(idx + 1)) };
}

beforeAll(async () => {
  const { host, port } = emulatorHostPort();
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host,
      port,
      rules: readFileSync(path.resolve(import.meta.dirname, "../../firestore.rules"), "utf8"),
    },
  });
});

afterAll(async () => {
  if (!testEnv) return;
  await testEnv.clearFirestore();
  await testEnv.cleanup();
});

const member = (organizationId: string, uid: string, role: string) => ({
  organizationId,
  uid,
  role,
  email: `${uid}@example.com`,
  createdAt: 1,
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const seed = (p: string, data: Record<string, unknown>) => setDoc(doc(db, p), data);

    for (const org of [ORG_A, ORG_B, ORG_C]) {
      await seed(`organizations/${org}`, { name: org, ownerUid: `owner${org}`, createdAt: 1 });
    }
    // Org A: one member per role. Org B / C: owners (and an agent in B).
    for (const role of ROLES) {
      const uid = `${role}A`;
      await seed(`users/${uid}`, {
        uid,
        email: `${uid}@example.com`,
        defaultOrganizationId: ORG_A,
      });
      await seed(`organizationMembers/${ORG_A}_${uid}`, member(ORG_A, uid, role));
    }
    await seed("users/ownerB", { uid: "ownerB", email: "ownerB@example.com" });
    await seed(`organizationMembers/${ORG_B}_ownerB`, member(ORG_B, "ownerB", "owner"));
    await seed(`organizationMembers/${ORG_B}_agentB`, member(ORG_B, "agentB", "agent"));
    await seed(`organizationMembers/${ORG_C}_ownerC`, member(ORG_C, "ownerC", "owner"));
    // multi: agent in A and viewer in B, nothing in C.
    await seed(`organizationMembers/${ORG_A}_multi`, member(ORG_A, "multi", "agent"));
    await seed(`organizationMembers/${ORG_B}_multi`, member(ORG_B, "multi", "viewer"));
    // weird: member doc with an unknown role string; norole: no role field at all.
    await seed(`organizationMembers/${ORG_A}_weird`, member(ORG_A, "weird", "superuser"));
    await seed(`organizationMembers/${ORG_A}_norole`, {
      organizationId: ORG_A,
      uid: "norole",
      email: "x@example.com",
    });

    for (const col of BUSINESS) {
      await seed(`${col}/${col}-A1`, { organizationId: ORG_A, name: `${col} A1` });
      await seed(`${col}/${col}-A2`, { organizationId: ORG_A, name: `${col} A2` });
      await seed(`${col}/${col}-B1`, { organizationId: ORG_B, name: `${col} B1` });
      await seed(`${col}/${col}-C1`, { organizationId: ORG_C, name: `${col} C1` });
      await seed(`${col}/${col}-noorg`, { name: "no org field" });
      await seed(`${col}/${col}-badorg`, { organizationId: 123, name: "non-string org" });
    }
    await seed("inventory/inventory-A1/reservations/r1", { organizationId: ORG_A, qty: 1 });
    await seed("inventory/inventory-B1/reservations/r1", { organizationId: ORG_B, qty: 1 });
    await seed("agentSessions/doc1/messages/m1", { organizationId: ORG_A, role: "user" });
    await seed("conversations/doc1/messages/m1", { organizationId: ORG_A, text: "hello" });
    for (const col of LOCKED) {
      await seed(`${col}/doc1`, { organizationId: ORG_A, v: 1 });
    }
    await seed("somethingElse/doc1", { organizationId: ORG_A });
  });
});

type Db = ReturnType<RulesTestContext["firestore"]>;
const as = (uid: string | null): Db =>
  (uid === null ? testEnv.unauthenticatedContext() : testEnv.authenticatedContext(uid)).firestore();

describe("org members read their own org business data", () => {
  for (const col of BUSINESS) {
    it(`${col}: every role of org A can get an org A doc`, async () => {
      for (const role of ROLES) {
        await assertSucceeds(getDoc(doc(as(`${role}A`), `${col}/${col}-A1`)));
      }
    });

    it(`${col}: org A member cannot get docs of org B or C`, async () => {
      for (const role of ROLES) {
        await assertFails(getDoc(doc(as(`${role}A`), `${col}/${col}-B1`)));
        await assertFails(getDoc(doc(as(`${role}A`), `${col}/${col}-C1`)));
      }
    });

    it(`${col}: docs without a valid organizationId are unreadable`, async () => {
      await assertFails(getDoc(doc(as("ownerA"), `${col}/${col}-noorg`)));
      await assertFails(getDoc(doc(as("ownerA"), `${col}/${col}-badorg`)));
    });

    it(`${col}: constrained query allowed, unconstrained or foreign denied`, async () => {
      const own = await assertSucceeds(
        getDocs(query(collection(as("viewerA"), col), where("organizationId", "==", ORG_A))),
      );
      expect(own.size).toBe(2);
      await assertFails(getDocs(collection(as("viewerA"), col)));
      await assertFails(
        getDocs(query(collection(as("viewerA"), col), where("organizationId", "==", ORG_B))),
      );
      await assertFails(
        getDocs(
          query(collection(as("viewerA"), col), where("organizationId", "in", [ORG_A, ORG_B])),
        ),
      );
      await assertFails(getDocs(query(collection(as("viewerA"), col), where("name", "==", "x"))));
    });

    it(`${col}: non-member and unauthenticated cannot read`, async () => {
      for (const uid of ["outsider", null]) {
        await assertFails(getDoc(doc(as(uid), `${col}/${col}-A1`)));
        await assertFails(
          getDocs(query(collection(as(uid), col), where("organizationId", "==", ORG_A))),
        );
        await assertFails(getDocs(collection(as(uid), col)));
      }
    });

    it(`${col}: collection group query denied`, async () => {
      await assertFails(getDocs(collectionGroup(as("ownerA"), col)));
      await assertFails(
        getDocs(query(collectionGroup(as("ownerA"), col), where("organizationId", "==", ORG_A))),
      );
    });
  }
});

describe("multi-org membership", () => {
  it("a member of A and B reads both but never C", async () => {
    const db = as("multi");
    await assertSucceeds(getDoc(doc(db, "customers/customers-A1")));
    await assertSucceeds(getDoc(doc(db, "customers/customers-B1")));
    await assertFails(getDoc(doc(db, "customers/customers-C1")));
    await assertSucceeds(getDoc(doc(db, `organizations/${ORG_A}`)));
    await assertSucceeds(getDoc(doc(db, `organizations/${ORG_B}`)));
    await assertFails(getDoc(doc(db, `organizations/${ORG_C}`)));
    await assertFails(getDocs(collection(db, "customers")));
    await assertSucceeds(
      getDocs(query(collection(db, "customers"), where("organizationId", "==", ORG_B))),
    );
    await assertFails(
      getDocs(query(collection(db, "customers"), where("organizationId", "==", ORG_C))),
    );
  });

  it("A token never reads C even when members of C exist", async () => {
    await assertFails(getDoc(doc(as("ownerA"), `organizationMembers/${ORG_C}_ownerC`)));
    await assertFails(getDoc(doc(as("ownerA"), `organizations/${ORG_C}`)));
  });
});

describe("organizations", () => {
  it("members of every role read their org", async () => {
    for (const role of ROLES) {
      await assertSucceeds(getDoc(doc(as(`${role}A`), `organizations/${ORG_A}`)));
    }
  });
  it("members cannot read another org; outsider and anon cannot read any", async () => {
    await assertFails(getDoc(doc(as("ownerA"), `organizations/${ORG_B}`)));
    await assertFails(getDoc(doc(as("outsider"), `organizations/${ORG_A}`)));
    await assertFails(getDoc(doc(as(null), `organizations/${ORG_A}`)));
    await assertFails(getDocs(collection(as("ownerA"), "organizations")));
  });
});

describe("organizationMembers", () => {
  it("a member reads their own member doc", async () => {
    for (const role of ROLES) {
      await assertSucceeds(getDoc(doc(as(`${role}A`), `organizationMembers/${ORG_A}_${role}A`)));
    }
    await assertSucceeds(
      getDocs(
        query(collection(as("viewerA"), "organizationMembers"), where("uid", "==", "viewerA")),
      ),
    );
  });
  it("owner/admin read other members of the same org", async () => {
    for (const uid of ["ownerA", "adminA"]) {
      await assertSucceeds(getDoc(doc(as(uid), `organizationMembers/${ORG_A}_agentA`)));
      await assertSucceeds(getDoc(doc(as(uid), `organizationMembers/${ORG_A}_viewerA`)));
      const snap = await assertSucceeds(
        getDocs(
          query(collection(as(uid), "organizationMembers"), where("organizationId", "==", ORG_A)),
        ),
      );
      expect(snap.size).toBeGreaterThan(3);
    }
  });
  it("agent/viewer cannot read other members of the same org", async () => {
    for (const uid of ["agentA", "viewerA"]) {
      await assertFails(getDoc(doc(as(uid), `organizationMembers/${ORG_A}_ownerA`)));
      await assertFails(getDoc(doc(as(uid), `organizationMembers/${ORG_A}_adminA`)));
      await assertFails(
        getDocs(
          query(collection(as(uid), "organizationMembers"), where("organizationId", "==", ORG_A)),
        ),
      );
      await assertFails(getDocs(collection(as(uid), "organizationMembers")));
    }
    await assertFails(getDoc(doc(as("agentA"), `organizationMembers/${ORG_A}_viewerA`)));
    await assertFails(getDoc(doc(as("viewerA"), `organizationMembers/${ORG_A}_agentA`)));
  });
  it("nobody reads member docs cross-org", async () => {
    await assertFails(getDoc(doc(as("ownerA"), `organizationMembers/${ORG_B}_ownerB`)));
    await assertFails(getDoc(doc(as("ownerA"), `organizationMembers/${ORG_B}_agentB`)));
    await assertFails(
      getDocs(
        query(
          collection(as("ownerA"), "organizationMembers"),
          where("organizationId", "==", ORG_B),
        ),
      ),
    );
    await assertFails(getDoc(doc(as("outsider"), `organizationMembers/${ORG_A}_ownerA`)));
    await assertFails(getDoc(doc(as(null), `organizationMembers/${ORG_A}_ownerA`)));
    // multi is only an agent in A: owner of A may read multi's A doc but not multi's B doc.
    await assertSucceeds(getDoc(doc(as("ownerA"), `organizationMembers/${ORG_A}_multi`)));
    await assertFails(getDoc(doc(as("ownerA"), `organizationMembers/${ORG_B}_multi`)));
    await assertSucceeds(getDoc(doc(as("multi"), `organizationMembers/${ORG_B}_multi`)));
  });
  it("a member of A who is a non-admin in B cannot use B's member docs", async () => {
    await assertFails(getDoc(doc(as("multi"), `organizationMembers/${ORG_B}_ownerB`)));
    await assertFails(getDoc(doc(as("multi"), `organizationMembers/${ORG_A}_ownerA`)));
  });
});

describe("users", () => {
  it("readable only by that uid", async () => {
    await assertSucceeds(getDoc(doc(as("ownerA"), "users/ownerA")));
    await assertFails(getDoc(doc(as("ownerA"), "users/adminA")));
    await assertFails(getDoc(doc(as("adminA"), "users/ownerA")));
    await assertFails(getDoc(doc(as("outsider"), "users/ownerA")));
    await assertFails(getDoc(doc(as(null), "users/ownerA")));
    await assertFails(getDocs(collection(as("ownerA"), "users")));
  });
});

describe("unknown or missing role grants nothing", () => {
  for (const uid of ["weird", "norole"]) {
    it(`${uid}: cannot read business data, org or members`, async () => {
      const db = as(uid);
      for (const col of BUSINESS) {
        await assertFails(getDoc(doc(db, `${col}/${col}-A1`)));
        await assertFails(
          getDocs(query(collection(db, col), where("organizationId", "==", ORG_A))),
        );
      }
      await assertFails(getDoc(doc(db, `organizations/${ORG_A}`)));
      // Not an admin: cannot read other members' docs. (Own doc is readable; it is the user's own record.)
      await assertFails(getDoc(doc(db, `organizationMembers/${ORG_A}_ownerA`)));
      await assertFails(getDoc(doc(db, `organizationMembers/${ORG_A}_agentA`)));
    });
  }
});

describe("locked collections are unreadable and unwritable, even by owners", () => {
  const readers = ["ownerA", "adminA", "agentA", "viewerA", "outsider", null];

  for (const col of LOCKED) {
    it(`${col}: no client read`, async () => {
      for (const uid of readers) {
        await assertFails(getDoc(doc(as(uid), `${col}/doc1`)));
        await assertFails(getDocs(collection(as(uid), col)));
        await assertFails(
          getDocs(query(collection(as(uid), col), where("organizationId", "==", ORG_A))),
        );
      }
    });
  }

  it("reservations: no client read, direct or collection group", async () => {
    for (const uid of readers) {
      await assertFails(getDoc(doc(as(uid), "inventory/inventory-A1/reservations/r1")));
      await assertFails(getDocs(collection(as(uid), "inventory/inventory-A1/reservations")));
    }
    await assertFails(getDocs(collectionGroup(as("ownerA"), "reservations")));
    await assertFails(
      getDocs(
        query(collectionGroup(as("ownerA"), "reservations"), where("organizationId", "==", ORG_A)),
      ),
    );
  });

  it("agentSessions messages: no client read, direct, listed or collection group", async () => {
    for (const uid of readers) {
      await assertFails(getDoc(doc(as(uid), "agentSessions/doc1/messages/m1")));
      await assertFails(getDocs(collection(as(uid), "agentSessions/doc1/messages")));
    }
    await assertFails(getDocs(collectionGroup(as("ownerA"), "messages")));
    await assertFails(
      getDocs(
        query(collectionGroup(as("ownerA"), "messages"), where("organizationId", "==", ORG_A)),
      ),
    );
  });

  it("unknown collections: no client read or write", async () => {
    for (const uid of readers) {
      await assertFails(getDoc(doc(as(uid), "somethingElse/doc1")));
      await assertFails(getDocs(collection(as(uid), "somethingElse")));
      await assertFails(setDoc(doc(as(uid), "somethingElse/new"), { a: 1 }));
    }
  });
});

describe("no client can write anything", () => {
  const actors: Array<[string, string | null]> = [
    ["owner", "ownerA"],
    ["admin", "adminA"],
    ["agent", "agentA"],
    ["viewer", "viewerA"],
    ["multi-org member", "multi"],
    ["unknown-role member", "weird"],
    ["non-member", "outsider"],
    ["unauthenticated", null],
  ];

  // Existing docs (all seeded) plus a brand-new path in each collection.
  const existing = [
    ...BUSINESS.map((c) => `${c}/${c}-A1`),
    ...LOCKED.map((c) => `${c}/doc1`),
    "inventory/inventory-A1/reservations/r1",
    "agentSessions/doc1/messages/m1",
    "conversations/doc1/messages/m1",
    `organizations/${ORG_A}`,
    `organizationMembers/${ORG_A}_viewerA`,
    "users/ownerA",
    "somethingElse/doc1",
  ];
  const fresh = [
    ...BUSINESS.map((c) => `${c}/new-doc`),
    ...LOCKED.map((c) => `${c}/new-doc`),
    "inventory/inventory-A1/reservations/new-doc",
    "agentSessions/doc1/messages/new-doc",
    "conversations/doc1/messages/new-doc",
    "organizations/newOrg",
    "organizationMembers/newOrg_x",
    "users/newUser",
  ];

  for (const [label, uid] of actors) {
    it(`${label}: create, update and delete are all denied`, async () => {
      const db = as(uid);
      for (const p of fresh) {
        await assertFails(setDoc(doc(db, p), { organizationId: ORG_A, name: "x" }));
      }
      for (const p of existing) {
        await assertFails(setDoc(doc(db, p), { organizationId: ORG_A, name: "x" }));
        await assertFails(setDoc(doc(db, p), { name: "merge" }, { merge: true }));
        await assertFails(updateDoc(doc(db, p), { name: "changed" }));
        await assertFails(deleteDoc(doc(db, p)));
      }
      for (const col of BUSINESS) {
        await assertFails(addDoc(collection(db, col), { organizationId: ORG_A, name: "x" }));
      }
    });
  }

  it("changing organizationId on an existing doc is denied for every role", async () => {
    for (const role of ROLES) {
      const db = as(`${role}A`);
      for (const col of BUSINESS) {
        await assertFails(updateDoc(doc(db, `${col}/${col}-A1`), { organizationId: ORG_B }));
        await assertFails(updateDoc(doc(db, `${col}/${col}-B1`), { organizationId: ORG_A }));
        await assertFails(
          setDoc(doc(db, `${col}/${col}-B1`), { organizationId: ORG_A, name: "steal" }),
        );
      }
    }
  });

  it("forged memberships cannot be created, or escalated", async () => {
    await assertFails(
      setDoc(
        doc(as("outsider"), `organizationMembers/${ORG_A}_outsider`),
        member(ORG_A, "outsider", "owner"),
      ),
    );
    await assertFails(
      setDoc(
        doc(as("outsider"), `organizationMembers/${ORG_B}_outsider`),
        member(ORG_B, "outsider", "owner"),
      ),
    );
    await assertFails(
      updateDoc(doc(as("viewerA"), `organizationMembers/${ORG_A}_viewerA`), { role: "owner" }),
    );
    await assertFails(
      setDoc(
        doc(as("ownerA"), `organizationMembers/${ORG_B}_ownerA`),
        member(ORG_B, "ownerA", "owner"),
      ),
    );
    await assertFails(
      setDoc(doc(as("ownerA"), `organizations/${ORG_B}`), { name: "mine", ownerUid: "ownerA" }),
    );
  });

  it("denied writes did not mutate seeded data", async () => {
    const db = as("ownerA");
    await assertFails(updateDoc(doc(db, "customers/customers-A1"), { name: "hacked" }));
    let data: Record<string, unknown> | undefined;
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      data = (await getDoc(doc(ctx.firestore(), "customers/customers-A1"))).data();
    });
    expect(data).toEqual({ organizationId: ORG_A, name: "customers A1" });
  });
});
