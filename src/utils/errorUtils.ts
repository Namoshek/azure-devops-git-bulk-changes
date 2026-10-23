/**
 * Safely extracts a human-readable message from an unknown thrown value.
 * Handles Error instances, plain strings, and other types gracefully so
 * callers do not need to cast `unknown` to `Error`.
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  return "An unexpected error occurred.";
}
