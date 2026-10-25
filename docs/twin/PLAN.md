# Digital twin of Gamle Drammen sykehus — plan

Dronninggata 28, gnr 114 bnr 272 (matrikkel: 51 107 m², 22 registered buildings incl. tilbygg, source c0a95410e252 p1). This plan says what the documents in `twin-pack/` tell us about the buildings, where the gaps are, how the data should be shaped, and in which order to build. It does not contain code. Document ids are the 12-character ids of `twin-pack/store/docs.sqlite`; `#p2` means page 2 of that document. Kote are in the drawings' own system (see §3.1 for how it relates to the laser's NN2000). Decimal comma throughout.

Grid: all Ottar/Ratio/Reinertsen sheets are drawn with the hospital grid horizontal; sheet-right is ESE (grid_deg −32,6° in `site.json`). "u" below is metres along that grid axis (positive toward Tybrings gate / east), "v" across it (positive toward Bergstien / north), both from the site origin.

---

## 1. The building as the documents describe it

The complex has grown around a 1887 core and is one connected block in OSM (relation r13306175, 8 872 m² footprint, laser base 14,87, top 41,11), with the high-rise cut out as its own way (126454331). The reuse question is about the parts in the table; the periphery (Søsterhjemmet, Bergstien 24, Tybrings gate 6, modules, garages) is listed afterwards.

Floor numbering is shared across all wings: "5. etasje" is +32,02 in the old wings and "C +31,77" in Sentralblokka (dd4c1f44fd50 shows both kote on one sheet; 81e6faa1e646 p1 "Eksit. Plan 5" high-rise). Kote ladder of the old wings, read on the vector sections 5c27a428f032 p1 and 1bfc547ce73c p1 (Ottar 2013–14):

| Etasje | Kote (old wings, axes 1–8 / ØN) | Kote (Midtfløy, snitt B-B 57dc6d477c88) | Kote (Sentralblokka) | Note |
|---|---|---|---|---|
| Kjeller / ok bunnplate | +19,50 … +19,9 | — | kjeller (depth not in pack) | 5c27a428f032: "+19,50" under gjennomkjøring |
| 2. etasje | +20,24 | — | SB 2 (1627cbd9e0c3, no kote stamp) | f36d080d5af8 (1974 Reber): "+20,28" |
| 3. etasje | +23,54 (+23,27 tilfluktsrom slab) | — | — | |
| 4. etasje | +27,76 | — | — | no plan exists in the pack |
| 5. etasje | +32,02 | +32,02 | C +31,77 | |
| 6. etasje | +35,52 | +35,44 | — | 6 and 7 are "teknisk/tak" over the 1–8 wing |
| 7. etasje | +38,38 (roof teknisk rom) | +39,11 (fysioterapi) | — | |
| Tak | — | +42,78 | top of high-rise ≈ laser 70,96 | |

Storey heights of the old wings from the 1974 lift-shaft drawing (f36d080d5af8 p1, Brødrene Reber, "DISPOTEGN", sjakthøyde 23 100): 3 270 / 4 220 / 4 250 / 3 425 / 3 635 / 3 200 from 2. etg +20,28 upward, which reproduces 23,54 → 27,76 → 32,02 → 35,4… and confirms the ladder is one system for the whole old block.

### 1.1 Wings

Names are those on Ottar's key plan (937d39a427f8 p1, "Lokaliseringsfigur", 2012) and the room-number prefixes on 2013–2019 plans (V, VN, M, ØN, SB). Historical names and years are from the DIVE analysis 3957fafe78ec (text export `twin-pack/work/text/3957fafe78ec.txt`) and the planbeskrivelse bb072470fab8.

