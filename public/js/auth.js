/* Pulsegrid — sign-in and cloud sync (Firebase Auth + Firestore).
   Flow: sign in → check admin access (or claim an admin invite) → load this user's data
   into localStorage → start the app.
   Afterwards every "pulsegrid:*" localStorage write is also saved to Firestore (users/{uid}). */
(function () {
  "use strict";
  const PG = (window.Pulsegrid = window.Pulsegrid || {});
  const $ = (s) => document.querySelector(s);
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const PREFIX = "pulsegrid:";
  const SCRIPTS = ["data", "store", "settings", "charts", "panels", "ui", "views", "admin", "bot", "app"].map((n) => `js/${n}.js`);
  const rawSet = Storage.prototype.setItem;
  const rawRemove = Storage.prototype.removeItem;
  const cfg = window.FIREBASE_CONFIG || {};

  let auth, db, ref, started = false, overlay;
  let pending = {}, timer;

  const ERR = {
    "auth/invalid-credential": "Email or password is incorrect.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/email-already-in-use": "An account with this email already exists. Sign in instead.",
    "auth/weak-password": "Use a password with at least 6 characters.",
    "auth/too-many-requests": "Too many attempts. Wait a minute and try again.",
    "auth/network-request-failed": "No connection. Check your network and try again.",
    "auth/operation-not-allowed": "This sign-in method isn't enabled in the Firebase console yet.",
    "auth/unauthorized-domain": "This domain isn't authorised. Add it under Authentication → Settings → Authorized domains.",
  };
  const friendly = (e) => ERR[e && e.code] || `Something went wrong (${(e && (e.code || e.message)) || "unknown"}).`;

  /* ---------- localStorage <-> Firestore ---------- */
  const clearLocal = () =>
    Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => rawRemove.call(localStorage, k));

  function flush() {
    clearTimeout(timer);
    const batch = pending;
    const keys = Object.keys(batch);
    if (!keys.length || !ref) return Promise.resolve();
    pending = {};
    const data = {};
    keys.forEach((k) => (data[k] = batch[k] === null ? firebase.firestore.FieldValue.delete() : batch[k]));
    return ref
      .set({ data, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true })
      .catch(() => {
        keys.forEach((k) => k in pending || (pending[k] = batch[k])); // keep unsaved changes, retry later
        timer = setTimeout(flush, 5000);
        PG.ui && PG.ui.toast("Couldn't save changes. Retrying…");
      });
  }
  function queue(key, value) {
    pending[key.slice(PREFIX.length)] = value;
    clearTimeout(timer);
    timer = setTimeout(flush, 700);
  }
  let patched = false;
  function patchStorage() {
    if (patched) return;
    patched = true;
    Storage.prototype.setItem = function (k, v) {
      rawSet.call(this, k, v);
      if (this === localStorage && String(k).startsWith(PREFIX)) queue(k, String(v));
    };
    Storage.prototype.removeItem = function (k) {
      rawRemove.call(this, k);
      if (this === localStorage && String(k).startsWith(PREFIX)) queue(k, null);
    };
    addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => document.hidden && flush());
  }

  PG.db = {
    // Settings → "Clear all saved data": wipe this user's cloud data too.
    async clearAll() {
      pending = {};
      clearTimeout(timer);
      clearLocal();
      if (ref) await ref.set({ data: firebase.firestore.FieldValue.delete() }, { merge: true });
    },
  };

  async function hydrate(user) {
    ref = db.collection("users").doc(user.uid);
    const snap = await ref.get();
    clearLocal(); // never mix data from a previous account on this browser
    const data = snap.exists ? snap.data().data || {} : {};
    Object.entries(data).forEach(([k, v]) => rawSet.call(localStorage, PREFIX + k, v));
    if (!snap.exists) {
      await ref.set({ email: user.email || "", createdAt: firebase.firestore.FieldValue.serverTimestamp(), data: {} });
    }
    // No saved name yet (new account, or an older one): start with the account's own name.
    if (!data.settings) {
      const name = (user.displayName || (user.email || "").split("@")[0] || "").slice(0, 40);
      if (name) localStorage.setItem(PREFIX + "settings", JSON.stringify({ name })); // patched → saved to cloud
    }
  }

  /* ---------- admin invites ---------- */
  // An existing admin can invite an email address from the Admins page. The first time that
  // person signs in with a verified email, they create their own admin document here.
  // The Firestore rules only allow it if the invite exists and the email is verified.
  async function claimInvite(user) {
    if (!user.email || !user.emailVerified) return false;
    const email = user.email.toLowerCase();
    try {
      await db.collection("admins").doc(user.uid).set({
        email,
        via: "invite",
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      db.collection("adminInvites").doc(email).delete().catch(() => {}); // tidy up; not critical
      return true;
    } catch (_) {
      return false; // no invite for this email (or not allowed)
    }
  }

  /* ---------- UI ---------- */
  function card(html) {
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "auth";
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = `<div class="auth-card">
      <div class="auth-brand"><svg viewBox="0 0 32 32" fill="none"><polygon points="16,2 29,9 29,23 16,30 3,23 3,9" stroke="#45d8cb" stroke-width="1.4"/><circle cx="16" cy="16" r="4.2" fill="#45d8cb"/></svg><span>Pulsegrid</span></div>${html}</div>`;
    return overlay;
  }

  function showLogin() {
    let mode = "signin";
    const o = card(`
      <h1 id="auTitle">Sign in</h1>
      <p class="auth-sub">Your settings, team and reports are saved to your account.</p>
      <form id="auForm" novalidate>
        <label class="field">EMAIL<input id="auEmail" type="email" autocomplete="email" required /></label>
        <label class="field">PASSWORD<input id="auPass" type="password" autocomplete="current-password" minlength="6" required /></label>
        <div class="auth-err" id="auErr" role="alert"></div>
        <button class="btn auth-main" id="auGo" type="submit">Sign in</button>
      </form>
      <button class="btn ghost auth-main" id="auGoogle" type="button">Continue with Google</button>
      <div class="auth-links">
        <button type="button" id="auSwitch">Create an account</button>
        <button type="button" id="auReset">Forgot password?</button>
      </div>`);
    const err = (m) => (o.querySelector("#auErr").textContent = m || "");
    const busy = (b) => o.querySelectorAll("button, input").forEach((e) => (e.disabled = b));

    o.querySelector("#auSwitch").onclick = () => {
      mode = mode === "signin" ? "signup" : "signin";
      o.querySelector("#auTitle").textContent = mode === "signin" ? "Sign in" : "Create account";
      o.querySelector("#auGo").textContent = mode === "signin" ? "Sign in" : "Create account";
      o.querySelector("#auSwitch").textContent = mode === "signin" ? "Create an account" : "I already have an account";
      o.querySelector("#auPass").autocomplete = mode === "signin" ? "current-password" : "new-password";
      err("");
    };
    const run = async (fn) => {
      err("");
      busy(true);
      try {
        await fn();
      } catch (e) {
        if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") err(friendly(e));
        busy(false);
      }
    };
    o.querySelector("#auForm").onsubmit = (e) => {
      e.preventDefault();
      const email = o.querySelector("#auEmail").value.trim();
      const pw = o.querySelector("#auPass").value;
      if (!email || !pw) return err("Enter your email and password.");
      run(() => (mode === "signup" ? auth.createUserWithEmailAndPassword(email, pw) : auth.signInWithEmailAndPassword(email, pw)));
    };
    o.querySelector("#auGoogle").onclick = () => run(() => auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()));
    o.querySelector("#auReset").onclick = () => {
      const email = o.querySelector("#auEmail").value.trim();
      if (!email) return err("Enter your email above, then press Forgot password.");
      run(async () => {
        await auth.sendPasswordResetEmail(email);
        err("");
        o.querySelector("#auErr").textContent = `Reset link sent to ${email}.`;
        busy(false);
      });
    };
    o.querySelector("#auEmail").focus();
  }

  function showProblem(msg, retry) {
    const o = card(`<h1>Can't continue</h1><p class="auth-sub">${esc(msg)}</p>
      <div class="auth-row"><button class="btn" id="auRetry" type="button">Try again</button>
      <button class="btn ghost" id="auOut" type="button">Sign out</button></div>`);
    o.querySelector("#auRetry").onclick = retry;
    o.querySelector("#auOut").onclick = () => auth.signOut().then(() => location.reload());
  }

  function showNoAccess(user) {
    // Email/password accounts must verify their email before an invite can be claimed.
    const needVerify = !!user.email && !user.emailVerified;
    const o = card(`<h1>No admin access</h1>
      <p class="auth-sub">This dashboard is for administrators. If you just want to check service status, use the public status page.</p>
      <a class="btn auth-main" href="status">Open status page</a>
      <p class="auth-sub">Signed in as <b>${esc(user.email || user.uid)}</b>. If an admin has invited this email, you can claim access${needVerify ? " after verifying it" : ""}.</p>
      ${needVerify ? '<button class="btn auth-main" id="auVerify" type="button">Send verification email</button>' : ""}
      <button class="btn ghost auth-main" id="auCheck" type="button">I've been invited. Check again</button>
      <div class="auth-err" id="auMsg" role="status"></div>
      <p class="auth-sub">Are you the owner and the very first admin? Add a document to the <b>admins</b> collection in Firestore with this ID:</p>
      <code class="auth-uid">${esc(user.uid)}</code>
      <button class="btn ghost auth-main" id="auOut" type="button">Sign out</button>`);
    const say = (m) => (o.querySelector("#auMsg").textContent = m || "");
    const verify = o.querySelector("#auVerify");
    if (verify)
      verify.onclick = async () => {
        verify.disabled = true;
        try {
          await user.sendEmailVerification();
          say(`Verification email sent to ${user.email}. Open the link in it, then press "Check again".`);
        } catch (e) {
          say(friendly(e));
        }
        verify.disabled = false;
      };
    o.querySelector("#auCheck").onclick = async () => {
      say("Checking…");
      try {
        await user.reload();
        await user.getIdToken(true); // pick up the new email_verified status
        started = false;
        await start(auth.currentUser || user);
      } catch (e) {
        say(friendly(e));
      }
    };
    o.querySelector("#auOut").onclick = () => auth.signOut().then(() => location.reload());
  }

  const loadScripts = (i = 0) =>
    new Promise((res, rej) => {
      if (i >= SCRIPTS.length) return res();
      const s = document.createElement("script");
      s.src = SCRIPTS[i];
      s.onload = () => loadScripts(i + 1).then(res, rej);
      s.onerror = () => rej(new Error("Failed to load " + SCRIPTS[i]));
      document.body.appendChild(s);
    });

  async function start(user) {
    if (started) return;
    card(`<p class="auth-sub">Loading your workspace…</p>`);
    try {
      // The dashboard is for admins only (a document in the "admins" collection with their user ID).
      let adminDoc = await db.collection("admins").doc(user.uid).get();
      // Not an admin yet? If an admin invited this email, claim it now.
      if (!adminDoc.exists && (await claimInvite(user))) adminDoc = await db.collection("admins").doc(user.uid).get();
      if (!adminDoc.exists) return showNoAccess(user);
      // Older admin documents have no email; add it so they show up properly on the Admins page.
      if (!(adminDoc.data() || {}).email && user.email) {
        db.collection("admins").doc(user.uid).set({ email: user.email.toLowerCase() }, { merge: true }).catch(() => {});
      }
      await hydrate(user);
      patchStorage();
      started = true;
      document.body.classList.remove("locked");
      await loadScripts();
    } catch (e) {
      started = false;
      const denied = e && e.code === "permission-denied";
      return showProblem(
        denied
          ? "Access to your data was denied. Publish the Firestore security rules (firebase deploy --only firestore:rules)."
          : "Couldn't load your data. Check your connection and that Firestore is created in the Firebase console.",
        () => start(user),
      );
    }
    overlay && overlay.remove();
    overlay = null;
    const av = $("#avatar");
    av.classList.add("has-menu");
    av.setAttribute("role", "button");
    av.tabIndex = 0;
    av.setAttribute("aria-haspopup", "menu");
    av.setAttribute("aria-expanded", "false");
    av.setAttribute("aria-label", "Account menu");
    PG.ui.attachMenu(
      av,
      () => [{ id: "who", label: esc(user.email || "Signed in") }, { id: "out", label: "Sign out" }],
      async (id) => {
        if (id !== "out") return;
        await flush();
        await auth.signOut();
        clearLocal();
        location.reload();
      },
    );
  }

  function boot() {
    if (!configured()) {
      return card(`<h1>Firebase isn't set up yet</h1><p class="auth-sub">Open <b>js/firebase-config.js</b> and paste your web app's config from the Firebase console.</p>`);
    }
    firebase.initializeApp(cfg);
    auth = firebase.auth();
    db = firebase.firestore();
    auth.onAuthStateChanged((user) => (user ? start(user) : showLogin()));
  }
  const configured = () => cfg.apiKey && !/^YOUR_/.test(cfg.apiKey) && window.firebase;

  document.body.classList.add("locked");
  boot();
})();