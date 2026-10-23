/**
 * The localStorage keys the applications layer reads and writes — on their own
 * so the engine, the migration and the rescue can share them without importing
 * `local.ts`, which imports all three.
 */

/** Where every application used to live, as one JSON array. Still the store in browsers without a usable IndexedDB. */
export const APPLICATIONS_KEY = "cvexact.applications.v1";

/**
 * Applications the browser refused to store, kept here until it takes them.
 * See `./rescue`.
 */
export const RESCUE_KEY = "cvexact.unsaved.v1";

/**
 * How one tab tells the others what changed, in browsers without
 * `BroadcastChannel`: the `storage` event fires in every other tab that has the
 * page open, and the value names the ids to re-read.
 */
export const SYNC_PING_KEY = "cvexact.applications.ping.v1";
