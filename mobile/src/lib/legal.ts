/**
 * Where the Terms and Privacy links point.
 *
 * These are the two URLs App Review opens, so they have to be live pages that
 * render without a session. They are served by the webapp
 * (`webapp/src/components/{TermsOfService,DataPolicy}.jsx`, routed in
 * `webapp/src/App.jsx`), which is what runs at the base URL below.
 *
 * Override with EXPO_PUBLIC_LEGAL_BASE_URL when a custom domain replaces the
 * Cloud Run hostname; the default has to be a literal because App Review builds
 * are made without a local .env.
 */
const DEFAULT_BASE_URL = 'https://workout-motivation-webapp-3sleoawqya-uc.a.run.app';

const base = (process.env.EXPO_PUBLIC_LEGAL_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');

export const TERMS_URL = `${base}/terms`;
export const PRIVACY_URL = `${base}/privacy`;
