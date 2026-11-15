(function () {
  "use strict";
  const PG = window.Pulsegrid;
  const $ = (s) => document.querySelector(s);

  let toastTimer;
  function toast(msg) {
    let el = $("#toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      el.className = "toast";
      el.setAttribute("role", "status");
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
  }

  let open = null;
  function closeMenu() {
    if (!open) return;
    open.menu.remove();
    open.anchor.setAttribute("aria-expanded", "false");
    open = null;
  }
  document.addEventListener("click", (e) => {
    if (open && !open.anchor.contains(e.target)) closeMenu();
  });

  function attachMenu(anchor, getItems, onPick) {
    function show() {
      closeMenu();
      const menu = document.createElement("div");
      menu.className = "menu";
      menu.setAttribute("role", "menu");
      menu.innerHTML = getItems()
        .map(
          (it) => `
        <div class="menu-item${it.selected ? " selected" : ""}" role="menuitem" tabindex="-1" data-id="${it.id}">
          <span class="menu-label">${it.dot ? `<span class="dot" style="background:${it.dot};box-shadow:none"></span>` : ""}${it.label}</span>
          ${it.meta ? `<span class="menu-meta">${it.meta}</span>` : ""}${it.selected ? "<span>✓</span>" : ""}
        </div>`,
        )
        .join("");

      menu.addEventListener("click", (e) => {
        e.stopPropagation();
        const item = e.target.closest(".menu-item");
        if (!item) return;
        closeMenu();
        onPick(item.dataset.id);
        anchor.focus();
      });
      menu.addEventListener("keydown", (e) => {
        e.stopPropagation();
        const items = [...menu.querySelectorAll(".menu-item")];
        const i = items.indexOf(document.activeElement);
        if (e.key === "ArrowDown") {
          e.preventDefault();
          items[(i + 1) % items.length].focus();
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          items[(i - 1 + items.length) % items.length].focus();
        } else if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          document.activeElement.click();
        } else if (e.key === "Escape") {
          closeMenu();
          anchor.focus();
        }
      });

      anchor.appendChild(menu);
      anchor.setAttribute("aria-expanded", "true");
      open = { menu, anchor };
      (menu.querySelector(".selected") || menu.querySelector(".menu-item")).focus();
    }

    const toggle = () => (open && open.anchor === anchor ? closeMenu() : show());
    anchor.addEventListener("click", toggle);
    anchor.addEventListener("keydown", (e) => {
      if (["Enter", " ", "ArrowDown"].includes(e.key)) {
        e.preventDefault();
        toggle();
      } else if (e.key === "Escape") closeMenu();
    });
  }

  const NAV = {
    Overview: ["overview"],
    Infrastructure: ["infra"],
    Incidents: ["incidents"],
    Tickets: ["tickets"],
    Reports: ["reports"],
    Team: ["team"],
    Admins: ["admins"],
    Settings: ["settings"],
  };
  function navTo(label, scroll = true) {
    const [view, anchor] = NAV[label];

    document.querySelectorAll(".nav-item").forEach((i) => i.classList.toggle("active", i.textContent.trim() === label));
    document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== "view-" + view));
    try {
      history.replaceState(null, "", view === "overview" ? location.pathname + location.search : "#" + view);
    } catch (_) {}
    const behavior = PG.reduceMotion || !scroll ? "auto" : "smooth";
    const el = anchor && document.getElementById(anchor);
    if (el) el.scrollIntoView({ behavior, block: "start" });
    else window.scrollTo({ top: 0, behavior });
  }
  function initNav() {
    document.querySelectorAll(".nav-item").forEach((item) => activate(item, () => navTo(item.textContent.trim())));
  }
  function openFromHash() {
    const label = { infra: "Infrastructure", incidents: "Incidents", tickets: "Tickets", reports: "Reports", team: "Team", admins: "Admins", settings: "Settings" }[location.hash.slice(1)];
    if (label) navTo(label, false);
  }

  function initSearch(onInput) {
    const input = $("#searchInput");
    if (!/Mac|iPhone|iPad/.test(navigator.platform)) $("#kbdHint").textContent = "Ctrl K";
    input.addEventListener("input", () => onInput(input.value));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        input.value = "";
        onInput("");
        input.blur();
      }
    });
    document.addEventListener("keydown", (e) => {
      const typing = /INPUT|TEXTAREA/.test(document.activeElement.tagName);
      const combo = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (combo || (e.key === "/" && !typing)) {
        e.preventDefault();
        input.focus();
        input.select();
      }
    });
  }

  function activate(el, fn) {
    el.setAttribute("role", "button");
    el.tabIndex = 0;
    el.addEventListener("click", fn);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        fn();
      }
    });
  }

  PG.ui = { toast, attachMenu, initNav, initSearch, activate, openFromHash, navTo };
})();