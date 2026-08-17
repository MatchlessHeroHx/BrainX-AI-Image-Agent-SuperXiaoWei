import type { AppStore } from "@/lib/types";

export const createSeedStore = (): AppStore => ({
  version: 1,
  userPreferences: [],
  conversations: [],
});