| # | Wing (today / historical) | Prefix | OSM | Built | Storeys & kote | Basement | Construction | Facade | Joins |
|---|---|---|---|---|---|---|---|---|---|
| A | **Vestfløy** along Dronninggata (historical vestfløy 1911–14, 4th storey 1937–40; 1965 fyrhus/tøysentral low wing with 1967–70 west wing on top: føde/medisinsk) | V (e.g. V 651 Operasjon 2, a4c9a90c45e4 p2) | part of r13306175, west arm (u ≈ −70…−30); low 1965 part probably 134869340 (top 27,46) | 1911–14, 1937–40, 1965–70 | 4 storeys above Dronninggata + "6. etasje" dagkirurgi on top of the 1967 part, flat roof with ventilasjonsrom (c0d9952cb00c p1 "Snitt A-A og fasade vest", scan; b74abd2252c7 takplan 5. etasje "Vestfløy sputumrom"). Laser modes 42,5–43 and 44,5/46,5 inside west_b box | yes (fyrhus, tøysentral; "U" on 1964 plan 59b7482b45f1) | pusset tegl/betong 1911; betong 1965–70 | puss, hvitmalt (DIVE; fotos 2e7b285980b7, e6ff09383ab0) | west end of Midtfløy; Kir. poliklinikk in front (south) |
| B | **Midtfløy** (historical hovedfløy 1887, 3rd storey 1911–14, 4th 1937–40, + rear kitchen wing 1911–14/1918–19/1937–40) | M (M 523, 569, 501, 603, 680 EL-sjakt; "M 539 B") | r13306175 central spine (u ≈ −30…+5, v ≈ 40…65) | 1887–1940 | 2…7: 5 +32,02, 6 +35,44, 7 +39,11 (fysioterapi), tak +42,78 (57dc6d477c88 p1, 6303be0b820f) | yes (kjeller, 1964 plan) | tegl murverk (1887/1911), betong dekker 1937–40 (DIVE) | puss | hub: ØN to the NE, VN to the NW, Vestfløy W, high-rise S via Heisvestibyle / Heis 1–6 (e0b98d457242 p1 BR-06) |
| C | **Venstre nordfløy** (DIVE "midtre nordfløy", 1911–14 one storey, raised later; MR 2001 inserted between it and ØN) | VN | r13306175 NW arm (v ≈ 65…100, u ≈ −45…−20) | 1911–14, 1935?, 2001 MR | ≥ 4 storeys; plan 6 exists (a4c9a90c45e4 p2 "A-2060 Plan 6 eksisterende"; 0f91d8b99377 Ratio 2018 Plan 6 SDI, 1:100 vector); room ØN/VN kote not stamped | unknown | murverk / betong | puss | Midtfløy; MR-bygg 2001 (ccb8ea9191ec: "Nye MRI maskiner Midtfløy plan 3", Rambøll 2019) |
| D | **Østre nordfløy** (DIVE "nordre østfløy" 1911–14 one storey, raised to 4 in 1935 for røntgen/føde/operasjon; recovery 1965) | ØN (ØN 527–536 operasjonsstue 1–4; ØN 624/626) | r13306175 NE arm, N–S on the sheets (u ≈ −5…+8, v ≈ 55…95) | 1911–14, 1935, 1965 | 2…6: Operasjonsstue 1–4 at 5. +32,02; 6. etasje rooms, Heis 11, trapperom (a349b2b7a97f, e9d5e2080422; f61225f45a83 p1 BR-05 fire plan 5 shows the whole 5. etasje of ØN + the 1–8 wing + modulbygg) | yes (tilfluktsrom +23,27 under 3. etasje, 5c27a428f032) | murverk 1911 with betong 1935 | puss | runs N from Midtfløy; the 1–8 wing attaches at its east side at axis 1; Trappehus at the NE |
| E | **Axes 1–8 wing along Tybrings gate** — Ottar titles it "eksisterende østfløy" (352835b248d7 p2–p4, A-123.01/02); DIVE's 1958–63 **Østfløy** (røntgen, operasjon, sentrallab ~1 000 m² each, underetasje with auditorium and tilfluktsrom) | M 5xx B / ØN (mixed; 2013 trace used `wing: Østfløyen`) | r13306175 east arm (u ≈ 6…46, v ≈ 53…89) | 1958–63 (see conflict §3.2) | 8 bays (6 950 / 6 400 …), A–D = 15,2 m wide; 2. etg +20,24 gjennomkjøring/parkering under the east end, 3. +23,54 RØNTGEN/VENTE, 4. +27,76, 5. +32,02 operasjonsstue 5–9, roof +35,52 with TEKNISK ROM (6.) to +38,38, "TAK OVER 3 ETASJE" strip on the south (bcf3836fa294, a349b2b7a97f, e9d5e2080422, f6c1acb26acd; facades 1bfc547ce73c nord, bc0fee0e71c9 øst) | yes (+19,50 / tilfluktsrom) | betong søyler/dekker (b95d54fc7802 "plan 3 med søyler"; 1:200) | puss, paired windows in 3 rows (nord facade) | ØN at axis 1 (west); Trappehus NE; modulbygg 2014 placed on the roof over 5. etasje (axes 1–14, tak +42,78) |
| F | **Kirurgisk poliklinikk** (1967–70, low wing in front of hovedfløy) | — (not in any plan in the pack) | r13306175 south part next to the high-rise cut (u ≈ 0…30, v ≈ 10…40); laser level 31,99 | 1967–70 | 2–3 storeys over terrain; DIVE only | unknown | betong | puss | between Midtfløy and Sentralblokka; the obs.post SB 2 corridor (1627cbd9e0c3) opens into it |
| G | **Sentralblokka / høyblokka** (sørfløy 1937–40 demolished for it) | SB (SB 2.1xx, 5.1xx, 6.1xx, 12.xxx) | 126454331 (2 551 m², top 70,96, OSM height 55) | 1972–80 | 14 storeys + kjeller; 26 m × ~100 m; 2. etg mottak, 3–10 sengeposter, 11 barn, 12 ØNH, 13 øye, 14 fys.med/teknisk (a00300169fdb samlerapport; bb072470fab8 §1.4). Plans in pack: 2 (1627cbd9e0c3, 1:50 vector), 5 part (81e6faa1e646, c2e27e986047 "C +31,77"), 11 (d2b545c4d05c), 12 (937d39a427f8 p2, axes 9–25 at 3 750 c/c), 12–13 schematic (713a7a590d0e) | 1 kjeller; ~80 Benoto piers + ~160 piles, slurry wall NW | naturbetong facade elements, load-bearing facade walls, ribbed slabs 1 250/170/410 (formtegning 6877bcbbcffd, 6c2ece2490ff) | naturbetong (exposed aggregate) | Heisvestibyle / Heis 1–6 into Midtfløy at every storey up to 6 (e0b98d457242 p1); "TAK OVER 2. ETASJE, SIDEBYGG" east of it |
| H | **Forsyningssentralen / Forsyningsblokka**, west of Dronninggata | — | 495955067 (2 337 m², 12,12…25,65) | 1980s? (not dated in the pack) | 2 storeys + kjeller; plan 2 etg 2008 (e3b4d4dd7334, 5cd8a2a5ceb5: kjøkken, kjølerom, kontorer); matrikkel type 739; 2026 application for 3–5 years interim use, field B4 regulated for demolition (8c33c2da02e7, bb072470fab8) | yes | betong | betong/plate (fotoskisse 2e7b285980b7) | culvert/bridge to the hospital under Dronninggata (not drawn in the pack) |

