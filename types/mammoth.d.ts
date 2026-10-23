/**
 * mammoth ships no type declarations. Only the one function this app calls is
 * declared — a fuller stub would be a second, unverified copy of someone else's
 * API surface, and everything not declared here is not used.
 */
declare module "mammoth/mammoth.browser.js" {
  export function extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<{
    value: string;
    messages: { type: string; message: string }[];
  }>;
}
