# Asset provenance — "The Ebola Outbreak Nobody Saw Coming"

## Real video (Pexels License — free commercial use, no attribution required)

Downloaded 19 August 2026 by direct browsing. Landscape, contributor-shot,
`videos.pexels.com` only — AI-generated `content.pexels.com/aigc-bundle/…`
results were filtered out.

| Key | Beats | Pexels page | Resolution |
|---|---|---|---|
| `F_LAB` | 1 | pexels.com/video/blood-collection-tubes-being-checked-6290543/ | 2560×1440 |
| `F_ROAD` | 35 | pexels.com/video/drone-footage-of-vehicles-on-a-dirt-road-in-the-countryside-14490849/ | 2560×1440 |
| `F_HORIZON` | *(retired — see below)* | pexels.com/video/mist-over-serene-countryside-at-dawn-29374377/ | 2560×1440 |
| `F_TRIAL` | 51 | pexels.com/video/woman-experimenting-in-laboratory-8852631/ | 1920×1080 |
| `F_PIPETTE` | insert 51 | pexels.com/video/close-up-of-a-scientist-using-laboratory-equipment-8863360/ | 1920×1080 |
| `F_TUBE` | insert 51 | pexels.com/video/hands-in-gloves-holding-test-tube-13532394/ | 1920×1080 |
| `F_MICRO` | insert 1 | pexels.com/video/close-up-shot-of-a-microscope-9244192/ | 1920×1080 |
| `F_VIAL` | inserts 1, 51 | pexels.com/video/vials-on-the-table-8534418/ | 2560×1440 |
| `F_CLOUDS` | inserts 35, 51 | pexels.com/video/time-lapse-video-of-a-moving-clouds-4377446/ | 2560×1440 |
| `F_DOOR` | insert 35 | pexels.com/video/person-knocking-on-the-door-for-deliveries-6994795/ | 2560×1440 |

Seven clips across nine slots: nothing repeats inside a beat, and no clip
returns within four minutes. An earlier cut used three clips for all nine slots
and beat 35 visibly cycled road-horizon-road-lab-road in seven seconds.

`F_DOOR` is pinned to `clipIn: 0` and used for 0.9s: a delivery parcel enters
frame later in that clip, and only the opening seconds read as a plain door.

**Editorial note — read before reusing.** None of these clips was shot in the
Democratic Republic of the Congo, and none depicts this outbreak, any patient,
any responder, or any real event in the film. They are abstract texture only:
laboratory glassware, an unpaved road, mist at dawn. No clip is captioned,
implied or narrated as footage of the events described. Every clip was checked
frame-by-frame for identifiable faces before use; none contains one.

## Excluded by licence policy

| Source | Bucket | Why |
|---|---|---|
| WHO, MSF, UNICEF, IFRC/ICRC photography | **RISKY** | humanitarian organisations retain rights; a strike here is not survivable for this channel |
| News agency / network footage | **RISKY** | rights-managed |
| CDC Public Health Image Library | **RISKY** | licence page did not resolve at time of research (2026-08-19); terms unverified, so unused |
| NIAID Flickr micrographs | **RISKY** | photostream returned HTTP 410; licence unverified, so unused |
| Any patient, body, or burial imagery | **REJECT** | absolute, under any licence |

Where an image was wanted and could not be cleared, the beat was **rendered**
instead — the species comparison, the contact-tracing pipeline, the displacement
figure and the 27 March timeline are all satori/ffmpeg cards.

## Source screenshots (fair use — cited on screen, highlight measured, linked)

- `cepi.png` — CEPI, *Bundibugyo virus: what it is and what it is not*
- `who_don.png` — WHO Disease Outbreak News DON615, 12 Aug 2026
- `who_quote.png` — UN News / WHO, May 2026

## AI-generated imagery

**None.** `syntheticContent` is false in publish.json, and the YouTube
"altered or synthetic content" box must NOT be ticked for this film.

## Rejected

`aerial-view-of-tropical-village-with-lush-greenery-29472326` — a usable clip,
but an aerial of a tropical village (shot in Bangladesh) running under narration
about displacement in eastern Congo would be read by viewers as DRC footage.
Downloaded, reviewed, deleted.

## Beat 51, second pass

Beat 51 originally ran `F_HORIZON` as its main with `F_VIAL` and `F_CLOUDS` as
cutaways, and every one of those had already been seen — `F_VIAL` at beat 1,
`F_CLOUDS` at beat 35. Nine seconds of nothing new at the point the film makes
its closing argument. It now has three clips of its own, used nowhere else, and
`F_HORIZON` is retired from the film.

`F_TRIAL` / `F_PIPETTE` / `F_TUBE` show gloved hands, benches and instruments.
No faces, no patients, no institutional branding.

## Excluded at source: AI-generated stock

Pexels search results interleave `content.pexels.com/aigc-bundle/` items, which
are generated rather than filmed. Four appeared in the first page of results for
"laboratory research". Only `videos.pexels.com/video-files/` uploads are used, so
the film's "all footage is real, no AI-generated imagery" line holds. Anything
sourced later must be checked against the same host rule — the search UI does not
label them.

Also rejected: `fluid-dropping-to-flask-in-laboratory-10415847` — real footage and
correctly licensed, but lit in saturated red and blue. That is a different visual
language from the rest of the film, and the red collides with the palette's
reserved alert colour.
