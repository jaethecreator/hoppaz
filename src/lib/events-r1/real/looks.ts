import type { LooksApi } from "../looks";
import { lookJson, parseLook } from "../looks";
import { client } from "./core";

/**
 * Looks on Ola's database: ev_get_look / ev_set_look (supabase/events_r1_looks.sql, a draft). Until that file is run, get answers
 * null (the page reads the cover instead) and set is quiet, so creating an event never fails over a look.
 */
export const looks: LooksApi = {
  async get(owner, id) {
    const { data, error } = await client().rpc("ev_get_look", { p_kind: owner, p_id: id });
    if (error) return null;
    return parseLook(data);
  },
  async set(owner, id, look) {
    const { data, error } = await client().rpc("ev_set_look", { p_kind: owner, p_id: id, p_look: lookJson(look) });
    if (error) {
      if (process.env.NODE_ENV !== "production") console.warn("[hoppaz] ev_set_look:", error.message);
      return;
    }
    if (data !== "ok" && process.env.NODE_ENV !== "production") console.warn("[hoppaz] ev_set_look:", data);
  },
};
