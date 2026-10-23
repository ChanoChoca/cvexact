/**
 * Runs once at server boot (Node runtime only). Without this, a rejected
 * promise nobody awaited kills the process silently: Node's default is to
 * crash on an unhandled rejection, and Kubernetes restarts the container
 * before anyone reads a log line explaining why — the crash just looks like
 * a clean boot to whoever checks `kubectl logs` afterwards.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
