// Master data for the Purchase Management module.
// Frequently-used items are predefined here so they are always available in the
// autocomplete, even before any have been created manually in the database.

const UNITS = ['Piece', 'Box', 'Kg', 'Gram', 'Litre', 'Metre', 'Roll', 'Packet', 'Set', 'Dozen', 'Bundle', 'Pair'];

// Predefined branches / warehouses used wherever a Storage Location is selected.
// New locations added by users are saved to the DB master — no code change needed.
const STORAGE_LOCATIONS = [
    'Delhi HO',
    'Chennai',
    'Mumbai',
    'Jaipur',
    'Ahmedabad',
    'Pune',
    'Hyderabad',
    'Kolkata',
    'Gurugram',
];

// Item categories (item-master metadata only — no longer part of purchase entries)
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

// OmTrax Purchase Material Master List — predefined so they always appear as
// autocomplete suggestions in the Item field, even before any are created manually.
const MASTER_ITEMS = [
    { name: 'Book Carton Box – 18" × 15" × 12" (5 Ply)', category: 'Packing Material', unit: 'Piece' },
    { name: 'Medium Carton Box – 20" × 18" × 20" (5 Ply)', category: 'Packing Material', unit: 'Piece' },
    { name: 'Clothes Carton Box – 30" × 18" × 12" (5 Ply)', category: 'Packing Material', unit: 'Piece' },
    { name: 'Corrugated Roll – 2 Ply, 180 GSM', category: 'Packing Material', unit: 'Roll' },
    { name: 'Newspaper Packing Paper', category: 'Packing Material', unit: 'Kg' },
    { name: 'White Packing Paper', category: 'Packing Material', unit: 'Kg' },
    { name: 'Thermocol Sheet – 1 Inch', category: 'Packing Material', unit: 'Piece' },
    { name: 'Air Bubble Roll – 50 GSM, 1 Meter Width × 100 Meter Roll', category: 'Packing Material', unit: 'Roll' },
    { name: 'OmTrax Printed Packing Tape', category: 'Packing Material', unit: 'Piece' },
    { name: 'Fragile Tape', category: 'Packing Material', unit: 'Piece' },
    { name: 'Stretch Film Roll', category: 'Packing Material', unit: 'Roll' },
    { name: 'EPE Foam Roll – 3 mm', category: 'Packing Material', unit: 'Roll' },
    { name: 'Moving Blankets / Carpets', category: 'Packing Material', unit: 'Piece' },
    { name: 'Hand Pallet Truck', category: 'Tools', unit: 'Piece' },
    { name: 'Iron Trolley', category: 'Tools', unit: 'Piece' },
    { name: 'Thermocol Boxes', category: 'Packing Material', unit: 'Piece' },
    { name: 'Plastic Storage Boxes', category: 'Packing Material', unit: 'Piece' },
    { name: 'Vehicle Security Seal', category: 'Safety Equipment', unit: 'Piece' },
    { name: 'Plywood Sheet – 9 mm', category: 'Hardware', unit: 'Piece' },
    { name: 'Plywood Sheet – 12 mm', category: 'Hardware', unit: 'Piece' },
    { name: 'Plywood Sheet – 18 mm', category: 'Hardware', unit: 'Piece' },
    { name: 'Wooden Block – 3" × 3" × 8 ft', category: 'Hardware', unit: 'Piece' },
    { name: 'Wooden Block – 4" × 4" × 8 ft', category: 'Hardware', unit: 'Piece' },
    { name: 'Safety Glasses', category: 'Safety Equipment', unit: 'Piece' },
    { name: 'Safety Helmet', category: 'Safety Equipment', unit: 'Piece' },
    { name: 'Safety Gloves', category: 'Safety Equipment', unit: 'Pair' },
    { name: 'OmTrax Stickers', category: 'Stationery', unit: 'Piece' },
    { name: 'Fragile Stickers', category: 'Stationery', unit: 'Piece' },
    { name: 'Arrow Direction Stickers', category: 'Stationery', unit: 'Piece' },
    { name: 'Safety Shoes', category: 'Safety Equipment', unit: 'Pair' },
    { name: 'Hammer', category: 'Tools', unit: 'Piece' },
    { name: 'Belt (Patti) with Tensioning Machine', category: 'Tools', unit: 'Set' },
    { name: 'Packing Rope (Sutli)', category: 'Packing Material', unit: 'Kg' },
    { name: 'Pine Batten – 3" × 1", 10 ft', category: 'Hardware', unit: 'Piece' },
    { name: 'EPE L-Section – 50 × 50 mm, 15 mm Thickness', category: 'Packing Material', unit: 'Piece' },
    { name: 'EPE Foam Roll – 6 mm × 70 m', category: 'Packing Material', unit: 'Roll' },
    { name: 'Safeda Wood – 3" × 1", 8 ft', category: 'Hardware', unit: 'Piece' },
    { name: 'Angle Corner Protector – 60 × 60 mm, 4 mm Thickness', category: 'Packing Material', unit: 'Piece' },
    { name: 'Thermocol Sheet – D8, 16" × 34", 1 Inch', category: 'Packing Material', unit: 'Piece' },
    { name: 'Honeycomb Board – 20 mm, 6 ft × 4 ft', category: 'Packing Material', unit: 'Piece' },
    { name: 'EPE Foam Sheet – 4 mm', category: 'Packing Material', unit: 'Piece' },
    { name: 'EPE Foam Sheet – 6 ft × 4 ft, 20 mm Thickness', category: 'Packing Material', unit: 'Piece' },
];

module.exports = { UNITS, CATEGORIES, STORAGE_LOCATIONS, MASTER_ITEMS };