Other buildings (identification from DIVE, matrikkel and footprints; **uncertain** where marked):

| OSM | What | Year | Evidence |
|---|---|---|---|
| 134660428 | Søsterhjemmet, Welhavens gate 1, 5 storeys, saltak (laser top 33,09) | 1952 | DIVE; address in c0a95410e252 |
| 493996850 (+851) | Modulbygg "Bygg 115", poliklinikk, 3 storeys, kote +15,86/+15,90 → +24,60 (first) / +27,45 (revised) | 2011–12 | CoNova A-0601 3c07a077ffcf p1, dceb2f42c457 p1, situasjonskart 21cf141048a5 p1 (32,2 × 15,8 m) |
| 1163588204 | Parking deck with legevakt on top | 2002 | DIVE; laser 15,25…21,48 |
| 134869340 | Probably the 1965 fyrhus/tøysentral (low west part) — **uncertain**, could be part of Vestfløy | 1965 | footprint position; laser top 27,46 |
| 495955085 | Trappehus / NE stair-and-lift tower (laser 23,54…35,62) — **uncertain**; a349b2b7a97f shows a TRAPPEHUS at the NE corner of the 1–8 wing | 1963? | footprint at u ≈ 40, v ≈ 90 |
| 495955076 | Patologi/kapell Bergstien 28–30 (2nd storey 1996) — **uncertain** | 1974–75 | DIVE; position east of the lot |
| 991418581, 991420107 | Kontorbrakker (2001) on garage | 2001 | DIVE "modules 2001–2019" |
| 646109878, 991418580, 991419938/9 | garages, sheds | — | OSM tags |
| Bergstien 24 (fredet, matrikkel 158507250), portnerbolig 1911–14, Tybrings gate 6 (1938), Dronninggata 18 (1932) | not among own buildings in site.json | | c0a95410e252 p1 (isFredet true), DIVE |

### 1.2 What is unsure, and what settles it

- Which footprint is which wing. The 1:1000 "Eksisterende situasjonsplan" (534362efe171 p1, vector; 8897d6509542 scan) draws every wing as its own outline with name. Georeferencing it onto `site.json` (two control points: the high-rise corners) settles the wing ↔ footprint mapping and gives the wing polygons for the data model.
- Age of the 1–8 wing (1935 raise vs 1963 new build) — §3.2.
- Floors 2 and 4 of all old wings, floors U–1 of everything: no plans in the pack (§2).
- Vestfløy storey kote: only scanned sheets without a readable kote ladder; 5c27a428f032 covers the east end only. The 1974 Reber sheet is the only numeric source for storey heights west of ØN.

---

## 2. Coverage: what the pack contains

Trust: A = vector, scale known, kote stamped; B = vector, scale known, no kote; C = scan, scale known; D = scan or sketch, scale unknown or not to scale. "existing" = shows the building as built at that date; "proposed" = shows a change (useful for what was altered afterwards).

