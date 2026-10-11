// Collects the pages of every role. Each file in src/roles/ exports
// ROUTES = [[path, Page, allowedRoles], ...] and is picked up here automatically,
// so adding a role means adding one file; nothing else needs to change.
const modules = import.meta.glob("./roles/*.jsx", { eager: true });

export const ROLE_ROUTES = Object.values(modules).flatMap((module) => module.ROUTES || []);

// Paths that exist right now (used to hide menu links for roles not added yet).
export const ROLE_PATHS = new Set(ROLE_ROUTES.map(([path]) => path));
