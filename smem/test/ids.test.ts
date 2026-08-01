import { expect, test } from "vitest";
import { createEventId, createMemoryId, createProjectId } from "../src/core/ids";

const BASE58_22 = "[1-9A-HJ-NP-Za-km-z]{22}";

test("creates short base58 ids with stable prefixes", () => {
  expect(createProjectId()).toMatch(new RegExp(`^proj_${BASE58_22}$`));
  expect(createMemoryId()).toMatch(new RegExp(`^mem_${BASE58_22}$`));
  expect(createEventId()).toMatch(new RegExp(`^evt_${BASE58_22}$`));
});
