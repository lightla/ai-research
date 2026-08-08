import { randomBytes } from "node:crypto";

export function createProjectId(): string {
  return `proj_${createSortableBase58Id()}`;
}

export function createMemoryId(): string {
  return `mem_${createSortableBase58Id()}`;
}

export function createEventId(): string {
  return `evt_${createSortableBase58Id()}`;
}

export function createEntityId(): string {
  return `ent_${createSortableBase58Id()}`;
}

export function createRelationId(): string {
  return `rel_${createSortableBase58Id()}`;
}

export function createSortableBase58Id(now = Date.now()): string {
  const bytes = new Uint8Array(16);
  let timestamp = BigInt(now);

  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }

  bytes.set(randomBytes(10), 6);
  return base58(bytes).padStart(22, "1").slice(0, 22);
}

export function base58FromBytes(bytes: Uint8Array, length = 22): string {
  return base58(bytes).padStart(length, "1").slice(0, length);
}

function base58(bytes: Uint8Array): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) + BigInt(byte);
  }

  let encoded = "";
  while (value > 0n) {
    const remainder = Number(value % 58n);
    encoded = alphabet[remainder] + encoded;
    value /= 58n;
  }

  for (const byte of bytes) {
    if (byte === 0) {
      encoded = alphabet[0]! + encoded;
    } else {
      break;
    }
  }

  return encoded || alphabet[0]!;
}
