# Pulsegrid — IT Operations Command Center

Pulsegrid is a single-page, dark-theme dashboard that gives an IT / DevOps team a
live picture of their environment at a glance: is everything up, what is on fire,
how busy is the support desk, and which regions are under load.

It is a static site (HTML + CSS + vanilla JavaScript, no framework, no build step)
and is set up to be hosted on **Firebase Hosting**. All data shown is simulated
mock data, so it works out of the box without any backend.

## What you see on the page

| Area                         | What it shows                                                                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status banner**            | Overall health, worked out from the production regions: _All systems operational_, _Degraded performance_, or _Critical load_. Also shows local time and when data last synced. |
| **KPI cards**                | System uptime, active incidents, servers monitored, average response time, tickets resolved, bandwidth utilization.                                                             |
| **Uptime chart**             | Daily uptime for the selected period, with a hover tooltip.                                                                                                                     |
| **Incidents by severity**    | Donut chart: Critical, High, Medium, Low.                                                                                                                                       |
| **Tickets by category**      | Bar chart: Network, Hardware, Software, Security, Access.                                                                                                                       |
| **Infrastructure by region** | Load, latency and status for each region.                                                                                                                                       |
| **Live activity feed**       | Deployments, resolved tickets, alerts, backups and certificate renewals as they happen.                                                                                         |

## How to use it

**Change what you're looking at**

- **Time range** (top right, "Last 30 days"): choose 7, 30 or 90 days. The uptime chart, incident donut, ticket bars and "tickets resolved" KPI all update.
- **Environment** ("All environments"): switch between All, Production and Staging to filter the region table.
- Your range and environment choices are remembered the next time you open the page.

**Find things**

- Click the search box, or press **Ctrl + K** (**⌘ K** on Mac) or **/**. Typing filters both the region table and the activity feed. Press **Esc** to clear.
- Click a sidebar item (**Infrastructure**, **Incidents**, **Tickets**) to jump to that panel. **Overview** scrolls back to the top. **Reports**, **Team** and **Settings** open their own pages (see "Analyze pages" below).

**Work with the data**

- **Hover** the uptime line to see the exact value for a day, or hover a donut segment to see its count.
- **Sort the region table** by clicking the column headers (Region, Load, Latency, Status). Click again to reverse.
- **Export CSV** (the cyan button on the regions panel) downloads the regions currently shown, respecting your filters and sort order.
- **Pause the feed** by clicking "streaming" at the top of the activity feed. Click again to resume.
- **Refresh now** by clicking the "Last synced" time in the banner.

**Alerts**

- When a region crosses into _Critical_ load (92% by default; change it in Settings), or recovers from it, Pulsegrid shows a toast, adds a line to the activity feed, adds an entry to the **bell** menu and increases its badge count.
- Open the bell to read notifications, and choose **Mark all as read** to clear the badge.
- The browser tab title shows the current status (🟢 / 🟠 / 🔴), so you can spot problems from another tab.

**Keyboard**: all menus, buttons and nav items work with Tab, Enter/Space and the arrow keys (menus), and the page respects the "reduce motion" system setting.

## Analyze pages

Use the sidebar to open them (the address bar shows `#reports`, `#team` or `#settings`, so you can bookmark a page).

**Reports** — build a report and review it on screen before you export it.

1. Pick a report: Uptime summary, Incident summary, Ticket summary or Infrastructure health (live), and a period (7, 30 or 90 days).
2. Press **Generate** to see summary figures and a table.
3. Press **Download CSV**, or **Print / Save as PDF** for a clean white printout.
4. _Recent reports_ keeps your last six; press Download there to export one again.
5. _Scheduled reports_ switches are saved in the browser. Actually emailing them needs a backend, such as a Cloud Function.

**Team** — a roster of the people running operations.

- The cards show members, who is online, open tickets and who is on call.
- Click a status badge to cycle Online, Away and Offline. Press **Set on-call** to hand over the pager (only one person is on call at a time).
- Add a member with the form at the bottom, remove with ✕. The search box filters members by name or role. Changes are saved in the browser.

**Settings** — saved in the browser and applied instantly.

- **Display name** updates your avatar initials.
- **Alert thresholds** set the load % where a region counts as Degraded or Critical. Status colours, the banner, alerts and reports all follow them.
- **Live updates** can be switched off, or set to every 3, 6, 12 or 30 seconds. Pop-up alerts and feed alerts can be switched off separately.
- **Reset settings**, or **Clear all saved data** (settings, team, reports, schedules).

## Project structure

```
pulsegrid/
├── firebase.json        Firebase Hosting config (serves /public, cache + security headers)
├── .firebaserc          put your Firebase project ID here
└── public/
    ├── index.html       markup only
    ├── css/styles.css   all styling
    └── js/
        ├── data.js      mock data + shared helpers (edit this to change the numbers)
        ├── settings.js  saved settings (thresholds, refresh rate, profile)
        ├── charts.js    line, donut and bar charts
        ├── panels.js    KPIs, regions table, status banner, activity feed, CSV export
        ├── ui.js        dropdown menus, toast, page navigation, search shortcuts
        ├── views.js     Reports, Team and Settings pages
        └── app.js       state, wiring, simulated live updates, alerts
```

## Deploy to Firebase

1. Create a project at https://console.firebase.google.com.
2. In `.firebaserc`, replace `your-firebase-project-id` with your project ID.
3. Run:

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only hosting
```

The site goes live at `https://<project-id>.web.app`.

To preview locally first: `firebase emulators:start --only hosting`
(or open `public/index.html` directly in a browser).

## Using real data later

Everything is fed from `js/data.js` and the `liveTick()` function in `js/app.js`.
To connect a real source (for example Firestore), replace the mock arrays in
`data.js` and update the region list and KPIs from your listener instead of the
random drift in `liveTick()`.
