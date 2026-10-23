import "server-only";

import * as QRCode from "qrcode";

/**
 * Whether crypto donations are configured.
 *
 * Separate from pack/subscription flags: an install can accept crypto
 * donations without selling anything.
 */
export const cryptoDonationConfigured = Boolean(process.env.DONATION_WALLET_ADDRESS);

/**
 * The wallet address to receive donations on Polygon.
 *
 * Throws if DONATION_WALLET_ADDRESS is not set. Guard with
 * `cryptoDonationConfigured` first.
 */
export function donationWalletAddress(): string {
  const address = process.env.DONATION_WALLET_ADDRESS;
  if (!address) {
    throw new Error("DONATION_WALLET_ADDRESS is not set.");
  }
  return address;
}

/**
 * Generates a QR code image as a data URL for the wallet address.
 *
 * The QR encodes the wallet address directly, so scanning leads to a wallet
 * that can initiate a transfer.
 */
export async function donationWalletQrDataUrl(address: string): Promise<string> {
  return QRCode.toDataURL(address, { margin: 1, width: 480 });
}
