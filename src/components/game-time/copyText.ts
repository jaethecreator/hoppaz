/**
 * Copies text. The clipboard API where the browser has it, else a hidden field and the old command. A page on plain http
 * (the in-house phones reach the dev machine that way) and some webviews have no navigator.clipboard, so a ticket code
 * must never depend on it alone. One helper for the win sheet, Me and the crew page.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* fall through to the old way (an http page, a webview) */
  }
  try {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.cssText = "position:fixed;top:0;left:0;opacity:0;font-size:16px";
    document.body.appendChild(field);
    field.select();
    field.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(field);
    return ok;
  } catch {
    return false;
  }
}
