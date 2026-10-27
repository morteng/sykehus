/* /prospekt/<id> and /prospekt.html?v=<id> (shared links) open the main page with its Prospekt view picked; the page itself is in prospekt-pane.js */
const q = new URLSearchParams(location.search), id = q.get("v") || (/^\/prospekt\/([^/]+)/.exec(location.pathname) || [])[1] || "", nokkel = q.get("nokkel");
location.replace(id ? `./?versjon=${encodeURIComponent(id)}${nokkel ? `&nokkel=${encodeURIComponent(nokkel)}` : ""}&vis=prospekt` : "./");