### 2.1 Plans (wing × etasje)

| Wing | U/1 | 2 | 3 | 4 | 5 | 6 | 7 / tak |
|---|---|---|---|---|---|---|---|
| Vestfløy (V) | — | — | — | — | b74abd2252c7 (Sweco 2016 takplan "Vestfløy sputumrom", 1:100, C) | a4c9a90c45e4 p2 A-2060 plan 6 eksisterende (scan 2013, C); c0d9952cb00c plan 6 dagkirurgi + snitt A-A (scan, C) | a4c9a90c45e4 p1 A-2070.1 plan tak (scan, C) |
| Midtfløy (M) | — | — | ccb8ea9191ec MR plan 3 (Rambøll 2019, existing+proposed, D) | — | f61225f45a83 BR-05 fire plan 5 (Reinertsen 2013–15, 1:200 vector, B; covers M/ØN/1–8/module) | 0f91d8b99377 Ratio 2018 plan 6 (1:100 vector, B), bab0ca8c8834 2019 plan 6 (1:100, B), e0b98d457242 BR-06 plan 6 sterilavdeling (1:150 vector, B), a4c9a90c45e4 p2 (C) | 57dc6d477c88 (snitt only) |
| Venstre nordfløy (VN) | — | — | — | — | — | a4c9a90c45e4 p2 (C), 0f91d8b99377 (B) | a4c9a90c45e4 p1 (C) |
| Østre nordfløy (ØN) | — | — | bcf3836fa294 (A, 1:200, +23,54; west part) | — | a349b2b7a97f (A), 8536716659bf (proposed), f61225f45a83 (B) | e9d5e2080422 (A), 1aef93de7451 (proposed sterilsentral) | f6c1acb26acd (A, 7. etasje FYSIOTERAPI over the junction) |
| 1–8 wing ("østfløy") | 5c27a428f032 (section only: kjeller +19,50, 2. +20,24) | — (gjennomkjøring visible in section/facade only) | bcf3836fa294 (A; traced as 3-ost), b95d54fc7802 plan 3 med søyler (A) | **none** (only facade rows 1bfc547ce73c) | a349b2b7a97f (A; traced 5-ost), da72b0d93f6e proposed module, dd4c1f44fd50 | e9d5e2080422 (A; traced 6-ost = teknisk rom and roof), e9ee98259ee1 proposed | f6c1acb26acd (A; traced 7-ost), f299348bf465 proposed, 65255183d766 |
| Kir. poliklinikk | — | — | — | — | — | — | — |
| Sentralblokka (SB) | — | 1627cbd9e0c3 A-2020 plan 2 obs.post (1:50 vector, B, rooms SB 2.1xx with m²), 1347009eb117 arealdisponering | — | — | 81e6faa1e646 "Eksit. plan 5" (2020, D, C +31,77), c2e27e986047 (2016), 65cf664c9ac0/c377e84304ed (2023 proposed) | — | 11: d2b545c4d05c A-2110 (2011, existing+proposed, D), 12de9b405a96; 12: 937d39a427f8 p2 (1:200 scan, C); 12–13 schematic 713a7a590d0e |
| Forsyningssentralen | — | e3b4d4dd7334, 5cd8a2a5ceb5 (2008, plan 2 etg, D) | | | | | |
| Modulbygg Bygg 115 | 07eb28fd8a80 / 1bb53743f294 plan 1, bb60b4b02e1f / 97fc12ea798d plan 2 (2011, D) | | | | | | |

Historic plans: 1963 generalplan 5f03a9b5a660 (letters V, A, K, T, N, G, M, F, P, S, Ø, PO, PA, PS, KA; D), 1964 underetasje 59b7482b45f1 (D), DIVE period map 185d76f2bf7c (50 m bar, D). The DIVE phase maps cc1147d68f4b … b5055eb8366b (p40) have not been looked at.

### 2.2 Facades

