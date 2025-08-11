import { useState } from "react";

export default function Search() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);

  const handleSearch = () => {
    // TODO: connect to backend
    setResults([
      { title: "Patent 1 Example", assignee: "Company A" },
      { title: "Patent 2 Example", assignee: "Company B" }
    ]);
  };

  return (
    <div style={{ padding: "1rem" }}>
      <h2>Patent Search</h2>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Enter keywords..."
        style={{ padding: "0.5rem", width: "300px" }}
      />
      <button onClick={handleSearch} style={{ marginLeft: "0.5rem" }}>
        Search
      </button>

      <ul>
        {results.map((r, i) => (
          <li key={i}>
            <strong>{r.title}</strong> — {r.assignee}
          </li>
        ))}
      </ul>
    </div>
  );
}

