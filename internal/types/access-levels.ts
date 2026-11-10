/** Access grant levels, lowest to highest. Shared by the db schema, the resolver and API contracts. */
export const ACCESS_GRANT_LEVELS = ['viewer', 'runner', 'editor', 'manager'] as const;
export type AccessGrantLevel = (typeof ACCESS_GRANT_LEVELS)[number];
