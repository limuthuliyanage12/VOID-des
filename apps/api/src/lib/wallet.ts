/*
 * Apple Wallet and Google Wallet passes need developer accounts and signing certificates the team doesn't have yet.
 * Until then the API returns the PDF only, and this says so plainly.
 */
export const walletAvailable = () => ({
  apple: !!process.env.APPLE_PASS_CERT && !!process.env.APPLE_PASS_TEAM_ID,
  google: !!process.env.GOOGLE_WALLET_ISSUER_ID && !!process.env.GOOGLE_WALLET_SERVICE_ACCOUNT,
});

export const walletUnavailableMessage = 'Wallet passes are coming once VOID has Apple and Google developer accounts. Download the PDF ticket for now.';
