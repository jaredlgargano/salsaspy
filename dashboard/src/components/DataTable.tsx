import React from 'react';
import './DataTable.css';
import { getColorForBrand } from '../utils/colors';

interface DataTableProps {
    data: any[]; // The flattened time-series array from the API
    metricFormatter?: (val: number) => string;
    isRank?: boolean; // If true, green is lower numbers
}

export const DataTable: React.FC<DataTableProps> = ({ data, metricFormatter, isRank = false }) => {
    if (!data || data.length === 0) return <div className="no-data">No data available for this timeframe</div>;

    // 1. Extract columns (dates)
    const dates = data.map(row => row.date);

    // 2. Extract unique rows (brands)
    const brandSet = new Set<string>();
    data.forEach(row => {
        Object.keys(row).forEach(k => {
            if (k !== 'date') brandSet.add(k);
        });
    });

    // Sort brands to force Chipotle to the top per the mock
    const brands = Array.from(brandSet).sort((a, b) => {
        if (a === 'Chipotle') return -1;
        if (b === 'Chipotle') return 1;
        return a.localeCompare(b);
    });

    // 3. Find Global Min/Max for Conditional Formatting
    let globalMin = Infinity;
    let globalMax = -Infinity;

    brands.forEach(b => {
        data.forEach(row => {
            const val = row[b];
            if (typeof val === 'number') {
                if (val < globalMin) globalMin = val;
                if (val > globalMax) globalMax = val;
            }
        });
    });

    // Conditional Shader (Creates the YipitData-style gradient)
    // Maps strictly to a light-green -> dark-green palette
    const getCellColor = (val: number | undefined) => {
        if (val === undefined || val === null) return 'transparent';

        // Normalize value between 0 and 1
        let ratio = 0;
        if (globalMax !== globalMin) {
            if (isRank) {
                // For ranks, lower is better (darker green)
                ratio = 1 - ((val - globalMin) / (globalMax - globalMin));
            } else {
                // For shares, higher is better (darker green)
                ratio = (val - globalMin) / (globalMax - globalMin);
            }
        } else {
            ratio = 0.5;
        }

        // Lighter greens to match the mockup
        const lightness = 95 - (ratio * 45); // 95% (very light) to 50% (solid green)
        return `hsl(145, 60%, ${lightness}%)`;
    };

    const defaultFormat = (val: number) => val.toFixed(1);
    const format = metricFormatter || defaultFormat;

    return (
        <div className="table-container">
            <table>
                <thead>
                    <tr>
                        <th className="sticky-col">Restaurant</th>
                        {dates.map(d => {
                            // Parse '2026-03-03' -> 'Mar 3'
                            const [year, monthNum, day] = d.split('-');
                            const dateObj = new Date(parseInt(year), parseInt(monthNum) - 1, parseInt(day));
                            const header = `${dateObj.toLocaleString('en', { month: 'short' })} ${day}`;
                            return <th key={d}>{header}</th>
                        })}
                    </tr>
                </thead>
                <tbody>
                    {brands.map(brand => (
                        <tr key={brand}>
                            <td className="sticky-col brand-col">
                                <span className="brand-dot" style={{ backgroundColor: getColorForBrand(brand) }}></span>
                                {brand}
                            </td>
                            {data.map(row => {
                                const val = row[brand];
                                return (
                                    <td
                                        key={row.date}
                                        style={{
                                            backgroundColor: getCellColor(val),
                                            color: val !== undefined ? '#111827' : 'inherit',
                                            fontWeight: val !== undefined ? 600 : 400
                                        }}
                                    >
                                        {val !== undefined && val !== null ? format(val) : '-'}
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};
