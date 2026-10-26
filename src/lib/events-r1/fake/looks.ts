import type { LooksApi } from "../looks";
import { lookJson, parseLook } from "../looks";

/** The fake looks store: localStorage only, the executable spec of ev_get_look / ev_set_look (supabase/events_r1_looks.sql). */
const KEY = "hz.r1.looks.v1";
const readAll = (): Record<string, unknown> => {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(KEY) || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
};

export const fakeLooks: LooksApi = {
  async get(owner, id) {
    return parseLook(readAll()[`${owner}:${id}`]);
  },
  async set(owner, id, look) {
    if (typeof window === "undefined") return;
    const all = readAll();
    all[`${owner}:${id}`] = lookJson(look);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(all));
    } catch {
      /* full storage: the page falls back to the cover */
    }
  },
};
