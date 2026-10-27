/**
 * Fixed Morning Scoop fixture (#263). Shared by morningScoop.test.js and the
 * script that captured the flag-off golden output from the pre-#263 code, so the
 * golden and the test are built from the same rows.
 *
 * `now` is passed in so every timestamp is relative to it; the v1 email prints
 * no times, so its output depends only on these rows.
 */
const HOUR = 60 * 60 * 1000;

export function seedV1Articles(db, now) {
  const ins = db.prepare(`INSERT INTO articles (id, title, description, url, source_name, category, published_at, fetched_at, credibility)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  ins.run("g1", "Lead story headline", "A description with <angle> & \"quotes\" that is long enough to matter.", "https://example.test/g1", "Reuters", "world", now - HOUR, now, 0.95);
  ins.run("g2", "Second story", null, "https://example.test/g2", "BBC News", "tech", now - 2 * HOUR, now, 0.9);
  ins.run("g3", "Third story", "Short.", "https://example.test/g3", "AP", "business", now - 3 * HOUR, now, 0.8);
  ins.run("g-old", "Old story", null, "https://example.test/old", "AP", "world", now - 30 * HOUR, now, 0.99);
}
