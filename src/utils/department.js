// Centralised, department-aware helpers. Adding a new department in future only
// requires extending DEPARTMENTS / ROLES_BY_DEPARTMENT and (optionally) the
// FULL_ACCESS_ROLES list — controllers do not need to change.

const DEPARTMENTS = ['relocation', 'hr', 'purchase', 'finance', 'director'];
const DEFAULT_DEPARTMENT = 'relocation';

// Roles allowed in each department (admin is shared across departments)
const ROLES_BY_DEPARTMENT = {
    relocation: ['salesperson', 'manager', 'admin'],
    hr: ['recruiter', 'team_leader', 'admin'],
    purchase: ['purchase_manager', 'branch_manager', 'warehouse_manager'],
    finance: ['finance_manager', 'accounts_executive'],
    // The Director section has no dedicated roles of its own — only the
    // cross-department Admin and Director roles may enter it.
    director: [],
};

// Cross-department roles. These are not tied to one department — they may
// operate anywhere, and are offered in User Management regardless of the
// department selected.
//
// `director` carries the same CRM authority as `admin`. It is added ALONGSIDE
// admin rather than replacing it: every existing admin permission is unchanged,
// and anywhere the code asks "is this an administrator?" it should call
// isAdminLevel() so both roles answer yes.
const CROSS_DEPARTMENT_ROLES = ['admin', 'director'];
const ADMIN_LEVEL_ROLES = ['admin', 'director'];

// Older HR roles kept valid in the schema so existing accounts never break,
// even though they are no longer offered at signup.
const LEGACY_ROLES = ['senior_recruiter', 'hr_executive', 'hr_manager', 'hr_head'];

// Special-purpose restricted roles. Not offered at signup — created only via
// admin scripts. `business_sub` is a temporary, sandboxed sub-account that can
// ONLY view/add Business entries on behalf of a linked salesperson.
// Removing this role (and its holders) has no effect on any other feature.
const SUBUSER_ROLES = ['business_sub'];

// All roles across departments (used for the User schema enum)
const ALL_ROLES = [...new Set([
    ...Object.values(ROLES_BY_DEPARTMENT).flat(),
    ...CROSS_DEPARTMENT_ROLES,
    ...LEGACY_ROLES,
    ...SUBUSER_ROLES,
])];

// Roles that can view all entries within their department (vs. only their own).
// All Purchase department roles manage the department's shared inventory data.
const FULL_ACCESS_ROLES = [
    'admin', 'director', 'manager', 'hr_manager', 'hr_head',
    'purchase_manager', 'branch_manager', 'warehouse_manager',
    'finance_manager', 'accounts_executive',
];

// Vendors and their KYC are deliberately SHARED between Purchase and Finance —
// both departments work the same records rather than keeping duplicates. Any
// collection listed here is exempt from department filtering; access is instead
// controlled by role (see canEditVendors / canGenerateKycLink / canReviewKyc below).
const SHARED_DEPARTMENTS = ['purchase', 'finance'];

const PURCHASE_ROLES = ROLES_BY_DEPARTMENT.purchase;
const FINANCE_ROLES = ROLES_BY_DEPARTMENT.finance;

// Exactly the CRM Admin role.
const isAdmin = (user) => user?.role === 'admin';

// Admin OR Director. Use this for "does this user have administrator authority?"
// — the two roles are equivalent across the CRM by design.
const isAdminLevel = (user) => ADMIN_LEVEL_ROLES.includes(user?.role);

const isDirector = (user) => user?.role === 'director';
const isPurchaseUser = (user) => PURCHASE_ROLES.includes(user?.role);
const isFinanceUser = (user) => FINANCE_ROLES.includes(user?.role);

// Who may see the shared vendor register at all
const canViewVendors = (user) => isAdminLevel(user) || isPurchaseUser(user) || isFinanceUser(user);

// Who may CREATE or EDIT a vendor record.
// Finance is deliberately excluded: their role is to review and verify what
// Purchase has recorded, not to alter it. Administrators still can.
const canEditVendors = (user) =>
    isAdminLevel(user) || user?.role === 'purchase_manager';

// Who may generate and share a vendor's KYC form link.
// Wider than editing — Finance may request a KYC from a vendor (the source
// department is recorded on the submission), they just cannot edit the record.
const canGenerateKycLink = (user) =>
    isAdminLevel(user) || user?.role === 'purchase_manager' || isFinanceUser(user);

// Kept as an alias so nothing that already imported it breaks. Prefer the two
// specific helpers above — they say which action is being authorised.
const canManageVendors = canEditVendors;

// Finance is the ONLY department that may approve or reject a KYC submission.
// Purchase users — including Purchase Managers — are deliberately excluded.
const canReviewKyc = (user) => isAdminLevel(user) || isFinanceUser(user);

// Purchase Orders are owned by the Purchase Manager (and administrators).
const canManagePurchaseOrders = (user) => isAdminLevel(user) || user?.role === 'purchase_manager';

// --- Rate Comparison authority ---------------------------------------------

// Purchase staff prepare rate comparisons; administrators may too.
const canManageRateComparisons = (user) => isAdminLevel(user) || isPurchaseUser(user);

// Only the Director (or an Admin, who shares the same authority) may approve,
// reject or send back a rate comparison. Purchase staff cannot approve their own.
const canApproveRateComparisons = (user) => isAdminLevel(user);

const isValidDepartment = (d) => DEPARTMENTS.includes(d);

// True when the role may view department-wide data (not just their own records)
const canViewAllInDepartment = (role) => FULL_ACCESS_ROLES.includes(role);

// Resolve the department a request should operate on.
// - Admins may target any department via ?department= or body.department
// - Everyone else is locked to their own department (param ignored for safety)
const resolveDepartment = (req) => {
    const own = req.user?.department || DEFAULT_DEPARTMENT;
    // Administrators (Admin and Director) may switch departments freely
    if (ADMIN_LEVEL_ROLES.includes(req.user?.role)) {
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
    SUBUSER_ROLES,
    ALL_ROLES,
    FULL_ACCESS_ROLES,
    SHARED_DEPARTMENTS,
    CROSS_DEPARTMENT_ROLES,
    ADMIN_LEVEL_ROLES,
    PURCHASE_ROLES,
    FINANCE_ROLES,
    isValidDepartment,
    canViewAllInDepartment,
    resolveDepartment,
    departmentQuery,
    isAdmin,
    isAdminLevel,
    isDirector,
    isPurchaseUser,
    isFinanceUser,
    canViewVendors,
    canEditVendors,
    canGenerateKycLink,
    canManageVendors,
    canReviewKyc,
    canManagePurchaseOrders,
    canManageRateComparisons,
    canApproveRateComparisons,
};
