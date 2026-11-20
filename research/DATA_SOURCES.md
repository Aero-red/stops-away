# Melbourne train game — data sources (H1)

Task: LOTUS-037 · Work item H1 · Owner of this file: Hermes

> Transcribed verbatim by Claude Code on 2026-11-19 from Hermes's H1 result
> (`inbox/claude-to-hermes.md`, "From Hermes, 2026-11-18T23:24Z"), because that
> one-shot run could write only `inbox/` and the journal. Content is Hermes's;
> Claude Code has not re-checked these claims. Hermes may edit this file freely.

H1 findings — all checked 2026-11-19 AEDT (sandbox clock 2026-11-18T23:2xZ).

1. Static GTFS (VERIFIED)
- Portal dataset: https://opendata.transport.vic.gov.au/dataset/gtfs-schedule (resource 8af7737c-5c9e-4022-aa98-911aa04370a7, listed as 296.24 MB, last updated 15 Nov 2026).
- No key needed: the download link resolves to https://data.ptv.vic.gov.au/downloads/gtfs.zip. Anonymous GET returned HTTP 200, content-length 310,635,000, AmazonS3/CloudFront, Last-Modified 2026-11-12T01:03:19Z. I pulled the full 310,635,000 bytes anonymously and extracted it.
- Correction to the plan's assumption: it is not one flat feed but eight folders, each holding a nested google_transit.zip — 1 Regional Train, 2 Metropolitan Train, 3 Metropolitan Tram, 4 Myki Bus, 5 Regional Coach, 6 Regional Bus, 10 Interstate, 11 SkyBus. Metro trains = 2/google_transit.zip.
- Rolling 30 days from export, republished weekly; the metro feed's files are dated 2026-11-12.

2. Licence and attribution
- Licence (VERIFIED): Creative Commons Attribution 4.0 International — on the DataVic record for the same dataset (https://discover.data.vic.gov.au/dataset/gtfs-schedule, metadata last updated 16/11/2026, field "License"). Our CC BY 4.0 assumption is correct.
- Attribution text (NOT VERIFIED — not published anywhere I could find): neither the portal dataset page nor DataVic states a required attribution string for GTFS Schedule, and https://opendata.transport.vic.gov.au/copyright returns 404. Suggested wording for us (our choice, not a quoted requirement): "Source: GTFS Schedule, Department of Transport and Planning (Victoria), licensed under CC BY 4.0, https://creativecommons.org/licenses/by/4.0/".
- By contrast the PTV Timetable API does publish exact wording (VERIFIED, quoted): "Source: Licensed from Public Transport Victoria under a Creative Commons Attribution 4.0 International Licence." — https://www.vic.gov.au/public-transport-timetable-api, page updated 20 June 2025.

3. GTFS-Realtime, Metro Train (VERIFIED, with one source conflict to settle by test)
- Base: https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1/metro with paths /trip-updates, /vehicle-positions, /service-alerts (from the three OpenAPI JSONs linked on https://opendata.transport.vic.gov.au/dataset/gtfs-realtime, checked 2026-11-19).
- Auth header — the sources disagree: the dataset page prose says "The API Key is to be used in the request header. Header name is 'KeyID'"; the machine-readable OpenAPI for all three metro feeds declares apiKeyHeader name "Ocp-Apim-Subscription-Key", plus an alternative query parameter "subscription-key". Recommend we send the key in both KeyID and Ocp-Apim-Subscription-Key until we hold a key and can test which is accepted, and mark it unresolved in DATA_SOURCES.md.
- Rate limits — also disagree: page says 24 calls per 60 s (metro); OpenAPI says 20-27 calls per minute depending on payload size. Both state 30 s caching.
- Key issue: a portal account (guide "How to find your API key" at https://opendata.transport.vic.gov.au/Help-And-Support); the Vehicle Positions resource page points sign-up at https://data-exchange.vicroads.vic.gov.au/. I registered for nothing.

4. PTV Timetable API v3 (VERIFIED unless noted)
- https://www.vic.gov.au/public-transport-timetable-api; base URL https://timetableapi.ptv.vic.gov.au; v3 current (v2.3.0 docs still downloadable).
- Credentials: user ID ("devid") plus a 128-bit GUID API key, requested per the official RTF linked from that page: PTV-Timetable-API-key-and-signature-document.rtf. The address APIKeyRequest@ptv.vic.gov.au appears only in third-party write-ups — treat as NOT VERIFIED.
- Signing (VERIFIED, quoted from that official doc): "The signature value is a HMAC-SHA1 hash of the completed request (minus the base URL but including your user ID, known as 'devid') and the API key". Result is hex, appended as &signature=..., and the request string is case-sensitive — do not reorder or re-case parameters after signing.

5. Static GTFS counts — fetched, so measured not estimated
From 2/google_transit.zip as downloaded 2026-11-19 (feed export 2026-11-12):
- stops.txt, 2,868 rows: location_type 0 (platform/stop) 777; 1 (station) 226; 2 (entrance) 747; 3 (generic node) 1,118. Metro train station count = 226 (location_type=1), and all 777 platform stops resolve to one of those 226 parents, none orphaned.
- routes.txt, 34 rows = 17 lines plus 17 parallel "-R" Replacement Bus routes: Alamein, Belgrave, Cranbourne, Craigieburn, Frankston, Glen Waverley, Hurstbridge, Lilydale, Mernda, Pakenham, Flemington Racecourse, Sandringham, Stony Point, Sunbury, Upfield, Werribee, Williamstown.
- Parser gotcha: every route row has route_type 400, not the GTFS-standard 2 (rail). Filter on route_id prefix aus:vic:vic-02- and drop the "-R" duplicates rather than filtering on route_type.
- agency.txt: agency_name "Transport Victoria", agency_timezone Australia/Melbourne.
