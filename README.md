# PCCguessr

A GeoGuessr-style game for Pensacola Christian College students. Each game shows you five Google Street View panoramas from around campus. Click the campus map to guess where each one was taken. Points are based on how close your guess is, up to 5,000 per round and 25,000 per game.

> **Unofficial student project.** PCCguessr is not affiliated with or endorsed by Pensacola Christian College. It uses no college logos or seals. It is not yet approved by the college.

## Features

- Sign in with a school email address and a one-time 6-digit code (no passwords)
- Five rounds per game, with a 120-second timer per round
- Distance-based scoring, with server-side timing and scoring
- All-time and weekly leaderboards (weeks start Monday 00:00 Central)
- Profile page to choose a display name and see your stats
- Results page with every guess and answer on one map
- Admin tools for locations, player names, and flagged games

## Tech stack

- **Frontend:** plain HTML, CSS, and native ES modules. Hosted on GitHub Pages. No build step, no npm.
- **Libraries:** Supabase JS client and Google Maps JavaScript API, loaded from CDNs with pinned versions.
- **Backend:** Supabase (Auth, Postgres, Row Level Security, and SQL functions). All scoring and timing happens on the server.
- **Email:** custom SMTP through Resend.

## Campus policy note

This is a school-branded service that collects student email addresses. Before inviting students or announcing it, the maintainer should get written approval from the college's IT department and Student Life. That approval should cover the allowed email domains, whether campus Street View imagery may be used in a game, data retention, and whether an official tie-in is wanted. Until then, the project stays unlisted, is labeled as unofficial, and is tested only with consenting friends.

Privacy details are in [privacy.html](./privacy.html).

## Setup

See [docs/SETUP.md](./docs/SETUP.md) for step-by-step instructions covering Supabase, Google Cloud, configuration, local testing, and GitHub Pages deployment.

## Project structure

```
index.html          sign-in (email code)
play.html           game screen
results.html        end-of-game summary
leaderboard.html    all-time and weekly boards
profile.html        display name and stats
admin.html          admin tools
privacy.html        privacy notice
css/                stylesheet
js/                 browser modules (config, Supabase client, auth, maps, page logic)
supabase/
  migrations/       0001-0005 schema, RLS, game and admin functions, auth hook
  seed.sql          allowed domains and name denylist
  seed_denylist.sql extra name denylist terms
docs/SETUP.md       setup guide
SPEC.md             technical specification
```

`js/config.js` holds only public values (the Supabase URL, the anon key, and the restricted Maps key). Never commit the `service_role` key, the database password, or the SMTP key.
