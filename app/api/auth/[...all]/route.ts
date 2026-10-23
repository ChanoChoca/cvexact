import { toNextJsHandler } from "better-auth/next-js";
import { authConfigured, getAuth } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * When auth is not configured the endpoints must still exist and answer
 * clearly — a 404 here reads to the client as a routing bug rather than a
 * deployment that simply has no database.
 */
const disabled = () =>
  Response.json(
    { error: "Las cuentas no están habilitadas en esta instalación." },
    { status: 503 },
  );

const handlers = authConfigured
  ? toNextJsHandler(getAuth().handler)
  : { GET: disabled, POST: disabled };

export const GET = handlers.GET;
export const POST = handlers.POST;
