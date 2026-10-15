import { HttpError } from "./api";
import { KEYS_LIVE } from "./keys";

/** the keys routes exist only in live mode; the preview never touches the server */
export function liveOnly() {
  if (!KEYS_LIVE) throw new HttpError(404, "keys are not live on this deployment");
}
