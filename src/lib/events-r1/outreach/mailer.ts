/**
 * Sending the transfer link. The link itself is always made and shown to staff (copy button), which is also what they paste into
 * Instagram and WhatsApp. Email is behind this small interface so the mail system can be plugged in later without touching the flow.
 *
 * Today nothing is connected: getMailer() answers the copy-link-only mailer, which sends nothing. To connect the notify system
 * (branch claude/reminders-2f2458, src/lib/notify) after it is merged: write a class that implements TransferMailer using that
 * branch's provider send (Mailjet, then Brevo), with a "transfer_offer" template (room name, event titles, the link, "this link works
 * once for <email> and expires <date>"), and return it from getMailer() when its env keys are present. Nothing else changes.
 */
export type TransferMail = {
  to: string;
  organiserName: string;
  roomName: string;
  eventTitles: string[];
  link: string;
  expiresAt: string;
  /** Staff label, for the signature line. */
  by: string;
};

export type MailResult = { sent: boolean; reason?: "not_connected" | "failed" };

export interface TransferMailer {
  /** True when send() really sends. The desk shows the Send button only then. */
  readonly connected: boolean;
  send(mail: TransferMail): Promise<MailResult>;
}

/** Nothing connected: staff copy the link. */
export const copyLinkOnly: TransferMailer = {
  connected: false,
  async send() {
    return { sent: false, reason: "not_connected" };
  },
};

/** The mailer in use. One place to change when the mail system is connected. */
export function getMailer(): TransferMailer {
  return copyLinkOnly;
}
