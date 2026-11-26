// Single source of truth for Passport magic-link validity.
// Only applies to email sign-in links. Invitation, ticket and Passport
// session expiration policies remain independent.
export const PASSPORT_MAGIC_LINK_TTL_SECONDS = 60 * 60;
export const PASSPORT_MAGIC_LINK_TTL_LABEL = '1 hour';
