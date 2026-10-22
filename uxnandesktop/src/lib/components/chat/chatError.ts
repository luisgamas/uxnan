// A failed bridge call as the chat shows it: the bridge's own words, without
// the numeric code the transport appends — and, for an answer too large for
// the connection (`ResponseTooLarge`, -32011: the bridge refused it so the
// connection stays up), a sentence that says so. Asking again would get the
// same answer, so nothing retries it by itself (plans/046).
import { bridgeErrorText, isResponseTooLargeError } from "$lib/bridge/client.svelte";
import { i18n } from "$lib/i18n";

export function chatErrorText(error: string): string {
  return isResponseTooLargeError({ message: error }) ? i18n.t("chat.tooLarge") : bridgeErrorText({ message: error });
}
