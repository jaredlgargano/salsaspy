// 20-color palette that cycles for any brand name
const PALETTE = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#f97316', // orange
  '#84cc16', // lime
  '#ec4899', // pink
  '#14b8a6', // teal
  '#a855f7', // purple
  '#eab308', // yellow
  '#0ea5e9', // sky
  '#22c55e', // green
  '#f43f5e', // rose
  '#64748b', // slate
  '#d946ef', // fuchsia
  '#fb923c', // orange-light
  '#34d399', // emerald-light
  '#818cf8', // indigo-light
];

// Deterministic hash so the same brand always gets the same color
function hashBrand(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  return h;
}

// Legacy explicit overrides for well-known brands (optional, kept for continuity)
const BrandOverrides: Record<string, string> = {
  'Chipotle': '#FFC107',
  'Burger King': '#0D47A1',
  'Taco Bell': '#29B6F6',
  "McDonald's": '#F44336',
  'Panera Bread': '#FF9800',
  'Chick-fil-A': '#B0BEC5',
  'KFC': '#4CAF50',
  "Wendy's": '#26A69A',
};

export const BrandColors = BrandOverrides;

export function getColorForBrand(brandName: string): string {
  if (BrandOverrides[brandName]) return BrandOverrides[brandName];
  return PALETTE[hashBrand(brandName) % PALETTE.length];
}
