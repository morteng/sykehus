# What the data holds now

Generated from public/data/site.json and floors.json (24.10.2026). Kote in metres above sea level (NN2000).

## Buildings on the lot

| id (OSM) | OSM type | footprint m² | lowest ground | laser top | roof levels found | blocks |
|---|---|---|---|---|---|---|
| 134660428 | hospital | 616 | +13,23 | +33,09 | 15,86 · 31,11 · 33,11 | 43 |
| 134869340 | civic | 392 | +15,74 | +27,46 | 27,12 | 5 |
| 493996850 | civic | 522 | +15,70 | +23,64 | 23,32 | 7 |
| 493996851 | yes | 27 | +15,71 | +23,01 | 22,35 | 2 |
| 495955067 | civic | 2337 | +12,12 | +25,65 | 16,24 · 22,24 · 25,49 · 27,74 | 49 |
| 495955076 | hospital | 912 | +23,13 | +30,32 | 28,00 · 30,25 | 19 |
| 495955078 | civic | 154 | +24,99 | +31,97 | 31,61 | 7 |
| 495955085 | hospital | 244 | +23,54 | +35,62 | 30,16 · 33,66 · 36,16 | 20 |
| 646109878 | garages | 238 | +18,20 | +22,69 | 21,82 | 5 |
| 991418580 | warehouse | 47 | +23,38 | +26,98 | 26,75 | 3 |
| 991418581 | office | 180 | +23,09 | +29,64 | 25,96 · 29,46 | 10 |
| 991419938 | warehouse | 8 | +23,51 | +26,18 |  | 0 |
| 991419939 | warehouse | 7 | +23,40 | +26,23 | 26,11 | 1 |
| 991420107 | civic | 89 | +23,40 | +34,63 | 33,02 · 35,02 | 10 |
| 1163588204 | roof | 1812 | +15,25 | +21,48 | 18,12 · 20,12 · 23,38 | 56 |
| r13306175 | public_building | 8872 | +14,87 | +41,11 | 23,99 · 27,49 · 31,99 · 36,49 · 39,49 · 42,49 · 44,49 · 46,49 | 197 |
| 126454331 | public_building | 2551 | +14,87 | +70,96 | 66,25 · 69,75 · 73,25 | 102 |

Which is which on the ground: site-ids.png (north up, 50 m ticks). r13306175 is the main block (a multipolygon relation), 126454331 the high-rise.

## Floors traced so far (east wing)

| floor | kote | storey height | rooms stamped | m² stamped | wall shapes | source |
|---|---|---|---|---|---|---|
| 3. etasje | +23,54 | 4,22 | 17 | 9 | 412 | Ottar Arkitekter, Plan 3. etasje eksisterende, 17.12.2013 (byggesak 14/05636); nivåer fra Snitt fasade øst (14/00026) |
| 5. etasje | +32,02 | 3,50 | 88 | 1554 | 543 | Ottar Arkitekter, Plan 5. etasje eksisterende, 17.12.2013 (byggesak 14/05210); nivåer fra Snitt fasade øst (14/00026) |
| 6. etasje | +35,52 | 2,86 | 7 | 0 | 180 | Ottar Arkitekter, Plan 6. etasje eksisterende, 17.12.2013 (byggesak 14/05210); nivåer fra Snitt fasade øst (14/00026) |
| 7. etasje | +38,38 | 3,50 | 5 | 0 | 26 | Ottar Arkitekter, Plan 7. etasje eksisterende, 17.12.2013 (byggesak 14/05210); nivåer fra Snitt fasade øst (14/00026) |

4. etasje is at +27,76 (Fasade nord, 1bfc547ce73c); 3. etasje also shows +23,27 there.

## Trees

232 trees from the laser (tools/trees.py): [x, y, height, crown radius, form].
