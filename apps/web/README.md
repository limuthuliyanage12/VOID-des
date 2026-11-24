# VOID · Events by the Void

A live-events ticketing site for Sri Lanka, built by team IIT ATP-CS24. Fans find every live night in one place, look around the venue in 3D before they buy, book general admission or a VIP table, and split the bill with friends.

The site runs on the VOID API (`apps/api`). Data comes from the API through `api.js`; in demo mode payments are simulated with signed sandbox callbacks.

## Run it

It is plain HTML, CSS and JavaScript with no build step, served by the API. From the repo root:

```
corepack pnpm install
corepack pnpm dev:mem
```

Then open http://localhost:4000. To host the site on another origin, add `<meta name="void-api" content="https://api.example.lk">` to each page and list that origin in the API's `CORS_ORIGINS`.

## Pages

| Page | File | Scripts |
| --- | --- | --- |
| Landing | `index.html` | `void-shared.js`, `void-events-list.js`, `void-script.js` |
| All events | `events.html` | `void-shared.js`, `void-events-list.js` |
| Event, tiers, VIP, checkout, split pay | `event.html` | `shared.js`, `event.js` |
| 3D venue (Fly and Walk) | `venue.html` | `shared.js`, `venue3d.js`, `places.js` |
| VIP table map in 3D | `tables.html` | `shared.js`, `venue3d.js`, `places.js` |
| Venues | `venues.html` | `shared.js`, `venue3d.js`, `places.js` |
| Sign in, confirmation, My Tickets | `auth.html`, `confirmation.html`, `tickets.html` | `shared.js`, `account.js` |
| Organizer console (11 screens) | `admin.html` | `shared.js`, `console-data.js`, `console.js`, `admin.js` |
| Platform console (10 screens) | `super.html` | `shared.js`, `console-data.js`, `console.js`, `super.js` |

## Styles

- `void-landing.css`, `void-screens.css`: the landing and all-events pages.
- `styles.css`: VOID design tokens and shared components. `site.css`: fan pages. `console.css`: the two consoles.

## Libraries

- three.js r128, loaded from cdnjs, for the 3D venue, the table map and the builder preview.
- Google Fonts: Syne, Instrument Serif, Bodoni Moda, Inter.

## Demo tips

- The Client, Admin and Super switcher at the foot of each console sidebar moves between the three workspaces.
- Presale code: `VOIDFRIENDS`.
- Platform console → Settings → Reset demo data clears everything saved in the browser.

## Photo credits

Open-licence photographs from Wikimedia Commons. The full list is under Photo credits in the site footer.
