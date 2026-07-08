// Centralised, department-aware helpers. Adding a new department in future only
// requires extending DEPARTMENTS / ROLES_BY_DEPARTMENT and (optionally) the
// FULL_ACCESS_ROLES list — controllers do not need to change.

const DEPARTMENTS = ['relocation', 'hr', 'purchase'];
const DEFAULT_DEPARTMENT = 'relocation';

// Roles allowed in each department (admin is shared across departments)
const ROLES_BY_DEPARTMENT = {
    relocation: ['salesperson', 'manager', 'admin'],
    hr: ['recruiter', 'team_leader', 'admin'],
    purchase: ['purchase_manager'],
};

// Older HR roles kept valid in the schema so existing accounts never break,
// even though they are no longer offered at signup.
const LEGACY_ROLES = ['senior_recruiter', 'hr_executive', 'hr_manager', 'hr_head'];

// All roles across departments (used for the User schema enum)
const ALL_ROLES = [...new Set([...Object.values(ROLES_BY_DEPARTMENT).flat(), ...LEGACY_ROLES])];

// Roles that can view all entries within their department (vs. only their own).
// Purchase Managers manage the whole Purchase department's data.
const FULL_ACCESS_ROLES = ['admin', 'manager', 'hr_manager', 'hr_head', 'purchase_manager'];

const isValidDepartment = (d) => DEPARTMENTS.includes(d);

// True when the role may view department-wide data (not just their own records)
const canViewAllInDepartment = (role) => FULL_ACCESS_ROLES.includes(role);

// Resolve the department a request should operate on.
// - Admins may target any department via ?department= or body.department
// - Everyone else is locked to their own department (param ignored for safety)
const resolveDepartment = (req) => {
    const own = req.user?.department || DEFAULT_DEPARTMENT;
    if (req.user?.role === 'admin') {
        const requested = req.query?.department || req.body?.department;
        return isValidDepartment(requested) ? requested : own;
    }
    return own;
};

// Mongo filter fragment for a department. The legacy "relocation" department also
// absorbs documents created before departments existed (null / missing field).
const departmentQuery = (department) => {
    if (department === DEFAULT_DEPARTMENT) {
        return { department: { $in: [DEFAULT_DEPARTMENT, null] } };
    }
    return { department };
};

module.exports = {
    DEPARTMENTS,
    DEFAULT_DEPARTMENT,
    ROLES_BY_DEPARTMENT,
    ALL_ROLES,
    FULL_ACCESS_ROLES,
    isValidDepartment,
    canViewAllInDepartment,
    resolveDepartment,
    departmentQuery,
};
