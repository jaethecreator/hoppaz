/** Fake outreach (staff desk) and claims (organiser side). STUB: filled in by the fake-layer build. */
import type { ClaimsApi, OutreachApi } from "../api";

const todo = (): never => {
  throw new Error("Not built yet");
};

export const outreach: OutreachApi = {
  queue: todo, approve: todo, edit: todo, reject: todo, merge: todo, importBatch: todo, organisers: todo, organiser: todo, saveOrganiser: todo,
  logContact: todo, setStage: todo, deleteListingAndRoom: todo, createTransfer: todo, revokeTransfer: todo, claimRequests: todo,
  handleClaimRequest: todo, week: todo,
};

export const claims: ClaimsApi = { requestClaim: todo, preview: todo, accept: todo, startHandover: todo, transfersFor: todo, revoke: todo };
