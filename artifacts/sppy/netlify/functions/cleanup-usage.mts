import { getStore } from "@netlify/blobs";

export const config = { schedule: "@daily" };

interface UsageRecord {
  updatedAt?: number;
}

export default async function handler(): Promise<void> {
  const store = getStore("sppy-guest-usage");
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const { blobs } = await store.list({ prefix: "guest:" });
  for (const { key } of blobs) {
    const record = (await store.get(key, { type: "json" })) as UsageRecord | null;
    if (record?.updatedAt && record.updatedAt < cutoff) {
      await store.delete(key);
    }
  }
}
