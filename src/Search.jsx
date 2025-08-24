// src/Search.jsx
import { useEffect, useMemo, useState } from 'react';
import { supabase } from './lib/supabaseClient';

// ---- small utils -----------------------------------------------------------
function formatDate(d) {
  if (!d) return '';
  try {
    const dt = new Date(d);
    return dt.toISOString().slice(0, 10);
  } catch {
    return d;
  }
}

// CSV helpers
function toCSV(rows) {
  if (!rows || !rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v) =>
    v == null
      ? ''
      : String(v)
          .replaceAll('"', '""')
          .replaceAll('\n', ' ')
          .replaceAll('\r', ' ');
  const lines = [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => `"${escape(r[h])}"`).join(',')),
  ];
  return lines.join('\n');
}

function downloadCSV(filename, rows) {
  const csv = toCSV(rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---- component -------------------------------------------------------------
const PAGE_SIZE = 10;

export default function Search() {
  // Filters
  const [query, setQuery] = useState('');
  const [assignee, setAssignee] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // Data
  const [assignees, setAssignees] = useState([]);
  const [results, setResults] = useState([]);

  // Pagination
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // UX
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [exporting, setExporting] = useState(false);

  // Load distinct assignees for dropdown
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('patents')
        .select('assignee')
        .not('assignee', 'is', null)
        .order('assignee', { ascending: true })
        .limit(500);
      if (cancelled) return;
      if (error) {
        console.error(error);
        setAssignees([]);
      } else {
        const uniq = [...new Set((data || []).map((d) => d.assignee).filter(Boolean))];
        setAssignees(uniq);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Summary line
  const summary = useMemo(() => {
    const bits = [];
    if (query.trim()) bits.push(`"${query.trim()}"`);
    if (assignee) bits.push(`assignee: ${assignee}`);
    if (fromDate) bits.push(`from: ${fromDate}`);
    if (toDate) bits.push(`to: ${toDate}`);
    return bits.length ? bits.join(', ') : 'no filters';
  }, [query, assignee, fromDate, toDate]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const canPrev = page > 1;
  const canNext = page < totalPages;

  function resetPagination() {
    setPage(1);
    setTotalCount(0);
  }

  // Centralized query builder so search & export use the exact same filters
  function buildFilteredQuery({ countMode = false } = {}) {
    const kw = query.trim();

    let q = supabase
      .from('patents')
      .select(
        'id, patent_number, title, abstract, assignee, filing_date',
        countMode ? { count: 'exact' } : undefined
      )
      .order('filing_date', { ascending: false });

    // keyword OR search (use ilike with trigram/pg_trgm enabled for good UX)
    if (kw.length >= 2) {
      q = q.or(
        `title.ilike.%${kw}%,abstract.ilike.%${kw}%,assignee.ilike.%${kw}%`
      );
    }

    if (assignee) q = q.eq('assignee', assignee);
    if (fromDate) q = q.gte('filing_date', fromDate);
    if (toDate) q = q.lte('filing_date', toDate);

    return q;
  }

  // Main search
  async function runSearch(targetPage = 1) {
    setErr(null);
    setLoading(true);

    try {
      let q = buildFilteredQuery({ countMode: true });

      // pagination
      const from = (targetPage - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      q = q.range(from, to);

      const { data, error, count } = await q;
      if (error) throw error;

      setResults(data || []);
      setTotalCount(count ?? 0);
      setPage(targetPage);
    } catch (e) {
      console.error(e);
      setErr('Search failed. Please try again.');
      setResults([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }

  // Handlers
  function handleReset() {
    setQuery('');
    setAssignee('');
    setFromDate('');
    setToDate('');
    setResults([]);
    setErr(null);
    resetPagination();
  }

  function handleSubmit(e) {
    e.preventDefault();

    // If user didn’t set any filters and query < 2 chars, return empty
    if (query.trim().length < 2 && !assignee && !fromDate && !toDate) {
      setResults([]);
      setTotalCount(0);
      return;
    }
    runSearch(1);
  }

  // Export: current page
  function exportCurrentPage() {
    if (!results.length) return;
    const cleaned = results.map((r) => ({
      id: r.id,
      patent_number: r.patent_number,
      title: r.title,
      assignee: r.assignee || '',
      filing_date: r.filing_date || '',
    }));
    downloadCSV('patents_current_page.csv', cleaned);
  }

  // Export: all filtered rows in chunks
  async function exportAll() {
    try {
      setExporting(true);

      // Count first
      let countQ = buildFilteredQuery({ countMode: true }).range(0, 0);
      const { count, error: countErr } = await countQ;
      if (countErr) throw countErr;

      if (!count || count <= 0) {
        downloadCSV('patents_all_filtered.csv', []);
        return;
      }

      const pageSize = 1000; // chunk to respect payload limits
      const pages = Math.ceil(count / pageSize);
      let all = [];

      for (let i = 0; i < pages; i++) {
        let q = buildFilteredQuery(); // no count
        const from = i * pageSize;
        const to = Math.min(from + pageSize - 1, count - 1);
        q = q.range(from, to);

        const { data, error } = await q;
        if (error) throw error;

        all = all.concat(
          (data || []).map((r) => ({
            id: r.id,
            patent_number: r.patent_number,
            title: r.title,
            assignee: r.assignee || '',
            filing_date: r.filing_date || '',
          }))
        );
      }

      downloadCSV('patents_all_filtered.csv', all);
    } catch (e) {
      console.error(e);
      alert('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  }

  // --- render ---------------------------------------------------------------
  return (
    <div>
      {/* Search + Filters */}
      <form onSubmit={handleSubmit}
            style={{
              display: 'grid',
              gap: 8,
              marginBottom: 12,
              gridTemplateColumns:
                'minmax(240px, 1fr) minmax(180px, 1fr) repeat(2, 160px) 120px 90px',
            }}>
        <input
          type="text"
          placeholder="Keywords… (min 2 chars to search text)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search keywords"
          style={{ padding: '8px 10px' }}
        />

        <select
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          aria-label="Filter by assignee"
          style={{ padding: '8px 10px' }}
        >
          <option value="">All assignees</option>
          {assignees.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>

        <input
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          aria-label="From date"
          style={{ padding: '8px 10px' }}
        />

        <input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          aria-label="To date"
          style={{ padding: '8px 10px' }}
        />

        <button type="submit" disabled={loading} style={{ padding: '8px 14px' }}>
          {loading ? 'Searching…' : 'Search'}
        </button>

        <button type="button" onClick={handleReset} style={{ padding: '8px 14px' }}>
          Reset
        </button>
      </form>

      {/* Active filter summary */}
      <div style={{ marginBottom: 8, fontSize: 13, color: '#555' }}>
        Showing results for <em>{summary}</em>
      </div>

      {/* Export buttons */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button onClick={exportCurrentPage} disabled={!results.length || loading}>
          Export current page (CSV)
        </button>
        <button onClick={exportAll} disabled={exporting || loading}>
          {exporting ? 'Exporting…' : 'Export all filtered (CSV)'}
        </button>
      </div>

      {/* Errors / Empty */}
      {err && <p style={{ color: 'crimson' }}>{err}</p>}
      {!loading && results.length === 0 && (query.trim().length >= 2 || assignee || fromDate || toDate) && (
        <p>No results match your filters.</p>
      )}

      {/* Results */}
      <ul style={{ lineHeight: 1.6 }}>
        {results.map((r) => (
          <li key={r.id}>
            <strong>{r.title}</strong>
            {' — '}
            {r.assignee ? <>{r.assignee}</> : ''}
            {' '}
            {r.filing_date ? `(${formatDate(r.filing_date)})` : ''}
          </li>
        ))}
      </ul>

      {/* Pagination */}
      {totalCount > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
          <button onClick={() => runSearch(page - 1)} disabled={!canPrev || loading}>
            ◄ Prev
          </button>
          <span>
            Page <strong>{page}</strong> of{' '}
            <strong>{Math.max(1, Math.ceil(totalCount / PAGE_SIZE))}</strong>
            {' • '}
            {totalCount} result{totalCount === 1 ? '' : 's'}
          </span>
          <button onClick={() => runSearch(page + 1)} disabled={!canNext || loading}>
            Next ►
          </button>
        </div>
      )}
    </div>
  );
}
