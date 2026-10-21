import { APIError } from "@/api/client"

/**
 * Turns a failed sign-in into the one sentence the reader needs. The server
 * throttles repeated failures per client address, so a 429 is its own case.
 */
export default function describeError(error: Error | null) {
  if (!(error instanceof APIError)) {
    return "Could not reach the server."
  }

  if (error.status === 429) {
    return "Too many attempts. Wait a moment and try again."
  }

  return error.message
}