| Sheet | Year | Shows | State | Kind | Scale | Trust | Missing |
|---|---|---|---|---|---|---|---|
| 1bfc547ce73c p1 | 2013/14 | Fasade nord of the 1–8 wing + ØN west end: 3 rows of paired windows (3., 4., 5.), 6. etg rooms at the west, roof +38,38; kote ladder 23,27 23,54 27,76 32,02 35,52 38,38 | existing + new module | vector | 1:200 | A | nothing west of ØN |
| bc0fee0e71c9 p1 | 2013/14 | Fasade øst of the 1–8 wing with gjennomkjøring and Trappehus | existing + new | vector | 1:100/1:200 | A/B | |
| 161c15804b9d, 7707ccf6cc1c, 9fa1d61282bd, 504455486add | 2014 | same facades after ombygging (module on the roof) | proposed | vector/pdf | | B | |
| c0d9952cb00c p1 | 2013 | Fasade vest (Dronninggata) + snitt A-A, Vestfløy/Midtfløy: 4 storeys, flat roof with ventilation rooms | existing | scan | ~1:200 | C/D | no kote |
| 90a04eb00225 | 1972 | Sentralblokka south facade with the level column (crop `work/crops/90a04eb00225-levels.png`: 14 levels, unreadable at render resolution) | design | scan | | D | needs a higher-resolution render to read kote |
| 3c07a077ffcf p1, dceb2f42c457 p1 | 2011 | Modulbygg Bygg 115 fasader (+15,86 … +24,60; revised +27,45) | proposed | scan | 1:100/1:200 | C | |
| 2e7b285980b7, e6ff09383ab0 | 2018/2020 | photos: Forsyningsblokka; facade photo (the two used as viewer textures) | as built | photo | — | — | |
| aa952b3f0586 | 2026 | OR BSV kvalitetsprogram (Bergstien 24 facades, new development) | proposed | pdf | | — | not the hospital |

No facade of Sentralblokka, Midtfløy south, VN, Kir. poliklinikk or the inner courtyards exists in the pack.

### 2.3 Sections

| Sheet | Year | Shows | Trust | Missing |
|---|---|---|---|---|
| 5c27a428f032 p1 | 2014 | Snitt through the 1–8 wing at the east end, U/2/3/4/5/6 with full kote ladder (+19,50 … +38,38) | A | west of axis 1 |
| 57dc6d477c88 p1, 6303be0b820f | 2014 | Snitt B-B sterilsentral (Midtfløy/ØN junction): 5. +32,02, 6. +35,44, 7. +39,11 fysioterapi, tak +42,78; storey heights 3 420 / 3 670 | A ("ikke i målestokk", but kote stamped) | |
| c0d9952cb00c p1 | 2013 | Snitt A-A Vestfløy | C/D | kote |
| f36d080d5af8 p1 | 1974 | Lift-shaft section (Reber): storey heights 3 270 / 4 220 / 4 250 / 3 425 / 3 635 / 3 200 from +20,28 | B | which lift (probably Heis 11 or the ØN lift) |
| 92ef230d4e11 | 2011 | Modulbygg snitt | C | |
| 352835b248d7 p2–p4 | 2013 | Module + "eksisterende østfløy": plans and sections with +23,54 and the new columns axes 1–14 | B | |

No section through Sentralblokka (except the formtegning 6c2ece2490ff for "dekke over 5. etg"), none through Vestfløy with kote, none N–S through ØN/VN.

### 2.4 Site plans

534362efe171 p1 (1:1000 vector, 2014, all wings as separate footprints — the georeferencing key), 8897d6509542 (scan of the same), d46524dcc90a (2011 FKB situasjonskart with spot heights), 21cf141048a5 (2011 1:500 forenklet situasjonskart EUREF89, for the module), 0950ada3c4f8 (Rambøll 2021 borehole plan 1:1500 with footprints and terrain), 754c52107f15 (2026 plankart, buildings to be removed).

---

## 3. Conflicts between drawings and the laser, and what to trust

### 3.1 Height datum (settled within tolerance)

Sampled DOM over the traced 1–8 wing (`work/scripts/overlay.py`, boxes in hospital-grid metres, 1 m raster):

| Drawn surface (kote) | Laser mode (NN2000) | Δ |
|---|---|---|
| Tak over 5. etasje +35,52 (box wing18_a/c, strip_u30) | 36,0–36,5 | +0,5…+1,0 (parapet/roof build-up) |
| Roof of teknisk rom +38,38 (strip_u10/u20) | 38,5–39,5 | +0,1…+1,1 |
| Tak over 3. etasje +27,76 | 27,49 (site.json level) | −0,3 |
| Module roof / tak +42,78 (box west_b) | 42,5–43,0 (958 of 1 728 samples) | −0,3…+0,2 |

The drawings' kote and the laser agree to within one metre, with the laser mostly 0,3–1,0 above drawn slab tops. NN1954→NN2000 in Drammen is about +0,1 m, so the drawings could be either; for the twin, **use the drawn kote as NN2000** and expect roof surfaces 0,5 m above them. The previous worry about 39,49 vs 38,38 is explained by the teknisk rom roof build-up plus the fysioterapi storey (+39,11 → 42,78) sitting next to it.

### 3.2 Age and identity of the 1–8 wing (open)

