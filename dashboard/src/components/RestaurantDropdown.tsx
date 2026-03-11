import React, { useState, useMemo, useCallback, useRef, memo } from 'react';

interface RestaurantDropdownProps {
    availableBrands: string[];
    selectedBrands: string[];
    onToggle: (brand: string) => void;
    onClearAll: () => void;
    onSelectAll: () => void;
}

// Memoized individual item — only re-renders if its own checked state changes
const DropdownItem = memo(({ brand, checked, onToggle }: {
    brand: string;
    checked: boolean;
    onToggle: (b: string) => void;
}) => (
    <div className="dropdown-item" onClick={() => onToggle(brand)}>
        <input
            type="checkbox"
            className="dropdown-checkbox"
            checked={checked}
            readOnly
        />
        <span>{brand}</span>
    </div>
));

const MAX_VISIBLE = 100;

export const RestaurantDropdown = memo(({
    availableBrands,
    selectedBrands,
    onToggle,
    onClearAll,
    onSelectAll,
}: RestaurantDropdownProps) => {
    const [open, setOpen] = useState(false);
    // Search state lives HERE, not in App — so typing never re-renders charts
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        setSearchQuery(val);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => setDebouncedSearch(val), 120);
    }, []);

    // O(1) checked lookup
    const selectedSet = useMemo(() => new Set(selectedBrands), [selectedBrands]);

    const filtered = useMemo(() => {
        const q = debouncedSearch.toLowerCase();
        return q ? availableBrands.filter(b => b.toLowerCase().includes(q)) : availableBrands;
    }, [availableBrands, debouncedSearch]);

    const visible = filtered.slice(0, MAX_VISIBLE);
    const hiddenCount = filtered.length - visible.length;

    // Close dropdown when clicking outside
    const containerRef = useRef<HTMLDivElement>(null);
    const handleBlur = useCallback((e: React.FocusEvent) => {
        if (!containerRef.current?.contains(e.relatedTarget as Node)) {
            setOpen(false);
        }
    }, []);

    const label = selectedBrands.length === 0
        ? 'All Restaurants'
        : `${selectedBrands.length} Selected`;

    return (
        <div className="dropdown-container" ref={containerRef} onBlur={handleBlur}>
            <label>Restaurants: </label>
            <div className="dropdown-header" onClick={() => setOpen(o => !o)}>
                {label}
            </div>
            {open && (
                <div className="dropdown-menu">
                    <div className="dropdown-actions">
                        <button className="btn-small" onClick={onClearAll}>Clear All</button>
                        <button className="btn-small" onClick={onSelectAll}>Select All</button>
                    </div>
                    <input
                        type="text"
                        className="dropdown-search"
                        placeholder="Search restaurants..."
                        value={searchQuery}
                        onChange={handleSearchChange}
                        autoFocus
                    />
                    <div className="dropdown-list">
                        {visible.map(b => (
                            <DropdownItem
                                key={b}
                                brand={b}
                                checked={selectedSet.has(b)}
                                onToggle={onToggle}
                            />
                        ))}
                        {hiddenCount > 0 && (
                            <div className="dropdown-item" style={{ color: '#64748b', fontSize: '0.75rem', pointerEvents: 'none' }}>
                                + {hiddenCount} more — type to narrow search
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
});
