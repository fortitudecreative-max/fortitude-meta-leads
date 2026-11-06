// Fortitude Sales Kit — shared nav + per-page form persistence.
// Everything stays in the rep's own browser (localStorage). Nothing is sent anywhere.
(function () {
  var PAGES = [
    ["index.html", "Hub"],
    ["playbook.html", "Playbook"],
    ["router.html", "Deal Router"],
    ["snapshot.html", "Snapshot"],
    ["calculator.html", "Calculator"],
    ["field-card.html", "Field Card"],
    ["definitions.html", "Definitions"],
  ];

  function mountNav() {
    var here = (location.pathname.split("/").pop() || "index.html").toLowerCase();
    var nav = document.createElement("nav");
    nav.className = "kit-nav";
    var html = '<a class="brand" href="index.html">Fortitude <span>Sales Kit</span></a>';
    PAGES.forEach(function (p) {
      html += '<a class="tab' + (here === p[0] ? " active" : "") + '" href="' + p[0] + '">' + p[1] + "</a>";
    });
    html += '<span class="spacer"></span><a class="back" href="/">&larr; Leads dashboard</a>';
    nav.innerHTML = html;
    document.body.insertBefore(nav, document.body.firstChild);
  }

  // Persist every [data-persist] form control under one key per page.
  function storeKey() { return "fc-sales-kit:" + (location.pathname.split("/").pop() || "index"); }
  function readStore() {
    try { return JSON.parse(localStorage.getItem(storeKey()) || "{}"); } catch (e) { return {}; }
  }
  function writeStore(obj) {
    try { localStorage.setItem(storeKey(), JSON.stringify(obj)); } catch (e) { /* private mode: ignore */ }
  }
  function controls() { return Array.prototype.slice.call(document.querySelectorAll("[data-persist] [name], [data-persist][name]")); }

  function restore() {
    var data = readStore();
    controls().forEach(function (el) {
      if (!(el.name in data)) return;
      if (el.type === "checkbox") el.checked = !!data[el.name];
      else if (el.type === "radio") el.checked = data[el.name] === el.value;
      else el.value = data[el.name];
    });
  }
  function save() {
    var data = {};
    controls().forEach(function (el) {
      if (el.type === "checkbox") data[el.name] = el.checked;
      else if (el.type === "radio") { if (el.checked) data[el.name] = el.value; }
      else data[el.name] = el.value;
    });
    writeStore(data);
  }
  function clearAll() {
    if (!confirm("Clear everything on this page? This can't be undone.")) return;
    try { localStorage.removeItem(storeKey()); } catch (e) {}
    location.reload();
  }

  window.Kit = { save: save, restore: restore, clear: clearAll };

  document.addEventListener("DOMContentLoaded", function () {
    mountNav();
    restore();
    document.addEventListener("input", save);
    document.addEventListener("change", save);
    document.querySelectorAll("[data-action=clear]").forEach(function (b) { b.addEventListener("click", clearAll); });
    document.querySelectorAll("[data-action=print]").forEach(function (b) { b.addEventListener("click", function () { window.print(); }); });
    document.dispatchEvent(new Event("kit:ready"));
  });
})();