Ottar 2013 calls it "eksisterende østfløy"; the DIVE text places the 1958–63 Østfløy with røntgen/operasjon/sentrallab, and the traced 3. etasje is RØNTGEN while 5. etasje is operasjon — this matches 1963. The 1935 nordre østfløy (also røntgen/operasjon) is then today's ØN wing (N–S). Treat E as 1958–63 and D as 1911/1935; **settle it** by reading the DIVE phase maps (cc1147d68f4b…b5055eb8366b p40) and the 1963 generalplan letter "Ø" position.

### 3.3 Placement of the traced floors (check needed)

88–92 % of the traced wall points fall inside the OSM relation footprint; 129–144 points of each floor fall inside the high-rise way (126454331) and the eastern end (u 36…46) reads as ground (23,0–23,5) in the laser for a fifth of the samples. Either the control points in `tools/plans.json` put the wing 2–4 m too far east/north, or the OSM east arm is drawn short. The laser agrees with OSM, not with the trace. **Trust the laser**; re-fit the control points after the 1:1000 situasjonsplan is georeferenced (M1).

### 3.4 OSM relation vs. wings

r13306175 merges Vestfløy, Midtfløy, VN, ØN, the 1–8 wing and Kir. poliklinikk into one footprint with one base/top. `tools/massing.py` therefore gives the old block a single top (41,11) and roof levels 23,99…46,49 without knowing which wing has which. Trust the laser levels; replace the relation with wing polygons from the situasjonsplan (M1).

### 3.5 Two "6. etasje" heights

Midtfløy 6. etasje is +35,44 (57dc6d477c88) while the 1–8 wing roof/teknisk level is +35,52 (1bfc547ce73c) — 8 cm, a real step or two survey sources. Model as two storeys in different wings; keep both values with sources.

### 3.6 floors.json

`wing: "Østfløyen"` on all four floors mixes the ØN wing (west of axis 1) with the 1–8 wing; 7-ost height 3,5 is assumed (the snitt gives +39,11 → +42,78 = 3,67 for fysioterapi); 4. etasje (+27,76) is missing because no plan exists; 6-ost height 2,86 = 38,38 − 35,52 is right for the teknisk rom.

---

## 4. Data model

One master file `public/data/twin.json` replaces `floors.json` and the own-building part of `site.json`; `tools/twin.mjs` exports today's `floors.json` and `site.json` shapes from it so the viewer keeps working until it reads twin.json directly. Every element carries `src`: a list of `"<docid>#p<n>"` plus a short note of what was read there.

```json
{
  "crs": { "epsg": 25833, "origin": [230311, 6633185], "heights": "NN2000", "grid_deg": -32.6 },
  "wings": [
    { "id": "on", "name": "Østre nordfløy", "aliases": ["ØN", "nordre østfløy"],
      "osm": ["r13306175"], "built": [{ "year": 1914, "storeys": 1 }, { "year": 1935, "storeys": 4 }],
      "footprint": [[-5.2, 55.0], [8.1, 55.0], [8.1, 95.3], [-5.2, 95.3]],
      "construction": "murverk, betongdekker 1935", "facade": "puss, hvitmalt",
      "joins": ["m", "e"], "src": ["534362efe171#p1 outline", "3957fafe78ec years"] }
  ],
  "storeys": [
    { "id": "5", "name": "5. etasje", "kote": 32.02, "height": 3.50,
      "per_wing": { "sb": { "kote": 31.77 }, "m": { "kote": 32.02, "height": 3.42 } },
      "src": ["5c27a428f032#p1", "57dc6d477c88#p1", "dd4c1f44fd50#p1 C +31,77"] }
  ],
  "walls": [
    { "id": "w5-0412", "wing": "e", "storey": "5", "poly": [[20.1, 60.2], [26.9, 60.2], [26.9, 60.5], [20.1, 60.5]],
      "bearing": null, "src": ["a349b2b7a97f#p1 grey fill"],
      "openings": [{ "type": "window", "along": [1.2, 2.4], "sill": 0.9, "head": 2.3, "src": ["1bfc547ce73c#p1 row 5"] }] }
  ],
  "rooms": [
    { "id": "ØN 527", "wing": "on", "storey": "5", "name": "Operasjonsstue 1", "use": "operasjon",
      "area_m2": 41.8, "area_from": "stamp", "poly": [[...]], "src": ["a349b2b7a97f#p1 stamp"] }
  ],
  "facades": [
    { "id": "e-nord", "wing": "e", "side": "nord", "line": [[6.0, 68.2], [46.0, 68.2]],
      "levels": [23.54, 27.76, 32.02, 35.52, 38.38], "material": "puss",
      "openings": [{ "storey": "4", "along": [3.1, 4.3], "sill": 28.66, "head": 30.06 }],
      "photo": "photos/e6ff09383ab0.jpg", "src": ["1bfc547ce73c#p1"] }
  ],
  "sections": [
    { "id": "snitt-B-B", "line": [[-8.0, 58.0], [-8.0, 72.0]], "levels": { "5": 32.02, "6": 35.44, "7": 39.11, "tak": 42.78 },
      "image": "sheets/57dc6d477c88-p1.png", "src": ["57dc6d477c88#p1"] }
  ],
  "sources": {
    "a349b2b7a97f#p1": { "title": "PLAN 5. ET EKSISTERENDE", "year": 2013, "kind": "vector", "scale": 200,
      "state": "eksisterende", "trust": "A", "georef": { "cp": "1117.85,481.76,75.2,34.9;1134.14,186.39,65.1,17.0" } }
  }
}
```

