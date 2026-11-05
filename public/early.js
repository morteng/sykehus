/* Signed out from the start (U3662): when this browser never had Anton here (anton.js keeps the mark), the page is «anon» at once,
   so nothing of Anton flashes. The pill itself is the kit's and anton.js draws it when it has asked who the person is. */
(() => {
  let had = false; try { had = localStorage.getItem("sykehus-anton") === "1"; } catch { }
  if (!had) { document.body.classList.add("anon"); }
})();
