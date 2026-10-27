/* Visitor first (Morten 2026-10-27: «fix FOUC and tabs showing and hiding for non-logged in visitors»). Runs in <head>, before the first paint:
   the page is a signed-out visitor's unless this browser holds the hint that a person was signed in ("sykehus-me" = "1", written by app.js when
   /api/meg answered). html.anon (sykehus.css) hides the Bygg, Anton and Gjengi tabs, «Nytt prosjekt», the pill and the feedback button, so a visitor
   never sees them shown and taken away. The hint is for the first paint only: the server refuses what a visitor may not do, and app.js / anton.js
   write the hint and lift or keep the class when /api/meg answers. Storage that throws counts as a visitor. */
try { if (localStorage.getItem("sykehus-me") !== "1") document.documentElement.classList.add("anon"); } catch (e) { document.documentElement.classList.add("anon"); }
/* a visitor on a project, not asking for 3D: no loading screen of the model over the Prospekt that app.js opens (it lifts this class when it has chosen the view) */
try { var q = new URLSearchParams(location.search); if (q.get("versjon") && q.get("vis") !== "3d" && document.documentElement.classList.contains("anon")) document.documentElement.classList.add("pk-wait"); } catch (e) {}
