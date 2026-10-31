# The Long Read on ScoopFeeds Radio (#304)

DrJ, 31 Oct 2026: a long read built on the major news. This page describes how it works as built, and what has
been measured and what has not. It ships **dark**: nothing changes on air until `RADIO_LONGREAD_ENABLED=1` is set
on the Mac.

**What it is.** About 7 minutes on one major story, **written by ScoopFeeds** from that story's coverage in the
event graph, and read by one presenter. It is not another outlet's article read aloud. Under #281 decision 4, only
text ScoopFeeds writes itself (or public-domain text) is read in full. Other outlets are summarised and credited by
name, and quotes stay short.

## How it works

1. **Make (the Mac, once a day, outside the hour).** `node src/radio/longread/cli.mjs make`
   - **Pick.** The candidates are the active events on scoopfeeds.com (`/api/ri/events?sort=prominence`) with at
     least **4 outlets and 6 articles**, active in the last 48 hours. Machine events never qualify because they have
     no articles. The event's title must pass the radio's Rule 0 layer, and an event that already had a long read in
     the last 7 days is skipped. Refused pieces count here too, because the story was tried. The first candidate
     whose coverage still has 6 articles from 4 outlets after the checks below is the story.
   - **Gather.** The event's articles (title and summary) and its dated timeline (`/timeline-log`). Every article
     passes Rule 0, and opinion URLs are dropped. **No article bodies are fetched.** This is the piece's whole fact
     base, saved beside it as `pack.json`. The on-screen headline is an outlet's own title: the article the event is
     named after, else a straight headline (not a question) from the outlet with the most coverage.
   - **Write.** One Claude call (`claude -p`, the same subscription writer as the hour) asks for 850–1,000 words in
     paragraphs, in five sections: *What happened*, *How we got here*, *Who is involved*, *How the coverage differs*
     and *What to watch*. Each paragraph names at least one outlet in its text and lists every outlet it draws on.
     The open ("This is The Long Read…" plus the headline) and the close (crediting every outlet the piece used) are
     mechanical, not model text.
   - **Check.** Every paragraph goes through the hour's own `checkSegments()` against the piece's fact base: Rule 0,
     every figure backed, quotes verbatim, the election rules (#197), and no talk about our own sourcing. Then come
     the long read's own rules:
     - The paragraph lists its sources, every source is in the fact base, and at least one is named in the text.
     - A quote runs to **at most 25 words**, and at most **2 quotes** come from any one outlet. A quote belongs to
       every outlet whose text holds it.
     - The section is one of the five.

     A paragraph that fails is dropped. The **piece is refused** if a whole section is lost, if fewer than 3
     outlets are credited, if fewer than 600 words survive, if it would overrun the slot (1,065 words with the open
     and close), or if more than 15% of the words were dropped. A check that cannot run is a refusal.
   - **Store.** `~/scoopfeeds-radio/longreads/<date>-<slug>/longread.json` (or `RADIO_LONGREAD_DIR`). The status is
     `draft` while review is on (the default), `ready` when review is off, or `refused`.
2. **Review (DrJ).** `cli.mjs list` shows every piece and whether it may air now. `cli.mjs show <id>` prints it as it
   would be read, with the check report. `cli.mjs approve <id>` clears it for air, and `cli.mjs refuse <id> --note
   "why"` takes it out. A piece the checks refused can never be approved. Review stays on (`RADIO_LONGREAD_REVIEW`
   unset) for at least the first two weeks (DrJ, #304).
3. **Air (the Mac, `produce.mjs`).** With `RADIO_LONGREAD_ENABLED=1` and the v1.5 clock (`RADIO_CLOCK_V15=1`, #285),
   in a long-read hour (`RADIO_LONGREAD_HOURS_ET`, default **7, 12 and 20 New York time**, for the US morning,
   Europe and South Asia, and the US evening):
   - **The News, Compared #2 and the music block after it** (48:00–55:30, 450 s) become *The Long Read*.
     Markets Now and the sign-off follow it as before. The hour then has 90 s less music.
   - It takes the newest piece that may air: approved (or `ready` with review off), **under 36 hours old**, and aired
     in **fewer than 3** hours. A refresh of the same hour keeps the same piece and does not count as a new airing.
   - The lines are checked again with the rest of the hour. One presenter reads it: with `RADIO_DUO=1` the casting
     keeps one story on one voice, so there is no handover.
   - **Earn-render.** If no piece may air, if it is a feature hour that has given those slots away, if it is the
     election night special, or if it is a repeat splice, the hour is unchanged and the produce log says why.
   - **On screen.** The story card (kicker "The Long Read", the outlets' own headline and lede, outlet chips) holds
     for the first 12 seconds. Then one card per section shows the section's name and "Drawing on <outlets>". All
     of it is mechanical text, none of it model text.
   - `programme.json` carries `longread: { id, headline, status, lines, of }`. The piece's `airings` list records
     each produced hour that carried it (rehearsal hours included).

## Settings

| Variable | Code default | What it does |
|---|---|---|
| `RADIO_LONGREAD_ENABLED` | off (anything but literally `1`) | Airs the Long Read in long-read hours. Off: every hour is exactly what it was. |
| `RADIO_LONGREAD_REVIEW` | on (anything but literally `0`) | On: a piece waits as a draft until `approve`. `0`: a piece that passes the checks may air. |
| `RADIO_LONGREAD_HOURS_ET` | `7,12,20` | The New York hours a long read airs in (comma-separated, 0–23). |
| `RADIO_LONGREAD_DIR` | `<RADIO_BASE_DIR or ~/scoopfeeds-radio>/longreads` | Where pieces are kept. |

## On the Mac (once)

```bash
cd ~/work/scoopfeeds/backend
node src/radio/longread/cli.mjs make --dry-run        # pick + write + check, saves nothing
node src/radio/longread/cli.mjs make                  # saves a draft
node src/radio/longread/cli.mjs show <id>             # read it; then approve or refuse
backend/src/radio/playout/deploy/macos/install-longread.sh 05:40   # one draft a day at 5:40 am Mac time
```
Then set `RADIO_LONGREAD_ENABLED=1` in `~/.scoopfeeds-radio.env` (with `RADIO_CLOCK_V15=1`) and re-run
`install-rolling.sh`.

## What is measured, and what is not

- **Measured (cloud, 31 Oct):**
  - Unit tests (`src/radio/longread/longread.test.js`) cover selection, every refusal reason, the clock insertion,
    picking a piece for air, the store, re-checking at air time, one-voice casting, and the screen cues (with ffmpeg
    and the fake voice).
  - A `make --fake-writer --dry-run` against the live event graph picked a real story with 32 outlets and 95
    articles, and refused the fake piece for length, as it should.
  - A full `produce.mjs --fake-voice --headline-writer` hour with a test piece put *The Long Read* at 48:00 for 450 s,
    and the air check passed.
- **UNVERIFIED (to verify on the Mac):**
  - A real Claude-written piece, and how often real pieces pass the checks.
  - Kokoro voicing at real speed: a 1,000-word piece must fit 450 s, and the layout drops lines from the end if it
    does not.
  - The screen as rendered at the 26 px floor.
  - The launchd timer.

## Not in phase 1

These wait for later phases or for a decision from DrJ:

- "A great read from elsewhere" (credited summaries of another outlet's feature).
- Public-domain readings (court rulings, official reports).
- Story stills.
- The Wave 2 clock's 11-minute slot.
- Publishing the text on scoopfeeds.com. That would be a new post type, which is on the stop list.
- Licensing other outlets' text for full reading, which is stop-list item 5.