Rules: coordinates in site metres; `poly` for walls (as today), `openings.along` as metres from the first point of the wall/facade; `area_from` is `stamp` (read from the drawing), `poly` (computed) or `brief` (from text such as a00300169fdb's BRA per storey); a room without a polygon is allowed (then only in lists); `per_wing` overrides on storeys carry the small kote differences (§3.5). Facades and sections keep a link to their sheet render so the viewer can show the drawing next to the model.

---

## 5. Pipeline per source kind

| Source | Steps | Tools (exist → write) |
|---|---|---|
| Vector plans (A/B) | pdfpaths.py grey fills → walls; rooms.py stamps → rooms; georef.py control points → site metres; new: `roompoly.py` flood-fills the space between walls to give each stamp its polygon and a computed area to compare with the stamp; `wingsplit.py` assigns walls/rooms to wings by the footprints from M1 | exist: pdfpaths, rooms, georef, sheetshift; write: roompoly, wingsplit, twin.mjs (merge + export) |
| Vector facades and sections (1bfc547ce73c, bc0fee0e71c9, 5c27a428f032, 57dc6d477c88) | `levels.py`: find horizontal lines with a kote text near them → storey levels per wing; `openings.py`: rectangles between two consecutive levels with width 0,6–3 m → windows/doors, projected onto the facade line in plan via the sheet's axis bubbles (axes 1–8 appear on both plan and facade) | write: levels.py, openings.py (pdfminer, no PyMuPDF) |
| 1:1000 situasjonsplan (534362efe171 p1) | georef with two high-rise corners; closed polylines → wing footprints; name texts → wing names | exist: georef; write: footprints.py |
| Scans (C/D: Vestfløy plan 6/tak, SB plan 11/12, 1972 facade, DIVE maps) | render at 300 dpi (`twin-pack/sheets`), place by two control points on the hospital grid, then **trace by hand** in the viewer: a "trace" mode where the sheet is shown as a ground image and walls are drawn as rectangles with snapping to the grid axes, saved to twin.json with `src` = the sheet. Who: Morten first; his father can do it with the same two-click tool once it is calm enough — it is the kind of work he knows | write: viewer trace mode (public/trace.js), tools/trace-import.mjs |
| Laser | laser.py levels per wing footprint (not per OSM relation) → storey count check and roof surfaces per wing | exist: laser.py, massing.py → adapt to wing polygons |
| Text (DIVE, samlerapport, planbeskrivelse) | read once, type the facts into `wings[].built/construction/facade` and `sources` with page refs; never automatic | by hand |

All Python with `-I`, scripts in `tools/` (repo) or `twin-pack/work/scripts/` (scratch), documents passed as arguments.

---

## 6. What he sees

1. Opens sykehus.gulden.no. The site in 3D as today, but each wing has its own colour and its name floats above it: Vestfløy, Midtfløy, Venstre nordfløy, Østre nordfløy, Østfløy, Kir. poliklinikk, Sentralblokka, Forsyningssentralen.
2. Clicks a wing: a card with year(s), storeys with kote (2. etg +20,24 … tak), construction, facade, and the sheets that exist for it — each a thumbnail that opens the drawing.
3. Chooses an etasje in the ladder on the left (U, 1, 2, 3 … 14). The model cuts 1,2 m above that floor for all wings at once; wings with no plan at that level show hatched grey ("ingen tegning"), the others show walls and rooms with names and m².
4. "Plan" button: north-up ortho plan of that etasje, like a tegning; room labels, 10 m grid, and a scale bar. Printable.
5. "Snitt": picks one of the drawn section lines; shows the sheet image next to the model cut along that line with the kote ladder.
6. "Fasade": the north or east facade with real windows from the sheets; other facades keep the photo texture until traced.
7. Connector (MCP): `about_wing(name)`, `storeys(wing)`, `rooms(wing, etasje, use?)` with areas and sources, `openings(facade)`, `sources(element_id)` return the same facts as the cards, so a question such as "hvor stor er operasjonsavdelingen i 5. etasje" is answered from twin.json with sheet references, and `show_building`/`floor_plan` move the viewer there.

---

## 7. Documents to request

| From | What | Why |
|---|---|---|
| Vestre Viken HF Eiendom / FDV (and Sykehusbygg for the OR BSV handover) | As-built DWG/IFC of all wings, all storeys (the Multimap base and the Multiconsult tilstandsnotater 2016/2018 named in f05ab822e97c §8) | closes every empty cell in §2.1, gives kote for Vestfløy/VN/SB |
| Stor-Oslo Eiendom / Bragernes Park AS / COERA | the drawing archive they received with the property; Norconsult's Forma model and formtegning extracts | the high-rise structure and the 1972 sections with the level column |
| Drammen kommune byggesak / Byarkivet | Nilsen & Grenager 1911–14 and 1935–40 drawings; 1958–63 Østfløy byggesak; 1967–70 Vestfløy/poliklinikk | construction and original plans of the old wings; settles §3.2 |
| Kartverket / Drammen kommune geodata | FKB-Bygning with bygningsnummer polygons and takflater; the 2011 FKB sheet d46524dcc90a in vector | wing footprints independent of OSM; links to matrikkel bygningsnummer 158507277/455/501 etc. |
| Riksantikvaren / Buskerud fylkeskommune | the fredningssak 151425 documentation (Bergstien 24 and the 1911 wings) | architectural description and photos of the old wings |
| NTNU (2025 thesis) | model files if any | possibly a traced model of the old block |

---

## 8. Order of work — milestones

1. **Wings on the map** (1–2 days). Georeference 534362efe171 p1, write footprints.py, split r13306175 into wing polygons with names/years/storeys (laser levels per wing), fix the control points of the four traced plans (§3.3), rename `wing` in floors.json. Deploy: coloured, named wings; click → card. Most useful: it is the vocabulary everything else hangs on.
2. **Kote ladder and real windows on the 1–8 wing and ØN** (2–3 days). levels.py + openings.py on 1bfc547ce73c, bc0fee0e71c9, 5c27a428f032, 57dc6d477c88; twin.json with storeys per wing; viewer facade mode shows the north and east facades with windows, the ladder on the left works for all levels incl. 2. and 4. (walls hatched where no plan). Deploy: the wing he has data for becomes a believable building.
3. **The rest of 5. and 6. etasje in vector** (2 days). f61225f45a83 (BR-05, whole plan 5 of M/ØN/1–8/module), e0b98d457242 and 0f91d8b99377 (plan 6 M/VN/ØN), 1627cbd9e0c3 (SB plan 2, with m²). roompoly.py for areas. Deploy: two storeys continuous across four wings plus the obs.post.
4. **Trace mode for scans** (3 days). *Status 25.10.2026: trace mode (`?spor`), scanwalls.py and tracefit.py (machine trace and placement), scanrooms.py and stamps.py (room stamps), trace-import.mjs. Traced and on the map, all four sheets: Forsyningssentralen 2. etasje (607 walls, 51 rooms), Sentralblokka 11. etasje (vector, 2 387 walls, 83 rooms with areas), Sentralblokka 12. etasje (150 dpi scan: about half its walls found, 30 rooms), Vestfløy 6. etasje (86 walls, 18 rooms). All machine-read and marked so ("ikke kontrollert"); SB 12's walls are the weakest and the first to correct by hand in `?spor`. Placement checks: Vestfløy 6. room outlines match 7 of 8 stamped areas within 10 %; SB 12's stairs and lift lobby stand over SB 11's (1,3 m).* Viewer trace tool; trace Vestfløy plan 6 and tak (a4c9a90c45e4), SB plan 12 (937d39a427f8 p2) and 11 (d2b545c4d05c), Forsyningssentralen plan 2 (e3b4d4dd7334). Deploy: Vestfløy and the high-rise stop being boxes.
5. **Sections and documents per element** (2 days). sections[] with sheet images; the card lists sources; MCP tools in §6.7. Deploy: every number in the viewer can be traced to a sheet.
6. **Request and import FDV drawings** (external). *Status 25.10.2026: the import is ready and tested (`tools/dxfimport.py`, `tools/fdv.json`, `tests/dxfimport_check.py`); the request is drafted in `docs/twin/fdv-request.md` and waits for Morten to send it.* When DWG arrives: a dxf importer into the same walls/rooms shape, wing by wing, replacing traced data where trust is higher.

Scratch produced for this plan: `twin-pack/work/scripts/overlay.py`, `twin-pack/work/overlay.svg/.png` (own buildings, traced walls, 10 m grid), `twin-pack/work/crops/*.png`, `twin-pack/work/text/*.txt`.
