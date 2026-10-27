/* Visitor first (Morten 2026-10-27: «fix FOUC and tabs showing and hiding for non-logged in visitors»). Runs in <head>, before the first paint:
   the page is a signed-out visitor's unless this browser holds the hint that a person was signed in ("sykehus-me" = "1", written by app.js when
   /api/meg answered). html.anon (sykehus.css) hides the Bygg, Anton and Gjengi tabs, «Nytt prosjekt», the pill and the feedback button, so a visitor
   never sees them shown and taken away. The hint is for the first paint only: the server refuses what a visitor may not do, and app.js / anton.js
   write the hint and lift or keep the class when /api/meg answers. Storage that throws counts as a visitor. */
try { if (localStorage.getItem("sykehus-me") !== "1") document.documentElement.classList.add("anon"); } catch (e) { document.documentElement.classList.add("anon"); }
/* a visitor who opens a project (?versjon=<id>, or #prospekt=<id>) lands on its Prospekt first; «Utforsk i 3D» and the card's links add &fra=, which keeps them here (prospekt.js sends a signed-in person on) */
try { var u = new URL(location.href), pid = u.searchParams.get("versjon") || (/^#prospekt=([^&]+)/.exec(location.hash) || [])[1], pk = u.searchParams.get("nokkel"); if (pid && document.documentElement.classList.contains("anon") && !u.searchParams.has("fra")) location.replace("prospekt.html?v=" + encodeURIComponent(pid) + (pk ? "&nokkel=" + encodeURIComponent(pk) : "")); } catch (e) {}
