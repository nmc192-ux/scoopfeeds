/**
 * videoAttribution.test.js — who gets credited.
 *
 * THE FIXTURE THAT FORCED THE MODULE, first: a live dry run selected
 * seanhelvey.com, a personal blog, carried under source_name "Hacker News".
 * "Reported by Hacker News" would have been false on the one card whose entire
 * job is honest sourcing.
 *
 * The rule is general, not an aggregator list — so the tests check the RULE:
 * a domain that corroborates the masthead keeps the masthead, one that does not
 * loses to the domain, and the uncertainty always falls toward the awkward
 * truth rather than the smooth lie.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  registrableDomain, domainMatchesSource, resolveAttribution, buildDescriptionCredit,
} from "./videoAttribution.js";
import { buildAttributionCard } from "./videoSpecSchema.js";

// ─── The two cases DrJ named ────────────────────────────────────────────────

test("THE REAL CASE: seanhelvey.com under \"Hacker News\" is credited to the blog", () => {
  const article = {
    source_name: "Hacker News",
    url: "https://seanhelvey.com/posts/why-i-left-kubernetes/",
    title: "Why I left Kubernetes",
    published_at: Date.UTC(2026, 7, 3),
  };
  const a = resolveAttribution(article);
  assert.equal(a.publisher, "seanhelvey.com");
  assert.equal(a.basis, "url_domain");
  assert.equal(a.matched, false);
  assert.equal(a.domain, "seanhelvey.com");

  // And the card — the surface that would have printed the lie.
  const card = buildAttributionCard(article);
  assert.equal(card.outlet, "seanhelvey.com");
  assert.equal(card.caption, "Reported by seanhelvey.com.");
  assert.ok(!/Hacker News/.test(JSON.stringify(card)),
    "the aggregator must appear nowhere on the attribution card");
});

test("BBC News with a bbc.co.uk url still reads \"BBC News\"", () => {
  const article = {
    source_name: "BBC News",
    url: "https://www.bbc.co.uk/news/articles/c123abc",
    title: "Subsea cable faults traced to dragged anchors",
    published_at: Date.UTC(2026, 7, 3),
  };
  const a = resolveAttribution(article);
  assert.equal(a.publisher, "BBC News");
  assert.equal(a.basis, "source_name");
  assert.equal(a.matched, true);
  assert.equal(a.domain, "bbc.co.uk", "co.uk is a multi-part suffix, not the registrable domain");

  assert.equal(buildAttributionCard(article).caption, "Reported by BBC News.");
});

// ─── Registrable domain ─────────────────────────────────────────────────────

test("registrableDomain handles multi-part suffixes, subdomains and www", () => {
  const cases = [
    ["https://www.bbc.co.uk/news/x", "bbc.co.uk"],
    ["https://seanhelvey.com/p", "seanhelvey.com"],
    ["https://news.ycombinator.com/item?id=1", "ycombinator.com"],
    ["https://www.theguardian.com/world/2026/aug/03/x", "theguardian.com"],
    ["https://timesofindia.indiatimes.com/city/x", "indiatimes.com"],
    ["https://www.abc.net.au/news/x", "abc.net.au"],
    ["http://example.org", "example.org"],
  ];
  for (const [url, want] of cases) {
    assert.equal(registrableDomain(url), want, url);
  }
});

test("registrableDomain returns null rather than guessing on junk", () => {
  for (const bad of [null, undefined, "", "not a url", "/relative/path"]) {
    assert.equal(registrableDomain(bad), null, JSON.stringify(bad));
  }
});

test("an IP host is returned whole, not sliced into a nonsense domain", () => {
  assert.equal(registrableDomain("http://192.168.1.10/article"), "192.168.1.10");
});

// ─── The cross-check ────────────────────────────────────────────────────────

test("a domain that belongs to the masthead matches, across naming styles", () => {
  const cases = [
    ["bbc.co.uk", "BBC News"],
    ["thehindu.com", "The Hindu"],           // token match past a generic "The"
    ["aljazeera.com", "Al Jazeera"],
    ["dw.com", "DW English"],                // concatenation match, short name
    ["reuters.com", "Reuters"],
    ["wired.com", "Wired"],
    ["theguardian.com", "The Guardian"],
  ];
  for (const [d, s] of cases) {
    assert.equal(domainMatchesSource(d, s), true, `${d} should match "${s}"`);
  }
});

test("a domain that does NOT belong loses, including every aggregator shape", () => {
  const cases = [
    ["seanhelvey.com", "Hacker News"],
    ["ycombinator.com", "Hacker News"],      // even HN's own domain is not "Hacker News"
    ["substack.com", "Reddit"],
    ["medium.com", "Google News"],
    ["randomblog.net", "BBC News"],
  ];
  for (const [d, s] of cases) {
    assert.equal(domainMatchesSource(d, s), false, `${d} must NOT match "${s}"`);
  }
});

test("a GENERIC masthead word can never carry the match", () => {
  // Otherwise "News" makes newsblog.com match "BBC News", which is the same
  // class of false credit the caption matcher already refuses.
  assert.equal(domainMatchesSource("newsblog.com", "BBC News"), false);
  assert.equal(domainMatchesSource("dailyupload.com", "Daily Mail"), false);
  assert.equal(domainMatchesSource("thetimes.co.uk", "The Hindu"), false);
});

test("an INITIALISM keeps the masthead — Financial Times / ft.com", () => {
  // Measured over 33,300 real articles this was the largest override bucket by
  // far (524 + 183), a real publisher losing its own name because "times" is a
  // generic word and "financialtimes" does not contain "ft".
  assert.equal(domainMatchesSource("ft.com", "Financial Times"), true);
  assert.equal(resolveAttribution({
    source_name: "Financial Times", url: "https://www.ft.com/content/abc",
  }).publisher, "Financial Times");
});

test("an initialism must match the label EXACTLY, never by containment", () => {
  // This is the one rule that can hand the name back to source_name, so it is
  // the one that must not be generous: "ft" loose inside "ftx.com" is not the
  // Financial Times, and "hn" inside "hnstyle.com" is not Hacker News.
  assert.equal(domainMatchesSource("ftx.com", "Financial Times"), false);
  assert.equal(domainMatchesSource("hnstyle.com", "Hacker News"), false);
});

test("a fragment shorter than 3 chars cannot produce a containment match", () => {
  // "ap" inside "apple.com" is a coincidence, not attribution. Short mastheads
  // must match a label EXACTLY.
  assert.equal(domainMatchesSource("apple.com", "AP"), false);
  assert.equal(domainMatchesSource("ap.org", "AP"), true, "an exact label still matches");
});

// ─── Degenerate inputs ──────────────────────────────────────────────────────

test("no URL leaves source_name standing, but labelled UNVERIFIED", () => {
  // It must not look identical to a cross-checked credit — this is exactly the
  // state the seanhelvey article would have been in with no url.
  const a = resolveAttribution({ source_name: "Hacker News", url: null });
  assert.equal(a.publisher, "Hacker News");
  assert.equal(a.basis, "source_name_unverified");
  assert.equal(a.matched, false);
});

test("no source_name falls back to the domain", () => {
  const a = resolveAttribution({ source_name: "", url: "https://seanhelvey.com/p" });
  assert.equal(a.publisher, "seanhelvey.com");
  assert.equal(a.basis, "url_domain");
});

test("neither one yields no publisher, and no card", () => {
  const a = resolveAttribution({});
  assert.equal(a.publisher, null);
  assert.equal(a.basis, "none");
  assert.equal(buildAttributionCard({ title: "T" }), null);
});

// ─── §3b/4 description credit ───────────────────────────────────────────────

test("the description credits the resolved publisher and links the original", () => {
  const article = { source_name: "Hacker News", url: "https://seanhelvey.com/posts/x" };
  const line = buildDescriptionCredit(article);
  assert.match(line, /^Original report by seanhelvey\.com: https:\/\/seanhelvey\.com\/posts\/x$/);
  assert.ok(!/Hacker News/.test(line));
});

test("the description credit uses the masthead when it survives the cross-check", () => {
  const line = buildDescriptionCredit({ source_name: "BBC News", url: "https://www.bbc.co.uk/news/x" });
  assert.match(line, /^Original report by BBC News: https:\/\/www\.bbc\.co\.uk\/news\/x$/);
});

// ─── One resolver, not four ─────────────────────────────────────────────────

test("no attribution surface reads article.source_name directly", () => {
  // Four places reading source_name independently is how they drift apart, and
  // it is why the aggregator would have been printed on the card AND spoken
  // aloud AND burned into the SOURCE: line. The cycle resolves once and threads
  // the result; the only source_name left in videoAutopost is the video_posts
  // cooldown key, which is deliberately the raw masthead so it stays consistent
  // with publisherPublishedSince.
  const raw = readFileSync(new URL("./videoAutopost.js", import.meta.url), "utf8");
  const code = raw.split("\n")
    .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))       // strip comment lines
    .join("\n");
  const reads = [...code.matchAll(/article\.source_name/g)].length;
  assert.equal(reads, 1,
    "expected exactly one article.source_name in videoAutopost (the claimVideoPost cooldown key)");
  assert.match(code, /sourceName: article\.source_name/,
    "the one remaining read must be the claimVideoPost cooldown key");

  const schema = readFileSync(new URL("./videoSpecSchema.js", import.meta.url), "utf8");
  const body = schema.slice(schema.indexOf("export function buildAttributionCard"));
  // Comments stripped for the same reason as above — the function's own comment
  // NAMES the field it must not read, and an unstripped scan flags itself.
  const fn = body.slice(0, body.indexOf("\n}")).split("\n")
    .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");
  assert.ok(!/article\?\.source_name|article\.source_name/.test(fn),
    "buildAttributionCard must go through resolveAttribution, never source_name");
});
