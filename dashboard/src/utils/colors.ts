export const BrandColors: Record<string, string> = {
    'Chipotle': '#FFC107',       // Yellow
    'Burger King': '#0D47A1',    // Dark Blue
    'Taco Bell': '#29B6F6',      // Light Blue
    'McDonald\'s': '#F44336',    // Red
    'Panera Bread': '#FF9800',   // Orange
    'Chick-fil-A': '#B0BEC5',    // Grey
    'KFC': '#4CAF50',            // Green
    'Wendy\'s': '#26A69A'        // Teal
};

export const getColorForBrand = (brandName: string): string => {
    return BrandColors[brandName] || '#9E9E9E'; // Default Grey
};
