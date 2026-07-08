// Master data for the Purchase Management module.
// Frequently-used items are predefined here so they are always available in the
// autocomplete, even before any have been created manually in the database.

const UNITS = ['Piece', 'Box', 'Kg', 'Gram', 'Litre', 'Metre', 'Roll', 'Packet', 'Set', 'Dozen', 'Bundle'];

const CATEGORIES = [
    'Packing Material',
    'Stationery',
    'Hardware',
    'Electrical',
    'Furniture',
    'Cleaning Supplies',
    'Safety Equipment',
    'Tools',
    'Office Supplies',
    'Other',
];

// Predefined frequently-used items (master catalogue).
const MASTER_ITEMS = [
    { name: 'Corrugated Box', category: 'Packing Material', unit: 'Piece' },
    { name: 'Bubble Wrap Roll', category: 'Packing Material', unit: 'Roll' },
    { name: 'Stretch Wrap Roll', category: 'Packing Material', unit: 'Roll' },
    { name: 'Packing Tape', category: 'Packing Material', unit: 'Piece' },
    { name: 'Foam Sheet', category: 'Packing Material', unit: 'Roll' },
    { name: 'Carton Sheet', category: 'Packing Material', unit: 'Piece' },
    { name: 'Wooden Crate', category: 'Packing Material', unit: 'Piece' },
    { name: 'Marker Pen', category: 'Stationery', unit: 'Piece' },
    { name: 'A4 Paper', category: 'Stationery', unit: 'Packet' },
    { name: 'Stapler', category: 'Stationery', unit: 'Piece' },
    { name: 'Cutter Blade', category: 'Tools', unit: 'Piece' },
    { name: 'Rope', category: 'Hardware', unit: 'Metre' },
    { name: 'Cable Tie', category: 'Hardware', unit: 'Packet' },
    { name: 'Gloves', category: 'Safety Equipment', unit: 'Pair' },
    { name: 'Trolley', category: 'Tools', unit: 'Piece' },
];

module.exports = { UNITS, CATEGORIES, MASTER_ITEMS };
