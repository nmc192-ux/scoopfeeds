# Campaigns' own streams for election night — proposed list (#223)

**Decision (DrJ, 25 Oct 2026):** on election night (3 Nov) candidates' and campaigns' **own** streams
may air for victory and concession speeches, but only as named entries on
`backend/src/radio/live/officialFeeds.js` that DrJ has approved before 2 Nov.

Every entry below is in that file with `proposed: true`, which `assertCanAir` refuses. Nothing here
can air until DrJ deletes an entry's `proposed` line. To strike one, delete the entry.

**How the handles were checked (25 Oct 2026, cloud builder):** races are Ballotpedia's 12 US Senate
battlegrounds (<https://ballotpedia.org/U.S._Senate_battlegrounds,_2026>) and 7 governor battlegrounds
(<https://news.ballotpedia.org/2026/02/11/a-look-at-gubernatorial-battlegrounds-in-2026/>). #197's race
list has no "key races" field, so Ballotpedia's lists were used instead. For each major candidate the
campaign website was found by search and the YouTube link read off a page on that site carrying the
campaign's "Paid for by" line. Pages were read through a fetch tool that summarises HTML, not from raw
HTML; two (Susan Collins, Alani Bankhead) were re-read a second time and matched. **Re-check each link
in a browser before approving: UNVERIFIED beyond that.** Nothing comes from memory.

X accounts are listed for reference only. The allow-list cannot match an X stream yet, and whether
each campaign streams on X was not checked.

## Proposed (11)

| id | Race | YouTube handle | Source page (handle linked there) | X (reference) |
|---|---|---|---|---|
| moody-campaign | FL Senate special, R (inc.) | @AshleyMoodyFL | https://ashleymoody.com/about/ | x.com/AshleyMoodyFL |
| nixon-campaign | FL Senate special, D | @AngieForFL | https://angienixon.com/state-rep-angie-nixon-launchescampaign-for-u-s-senate/ | twitter.com/AngieNixon |
| collins-me-campaign | ME Senate, R (inc.) | @susancollins4senator | https://susancollins.com/ | x.com/SenSusanCollins |
| jackson-me-campaign | ME Senate, D | @troyjacksonformaine | https://www.jacksonformaine.com/ | x.com/troyjackson207 |
| alme-campaign | MT Senate, R | @almeforsenate | https://almeforsenate.com/ | x.com/kurtalme |
| bankhead-campaign | MT Senate, D | @montanamatters | https://alaniformt.com/press-kit ("the campaign's YouTube channel, youtube.com/@montanamatters") | none on site |
| bodnar-campaign | MT Senate, independent | @SethForMontana | https://www.sethformontana.com/ | x.com/SethBodnarForMT |
| sununu-campaign | NH Senate, R | @sununusenator | https://www.sununusenator.com/ | x.com/sununusenator |
| pappas-campaign | NH Senate, D | @ChrisPappasNH | https://chrispappas.org/ | x.com/chrispappasnh |
| sand-campaign | IA governor, D | @robsandia | https://robsand.com/about/ | x.com/robsandia |
| lahn-campaign | IA governor, R | @ZachLahnforGovernor | https://zachlahn.com/ | x.com/ZachLahn |

Judgment call: **@montanamatters** is the only channel not named for the candidate. Her own press
kit names it as the campaign's channel, so it is proposed; strike it if in doubt.


**DrJ's fairness rule (25 Oct 2026): a race is proposed only when every main candidate in it has a verified channel.**
Five races qualify: FL Senate special, ME Senate, MT Senate, NH Senate, IA governor. These seven entries were
dropped because the other main candidate's channel could not be verified by @handle (see "Left out" below):

- `turek-campaign` (IA Senate, D, @JoshTurek4Iowa)
- `rogers-mi-campaign` (MI Senate, R, @MikeRogersForMI)
- `ricketts-campaign` (NE Senate, R (inc.), @rickettsforsenate)
- `husted-campaign` (OH Senate special, R (inc.), @jonhustedforsenate)
- `talarico-campaign` (TX Senate, D, @JamesTalaricoTX)
- `becerra-campaign` (CA governor, D, @becerraforgovernor)
- `benson-campaign` (MI governor, D, @BensonforGovernor)

## Left out (not proposed)

The allow-list matches YouTube by `@handle`. These campaign sites link a channel only by channel id,
`/c/` or `/user/` URL, so the handle is not confirmed. DrJ can add any of them once the channel
page shows its @handle (open the link; the handle is under the channel name).

| Candidate | Race | Link on the campaign site |
|---|---|---|
| Dan Sullivan | AK Senate, R (inc.) | youtube.com/c/dansullivanforalaska (dansullivanforalaska.com). Not sullivanforsenate.com, which is a different Daniel Sullivan. |
| Mike Collins | GA Senate, R | youtube.com/channel/UCjh6vFfsb53dVOGIQxBcdBA (mikecollinsga.com) |
| Ashley Hinson | IA Senate, R | youtube.com/channel/UCaPhZwEDLgaDU-Q4ehMSvHA (ashleyhinson.com/meet-ashley/) |
| Abdul El-Sayed | MI Senate, D | youtube.com/c/abdulelsayed (abdulforsenate.com) |
| Sherrod Brown | OH Senate special, D | youtube.com/channel/UCt_l7Nge_872rTm5Jvbo6Mw (sherrodbrown.com) |
| Ken Paxton | TX Senate, R | youtube.com/user/KenPaxtonTX (kenpaxton.com) |
| Joe Lombardo | NV governor, R (inc.) | youtube.com/channel/UCQ52JaFDe77QrU5OTMWiemw (joelombardofornv.com/about) |
| Amy Klobuchar | MN governor, DFL | youtube.com/amyklobuchar (amyklobuchar.com); may be her long-standing account, not a campaign one |

No YouTube channel linked on the campaign site (single videos at most): Mary Peltola (AK Senate, D),
Roy Cooper (NC Senate, D), Michael Whatley (NC Senate, R), Dan Osborn (NE Senate, independent),
Cindy Holscher (KS governor, D), Ty Masterson (KS governor, R), Lisa Demuth (MN governor, R),
Aaron Ford (NV governor, D), David Crowley (WI governor, D).

Could not be read (UNVERIFIED): Jon Ossoff (GA Senate, D; the icons go through electjon.com/youtube
redirects), Steve Hilton (CA governor, R; page built in the browser), John James (MI governor, R;
pages redirect to a donation page), Tom Tiffany (WI governor, R; no links in the fetched text).

Nominee sources for the governor races: CA <https://ballotpedia.org/Gubernatorial_elections,_2026>;
IA <https://www.kaxe.org/news/2026-06-02/iowa-voters-pick-their-nominees-for-competitive-general-elections>;
KS <https://www.hppr.org/2026-10-14/kansas-governor-race-2026-election-candidates-masterson-holscher>;
MI <https://www.michiganpublic.org/politics-government/2026-08-04/john-james-wins-republican-primary-for-governors-race>
(Mike Duggan, independent, suspended 21 May 2026); MN <https://www.valleynewslive.com/2026/08/12/amy-klobuchar-wins-dfl-primary-minnesota-governor/>
and <https://www.kttc.com/2026/08/12/lisa-demuth-wins-republican-gubernatorial-primary-minnesota/>;
NV <https://www.fox5vegas.com/2026/06/10/aaron-ford-wins-nevada-democratic-governor-primary-sets-november-showdown-with-joe-lombardo/>;
WI <https://pbswisconsin.org/news-item/recapping-wisconsins-2026-primary-election-for-governor/>.

## To verify on the Mac

- [ ] Open each proposed handle's channel and confirm it is the campaign's (name, "Paid for by" on the site).
- [ ] For each entry DrJ approves: `node backend/src/radio/live/cli.js check https://www.youtube.com/@<handle>/live`
      while the campaign is live (or on a past stream) to confirm the probe ties the watch URL to the handle.
- [ ] `node backend/src/radio/live/cli.js feeds` lists the 18 as `[PROPOSED, cannot air]`.
