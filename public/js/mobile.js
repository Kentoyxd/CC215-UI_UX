/* Pulsegrid — mobile slide-out navigation. */
(function () {
  "use strict";
  const sidebar = document.querySelector(".sidebar");
  const btn = document.getElementById("navToggle");
  if (!sidebar || !btn) return;
  sidebar.id = "sidebar";

  const backdrop = document.createElement("div");
  backdrop.className = "nav-backdrop";
  document.body.appendChild(backdrop);

  const mq = window.matchMedia("(max-width: 860px)");
  const isOpen = () => document.body.classList.contains("nav-open");

  function setOpen(open) {
    document.body.classList.toggle("nav-open", open);
    btn.setAttribute("aria-expanded", String(open));
    btn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  }

  btn.addEventListener("click", () => setOpen(!isOpen()));
  backdrop.addEventListener("click", () => setOpen(false));
  // Event delegation, so the Admins link (added later by admin.js) closes the menu too.
  sidebar.addEventListener("click", (e) => e.target.closest(".nav-item, a") && setOpen(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen()) {
      setOpen(false);
      btn.focus();
    }
  });
  if (mq.addEventListener) mq.addEventListener("change", () => setOpen(false));
  else mq.addListener(() => setOpen(false));
})();