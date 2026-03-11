import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Activity, Clock, Database, MapPin, ServerCrash, BarChart2, TrendingDown } from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { BrandColors, getColorForBrand } from './utils/colors';
import { DataTable } from './components/DataTable';
import { RestaurantDropdown } from './components/RestaurantDropdown';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import './index.css';

interface DashboardStats {
  lastRunTime: string | null;
  nextRunTime: string | null;
  activeMarkets: number;
  totalObservations: number;
  health: string;
  healthTier?: string;
  status: string;
}

// Ensure the frontend talks to the local worker in dev, or deployed worker in prod.
const API_BASE = 'https://doordash-scraper-api.uberscraper.workers.dev';

function App() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [healthMetrics, setHealthMetrics] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Chart State
  const [rankData, setRankData] = useState<any[]>([]);
  const [sponsorData, setSponsorData] = useState<any[]>([]);
  const [discountData, setDiscountData] = useState<any[]>([]);

  // UI Controls
  const [selectedCategory, setSelectedCategory] = useState<string>('All Categories');
  const [selectedBrands, setSelectedBrands] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('dashboard_selected_brands');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [aggregationInterval, setAggregationInterval] = useState<string>('day');
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);

  // Competitors and filter options
  const [availableBrands, setAvailableBrands] = useState<string[]>([]);
  const [activeBrands, setActiveBrands] = useState<string[]>([]);

  useEffect(() => {
    const fetchAvailableBrands = async () => {
      try {
        const res = await fetch(`${API_BASE}/v1/brands`);
        const data = await res.json();
        setAvailableBrands(data.brands || []);
      } catch (err) {
        console.error("Failed to fetch brands list:", err);
      }
    };
    fetchAvailableBrands();
  }, []);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch(`${API_BASE}/v1/status`);
        if (!res.ok) throw new Error('Failed to fetch telemetry');
        const data = await res.json();
        setStats(data);
        
        // Also fetch health metrics here
        const healthRes = await fetch(`${API_BASE}/v1/health-metrics`);
        const healthData = await healthRes.json();
        setHealthMetrics(healthData.metrics || []);

        setError(null);
      } catch (err: any) {
        setError(err.message);
      }
    };

    const fetchCharts = async () => {
      // Don't fetch when no brands are selected — avoids rendering hundreds of lines
      if (selectedBrands.length === 0) {
        setRankData([]);
        setSponsorData([]);
        setDiscountData([]);
        setActiveBrands([]);
        return;
      }
      try {
        let baseParams = '';
        if (selectedCategory === 'BestOfLunch') {
          baseParams += `category=None&surface=bestOfLunch`;
        } else {
          baseParams += `category=${selectedCategory}`;
        }

        baseParams += `&interval=${aggregationInterval}`;
        if (selectedBrands.length > 0) {
          baseParams += `&brand=${encodeURIComponent(selectedBrands.join(','))}`;
        }

        const sm = startDate ? `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}` : '';
        const em = endDate ? `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}` : '';

        if (sm) baseParams += `&start_date=${sm}`;
        if (em) baseParams += `&end_date=${em}`;

        // Fetch Average Minimum Rank
        const rankRes = await fetch(`${API_BASE}/v1/aggregates/time-series?metric_name=avg_min_rank&${baseParams}`);
        const rankJson = await rankRes.json();

        // Fetch Sponsored Share
        const sponsorRes = await fetch(`${API_BASE}/v1/aggregates/time-series?metric_name=sponsored_share&${baseParams}`);
        const sponsorJson = await sponsorRes.json();

        // Fetch Discount Share
        const discountRes = await fetch(`${API_BASE}/v1/aggregates/time-series?metric_name=discount_store_share&${baseParams}`);
        const discountJson = await discountRes.json();

        setRankData(rankJson.data || []);
        setSponsorData(sponsorJson.data || []);
        setDiscountData(discountJson.data || []);

        // Extract all unique brands from the rank payload to render lines dynamically
        const brands = new Set<string>();
        (rankJson.data || []).forEach((row: any) => {
          Object.keys(row).forEach(k => {
            if (k !== 'date') brands.add(k);
          });
        });
        setActiveBrands(Array.from(brands));

      } catch (err) {
        console.error("Failed to fetch chart data:", err);
      }
    };

    fetchStats();
    fetchCharts();
    const interval = setInterval(() => { fetchStats(); fetchCharts(); }, 15000);
    return () => clearInterval(interval);
  }, [selectedCategory, selectedBrands, aggregationInterval, startDate, endDate]);

  const handleBrandToggle = useCallback((brand: string) => {
    setSelectedBrands(prev => {
      const next = prev.includes(brand) ? prev.filter(b => b !== brand) : [...prev, brand];
      localStorage.setItem('dashboard_selected_brands', JSON.stringify(next));
      return next;
    });
  }, []);

  const formatTime = (isoString: string | null) => {
    if (!isoString) return 'Never';
    return new Date(isoString).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  };


  return (
    <div className="dashboard-container">
      <header>
        <div className="title-group">
          <h1>DoorDash Telemetry</h1>
          {error ? (
            <div className="status-badge error">
              <div className="status-dot"></div> Disconnected
            </div>
          ) : stats ? (
            <div className={`status-badge ${stats.healthTier === 'Healthy' ? 'success' : stats.healthTier === 'Degraded' ? 'warning' : 'error'}`}>
              <div className={`status-dot ${stats.healthTier === 'Healthy' ? 'pulse' : ''}`}></div>
              {stats.health}
            </div>
          ) : (
            <div className="status-badge" style={{ opacity: 0.5 }}>
              <div className="status-dot pulse"></div> Connecting...
            </div>
          )}
        </div>
      </header>

      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-header">
            <Clock className="metric-icon" size={18} /> Last Scrape
          </div>
          {stats ? (
            <>
              <div className="metric-value">{formatTime(stats.lastRunTime)}</div>
              <div className="metric-sub">Latest batch completed</div>
            </>
          ) : <div className="loading-skeleton"></div>}
        </div>

        <div className="metric-card">
          <div className="metric-header">
            <Activity className="metric-icon" size={18} /> Next Scheduled Run (UTC)
          </div>
          {stats ? (
            <>
              <div className="metric-value">{
                stats.nextRunTime
                  ? `${new Date(stats.nextRunTime).toLocaleString(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} UTC`
                  : 'Never'
              }</div>
              <div className="metric-sub">Expected crontab trigger</div>
            </>
          ) : <div className="loading-skeleton"></div>}
        </div>

        <div className="metric-card">
          <div className="metric-header">
            <MapPin className="metric-icon" size={18} /> Active Markets
          </div>
          {stats ? (
            <>
              <div className="metric-value">{stats.activeMarkets.toLocaleString()}</div>
              <div className="metric-sub">Geographic vectors being tracked</div>
            </>
          ) : <div className="loading-skeleton"></div>}
        </div>

        <div className="metric-card">
          <div className="metric-header">
            <Database className="metric-icon" size={18} /> Total Observations
          </div>
          {stats ? (
            <>
              <div className="metric-value">{stats.totalObservations.toLocaleString()}</div>
              <div className="metric-sub">Rows in D1 Data Warehouse</div>
            </>
          ) : <div className="loading-skeleton"></div>}
        </div>
      </div>

      {healthMetrics.length > 0 && (
        <div style={{ marginBottom: '2rem' }}>
          <div className="section-header">
            <h2>Data Completeness (7-Day)</h2>
          </div>
          <div className="health-row">
            {[...healthMetrics].reverse().map((day: any, i: number) => {
               const dateObj = new Date(day.date + 'T12:00:00Z');
               const dayName = dateObj.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
               let colorClass = 'high';
               if (day.completion_percentage < 90) colorClass = 'medium';
               if (day.completion_percentage < 50) colorClass = 'low';
               
               return (
                 <div key={i} className="health-day-card">
                   <div className="health-date">{dayName}</div>
                   <div className={`health-percent ${colorClass}`}>{day.completion_percentage}%</div>
                   <div className="health-details">{day.scraped_markets.toLocaleString()} / {day.total_active.toLocaleString()} mkts</div>
                 </div>
               );
            })}
          </div>
        </div>
      )}

      <div className="chart-controls">
        <div>
          <label>Analyze Category: </label>
          <select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)} className="category-select">
            <option value="Mexican">Mexican</option>
            <option value="Healthy">Healthy</option>
            <option value="Salad">Salad</option>
            <option value="Chicken">Chicken</option>
            <option value="BestOfLunch">Best of Lunch</option>
            <option value="All Categories">All Categories</option>
          </select>
        </div>

        <RestaurantDropdown
          availableBrands={availableBrands}
          selectedBrands={selectedBrands}
          onToggle={handleBrandToggle}
          onClearAll={() => { setSelectedBrands([]); localStorage.setItem('dashboard_selected_brands', '[]'); }}
          onSelectAll={() => { const all = [...availableBrands]; setSelectedBrands(all); localStorage.setItem('dashboard_selected_brands', JSON.stringify(all)); }}
        />

        <div>
          <label>Aggregate: </label>
          <select value={aggregationInterval} onChange={(e) => setAggregationInterval(e.target.value)} className="category-select">
            <option value="day">Daily</option>
            <option value="week">Weekly</option>
            <option value="month">Monthly</option>
            <option value="year">Yearly</option>
          </select>
        </div>

        <div>
          <label>Start: </label>
          <DatePicker
            selected={startDate}
            onChange={(date: Date | null) => setStartDate(date)}
            dateFormat="yyyy-MM-dd"
            className="category-select"
            placeholderText="Any Date"
            isClearable
          />
        </div>

        <div>
          <label>End: </label>
          <DatePicker
            selected={endDate}
            onChange={(date: Date | null) => setEndDate(date)}
            dateFormat="yyyy-MM-dd"
            className="category-select"
            placeholderText="Any Date"
            isClearable
          />
        </div>
      </div>

      <div className="charts-container">

        {/* Average Minimum Rank */}
        <div className="chart-wrapper">
          <div className="chart-header">
            <TrendingDown className="chart-icon" />
            <h2>"{selectedCategory === 'BestOfLunch' ? "Best of Lunch" : selectedCategory}" Average Minimum Rank</h2>
            <span>(Lower is Better)</span>
          </div>
          <div className="chart-body">
            {activeBrands.length > 0 ? (
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={rankData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                  <XAxis dataKey="date" stroke="#888" />
                  <YAxis reversed stroke="#888" domain={[1, 'auto']} />
                  <Tooltip contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333' }} />
                  <Legend />
                  {activeBrands.map(brand => (
                    <Line
                      key={brand}
                      type="monotone"
                      dataKey={brand}
                      stroke={getColorForBrand(brand)}
                      strokeWidth={brand === 'Chipotle' ? 4 : 2}
                      dot={{ r: brand === 'Chipotle' ? 6 : 4 }}
                      activeDot={{ r: 8 }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ height: 400, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#64748b', gap: 8 }}>
                <span style={{ fontSize: '1.5rem' }}>📊</span>
                <span>Select restaurants above to see chart data</span>
              </div>
            )}

            <div style={{ marginTop: '2rem' }}>
              <h3 style={{ fontSize: '0.875rem', color: '#94a3b8', marginBottom: '1rem', fontWeight: 500 }}>Rank Data Table Matrix</h3>
              <DataTable data={rankData} isRank={true} />
            </div>
          </div>
        </div>

        {/* Share of Sponsored Listings */}
        <div className="chart-wrapper">
          <div className="chart-header">
            <BarChart2 className="chart-icon" />
            <h2>"{selectedCategory === 'BestOfLunch' ? "Best of Lunch" : selectedCategory}" Share of Sponsored Listings</h2>
          </div>
          <div className="chart-body">
            {activeBrands.length > 0 ? (
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={sponsorData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                  <XAxis dataKey="date" stroke="#888" />
                  <YAxis tickFormatter={(tick) => `${(tick * 100).toFixed(0)}%`} stroke="#888" />
                  <Tooltip formatter={(value: any) => `${((Number(value) || 0) * 100).toFixed(1)}%`} contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333' }} />
                  <Legend />
                  {activeBrands.map(brand => (
                    <Bar
                      key={brand}
                      dataKey={brand}
                      fill={getColorForBrand(brand)}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ height: 400, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#64748b', gap: 8 }}>
                <span style={{ fontSize: '1.5rem' }}>📊</span>
                <span>Select restaurants above to see chart data</span>
              </div>
            )}

            <div style={{ marginTop: '2rem' }}>
              <h3 style={{ fontSize: '0.875rem', color: '#94a3b8', marginBottom: '1rem', fontWeight: 500 }}>Sponsored Share Matrix (%)</h3>
              <DataTable data={sponsorData} metricFormatter={(val) => `${(val * 100).toFixed(1)}%`} isRank={false} />
            </div>
          </div>
        </div>

        {/* Share of Stores Offering Discounts */}
        <div className="chart-wrapper">
          <div className="chart-header">
            <BarChart2 className="chart-icon" />
            <h2>Share of Stores Offering Discounts</h2>
          </div>
          <div className="chart-body">
            {activeBrands.length > 0 ? (
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={discountData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                  <XAxis dataKey="date" stroke="#888" />
                  <YAxis tickFormatter={(tick) => `${(tick * 100).toFixed(0)}%`} stroke="#888" />
                  <Tooltip formatter={(value: any) => `${((Number(value) || 0) * 100).toFixed(1)}%`} contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333' }} />
                  <Legend />
                  {activeBrands.map(brand => (
                    <Bar
                      key={brand}
                      dataKey={brand}
                      fill={getColorForBrand(brand)}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ height: 400, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#64748b', gap: 8 }}>
                <span style={{ fontSize: '1.5rem' }}>📊</span>
                <span>Select restaurants above to see chart data</span>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

export default App;
