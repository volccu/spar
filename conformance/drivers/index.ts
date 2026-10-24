/**
 * Which backend this run holds to the contract, chosen by
 * `SPAR_CONFORMANCE_BACKEND`:
 *
 *   supabase    the local Supabase stack (the default)
 *   spar-server the spår server (server/), booted in this process
 */
import type { ConformanceDriver } from "../driver";
import { SparServerDriver } from "./spar-server";
import { SupabaseDriver } from "./supabase";

export const BACKEND = process.env.SPAR_CONFORMANCE_BACKEND ?? "supabase";

export function makeDriver(): ConformanceDriver {
  switch (BACKEND) {
    case "supabase":
      return new SupabaseDriver();
    case "spar-server":
      return new SparServerDriver();
    default:
      throw new Error(`unknown SPAR_CONFORMANCE_BACKEND "${BACKEND}" (supabase | spar-server)`);
  }
}
