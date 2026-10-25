# Request for the FDV drawings (milestone 6): draft for Morten

Nothing has been sent. Sending it is Morten's act: who it goes from, to whom and when are his to decide.

**Who holds them** (research notes f05ab822e97c §7):

1. Vestre Viken HF, Eiendom (FDV archive). Vestre Viken was still the registered owner (hjemmelshaver) in March 2026.
   The FDV systems are run with Helse Sør-Øst / Sykehuspartner, and the Multimap area and condition data are held by
   Helse Sør-Øst.
2. Failing that, Stor-Oslo Eiendom / Bragernes Park AS, the buyer (December 2022), and their plan consultant COERA AS.
   Their cases are PLAN-26/00886 and BYGG-26/00453.

The text below is in Norwegian, ready to send. Fill in the brackets.

---

**Emne:** Forespørsel om FDV-tegninger, gamle Drammen sykehus (Dronninggata 28, gnr. 114 bnr. 272)

Hei,

Jeg skriver for [faren min, pensjonert arkitekt / navn], som studerer hvordan bygningene på gamle Drammen sykehus kan
gjenbrukes. Områdereguleringen for Bragernes sentrum vest (vedtatt 17.02.2026) ber om at interiør og rivemasser gjenbrukes.
Arbeidet er privat og ikke kommersielt. Vi bygger en åpen modell av anlegget fra tegningene som allerede ligger i
kommunens byggesaker: <https://sykehus.gulden.no>.

Vi mangler plantegninger for flere fløyer og etasjer (Vestfløy, Venstre nordfløy, Sentralblokka) og vil gjerne be om
følgende, om dere kan dele det:

1. Plantegninger «som bygget» fra FDV-arkivet, alle fløyer og etasjer, helst som DWG, DXF eller IFC. PDF går også.
2. Snitt og fasader, særlig med etasjehøyder (koter).
3. Romlister med romnummer og areal (for eksempel fra Multimap), hvis det er mulig.

Vi bruker tegningene bare i modellen, oppgir kilden på hvert element og deler dem ikke videre uten at dere sier ja.
Hvis dette ligger hos Stor-Oslo Eiendom / Bragernes Park AS nå, er vi takknemlige for et hint om hvem vi bør spørre.

Med vennlig hilsen
[navn, telefon]

---

**When the files arrive:** put them in `twin-pack/fdv/` (not the repo, it is public), save each DWG as DXF (ODA File
Converter), list each storey in `tools/fdv.json` and run `python -I tools/dxfimport.py tools/fdv.json`, then
roompoly.py and ifc.py (README, run order). Whether the drawings may be shown on the public site depends on what the
holder says in reply.
