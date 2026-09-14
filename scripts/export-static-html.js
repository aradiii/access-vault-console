/*
 * Static HTML export of the Operations Console (Task 20).
 *
 * Produces public/access-vault.html — a single, fully self-contained HTML
 * file that mirrors the live UI (all 4 views, real data snapshot, inline CSS,
 * vanilla-JS nav + mobile menu overlay + UTC clock). Works offline when
 * opened via file:// as well.
 *
 * HOW TO RE-RUN (after fleet data changes):
 *   1. Keep src/app/api/snapshot/route.ts (POSTs write public/access-vault.html).
 *   2. Serve this file to the browser and evaluate it, e.g.:
 *        cp scripts/export-static-html.js public/snap.js
 *        agent-browser open http://localhost:3000
 *        agent-browser wait --fn "document.body.innerText.includes('192.0.2.10')"
 *        agent-browser eval "fetch('/snap.js').then(function(r){return r.text()}).then(function(t){return eval(t)})"
 *        rm public/snap.js
 *   3. (Optional) strip the unused __nextjs-Geist @font-face blocks or inline
 *      their woff2 — the app actually renders with the system font stack, so
 *      they are dead weight either way.
 *
 * NOTE: run from a DESKTOP viewport (>= lg) so the <aside> sidebar is present.
 */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    const TABS = ["dashboard", "vault", "activity", "settings"];

    // ---- 1. serialize all stylesheets (dev-safe, skip dev overlay) ----
    const seen = new Set();
    const parts = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let text = "";
      try {
        const rules = sheet.cssRules;
        if (!rules) continue;
        text = Array.from(rules).map((r) => r.cssText).join("\n");
      } catch {
        continue;
      }
      if (!text || seen.has(text)) continue;
      if (text.includes("nextjs-portal")) continue;
      seen.add(text);
      parts.push(text);
    }
    const css = parts.join("\n\n");

    // ---- 2. capture each view by driving the real nav ----
    const LABELS = {
      dashboard: "Fleet Overview tab",
      vault: "Access Vault tab",
      activity: "Operational Log tab",
      settings: "System Settings tab",
    };
    const views = {};
    for (const t of TABS) {
      const btn = document.querySelector('aside button[aria-label="' + LABELS[t] + '"]');
      if (!btn) throw new Error("nav button not found: " + t);
      btn.click();
      await sleep(800);
      const wrap = document.querySelector('main div[class*="max-w-[1440px]"]');
      if (!wrap) throw new Error("view wrapper not found");
      // persist current values of controlled inputs
      wrap.querySelectorAll("input, textarea").forEach((el) => {
        if (el.type === "checkbox" || el.type === "radio") {
          if (el.checked) el.setAttribute("checked", "");
          else el.removeAttribute("checked");
        } else {
          el.setAttribute("value", el.value);
        }
      });
      wrap.querySelectorAll("textarea").forEach((el) => {
        el.textContent = el.value;
      });
      views[t] = wrap.innerHTML;
    }

    // ---- 3. clone current DOM and clean it ----
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll("script, nextjs-portal").forEach((n) => n.remove());
    clone
      .querySelectorAll(
        'link[rel="stylesheet"], link[as="font"], link[rel="preload"], link[rel="modulepreload"], link[rel="prefetch"], style'
      )
      .forEach((n) => n.remove());

    // ---- 4. replace view wrapper content with all four views ----
    const wrap2 = clone.querySelector('main div[class*="max-w-[1440px]"]');
    if (!wrap2) throw new Error("clone wrapper not found");
    wrap2.innerHTML = TABS.map(
      (t) =>
        '<div data-static-view="' +
        t +
        '"' +
        (t === TABS[0] ? "" : " hidden") +
        ">" +
        views[t] +
        "</div>"
    ).join("\n");

    // ---- 5. embed a mobile nav overlay built from the desktop sidebar ----
    const aside = clone.querySelector("aside");
    if (aside) {
      const overlay = document.createElement("div");
      overlay.id = "static-mobile-nav";
      overlay.setAttribute("hidden", "");
      overlay.innerHTML =
        '<div data-overlay-backdrop class="fixed inset-0 z-50 bg-black/60"></div>' +
        '<div class="fixed inset-y-0 left-0 z-50 w-[280px] border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-xl" role="dialog" aria-label="Main Navigation">' +
        aside.innerHTML +
        "</div>";
      clone.querySelector("body").appendChild(overlay);
    }

    // ---- 6. inline CSS ----
    const styleEl = document.createElement("style");
    styleEl.textContent = css;
    clone.querySelector("head").appendChild(styleEl);

    // ---- 7. interactivity: nav switching, mobile overlay, UTC clock ----
    const logic = `
      (function () {
        var MAP = {
          "fleet overview tab": "dashboard",
          "access vault tab": "vault",
          "operational log tab": "activity",
          "system settings tab": "settings"
        };
        var IND = '<span class="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-foreground" aria-hidden="true"></span>';
        function navButtons() {
          return Array.prototype.slice.call(document.querySelectorAll('button[aria-label]')).filter(function (b) {
            return MAP[b.getAttribute("aria-label").toLowerCase()];
          });
        }
        function activate(key) {
          Array.prototype.forEach.call(document.querySelectorAll("[data-static-view]"), function (v) {
            if (v.getAttribute("data-static-view") === key) v.removeAttribute("hidden");
            else v.setAttribute("hidden", "");
          });
          navButtons().forEach(function (b) {
            var on = MAP[b.getAttribute("aria-label").toLowerCase()] === key;
            if (on) b.setAttribute("aria-current", "page");
            else b.removeAttribute("aria-current");
            b.classList.toggle("bg-sidebar-accent", on);
            b.classList.toggle("font-medium", on);
            b.classList.toggle("text-foreground", on);
            b.classList.toggle("text-muted-foreground", !on);
            var ind = b.querySelector(":scope > span.absolute");
            if (on && !ind) b.insertAdjacentHTML("afterbegin", IND);
            if (!on && ind && ind.parentNode) ind.parentNode.removeChild(ind);
          });
        }
        navButtons().forEach(function (b) {
          b.addEventListener("click", function () {
            activate(MAP[b.getAttribute("aria-label").toLowerCase()]);
            var ov = document.getElementById("static-mobile-nav");
            if (ov) ov.setAttribute("hidden", "");
          });
        });
        var menuBtn = document.querySelector('button[aria-label="Open navigation menu"]');
        var ov = document.getElementById("static-mobile-nav");
        if (menuBtn && ov) {
          menuBtn.addEventListener("click", function () { ov.removeAttribute("hidden"); });
          var bd = ov.querySelector("[data-overlay-backdrop]");
          if (bd) bd.addEventListener("click", function () { ov.setAttribute("hidden", ""); });
        }
        setInterval(function () {
          var s = new Date().toISOString().slice(11, 19) + " UTC";
          Array.prototype.forEach.call(document.querySelectorAll('[aria-label="Current UTC time"]'), function (el) {
            el.textContent = s;
          });
        }, 1000);
        activate("dashboard");
      })();`;
    const scriptEl = document.createElement("script");
    scriptEl.textContent = logic;
    clone.querySelector("body").appendChild(scriptEl);

    // ---- 8. POST the assembled document to the snapshot route ----
    const html = "<!DOCTYPE html>\n" + clone.outerHTML;
    const res = await fetch("/api/snapshot", { method: "POST", body: html });
    const j = await res.json();
    const summary = {
      ok: true,
      bytes: html.length,
      css: css.length,
      views: Object.fromEntries(TABS.map((t) => [t, views[t].length])),
      route: j,
    };
    window.__SNAP_RESULT = summary;
    return JSON.stringify(summary);
  } catch (err) {
    const msg = String((err && err.message) || err);
    window.__SNAP_ERROR = msg;
    return JSON.stringify({ ok: false, error: msg });
  }
})()
