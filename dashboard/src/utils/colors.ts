// 40+ color palette that cycles for any brand name
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
  '#f87171', // red-light
  '#c084fc', // purple-light
  '#2dd4bf', // teal-light
  '#fcd34d', // amber-light
  '#a3e635', // lime-light
  '#38bdf8', // sky-light
  '#fb7185', // rose-light
  '#94a3b8', // slate-light
  '#4ade80', // green-light
  '#f472b6', // pink-light
  '#2563eb', // blue-dark
  '#059669', // emerald-dark
  '#d97706', // amber-dark
  '#b91c1c', // red-dark
  '#6d28d9', // violet-dark
  '#0891b2', // cyan-dark
  '#c2410c', // orange-dark
  '#4d7c0f', // lime-dark
  '#be185d', // pink-dark
  '#0f766e', // teal-dark
  '#7e22ce', // purple-dark
  '#a16207', // yellow-dark
  '#0284c7', // sky-dark
  '#15803d', // green-dark
  '#be123c', // rose-dark
  '#334155', // slate-dark
  '#a21caf', // fuchsia-dark
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
