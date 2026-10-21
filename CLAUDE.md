# CLAUDE.md: TrueGrowth CRM

A sales CRM for real estate firms: Express 4 + Mongoose 7 (MongoDB Atlas) + server-rendered EJS, deployed on Render.
**Each client firm gets its own copy**: its own Render service and its own Atlas database. There is no tenant id in the data; never add cross-client logic. Never hardcode a company name: use `brand.*` in views (`middleware/brand.js`) and `APP_NAME` / `getSettings()` in code.

## Workflow
- One small PR at a time. The owner tests it, then merges. Render auto-deploys `main` to production.
- Every PR body ends with a short, numbered test checklist the owner can click through.
- Changes to production data, Render settings or env vars wait for the owner's explicit OK.

## Layout
```
server.js              app setup, route mounting, first-boot admin seed, cron
config/env.js          env loading + validation (exits early if required vars missing)
config/constants.js    enum lists shared by schemas, handlers and reports
models/                one Mongoose model per file, all registered via models/index.js
middleware/            auth (JWT cookie + 30s user cache), rate limiters, upload, input sanitizer
services/              access (who can see/do what), reports, digest, pdf, settings, audit, assignment
controllers/app/       GET/POST /app: index.js loads page data, actions.js = form actions, deletes.js
routes/                auth, api (JSON), receipt, import + export (CSV), reportPdf, chat, capture, pwa (app manifest), legal (privacy, terms, /health)
utils/                 pure helpers: format, request (clean/objIdOrNull/escapeRegex), roles, errorPage
views/app.ejs          layout; views/partials/* shared chrome; views/pages/* one file per ?page=
public/app.js, app.css client code (served with ?v=<deploy> cache-buster); phone.js + sw.js = installable app and call logging
```

## Roles and data access (most important rule)
`Super Admin` > `Admin` > `Team Leader` > `Sub Team Leader`.
- Super Admin / Admin: the whole company. Only Super Admin manages users and teams.
- Team Leader: **only their own team's** leads, follow-ups, bookings and members.
- Sub Team Leader: only leads they're caller or closer on, and their own follow-ups and bookings.

Never hand-roll a role check for record access. Use `services/access.js`:
- lists → `visibleLeadFilter` / `visibleFollowUpFilter` / `visibleBookingFilter`
- one lead → `canEditLead`
- a record owned by a user (follow-up assignee, booking closer) → `canActForUser`
- assigning work to someone → `canAssignTo`

The chatbot (`routes/chat.js`) must use the same filters, including for anything put into the AI prompt.
`isManager` (includes Team Leader) is only for "may use this feature at all", never for "may touch this record".

## Security conventions
- **EJS:** use `<%= %>` for everything, including JSON in attributes (`onclick='fn(<%= JSON.stringify(x) %>)'`). `<%-` is only for `include(...)`.
- **Client JS:** never put data into `innerHTML` without `escapeHtml()` (public/app.js).
- **Mongo input:** `middleware/sanitize.js` strips `$`/dotted keys. Still validate ids with `objIdOrNull` or `isValidObjectId` before writes, and put user text into regexes only via `escapeRegex`.
- Secrets live only in env vars (see `.env.example`). Never log them or commit `.env*`.
- Outbound HTTP calls get a timeout (`AbortSignal.timeout`) and a `res.ok` check.

## EJS gotchas (from the refactor)
- `const`s declared in `app.ejs` are NOT visible inside included partials. Pass them explicitly: `include('pages/x', { isManager })`.
- Never split an `if / else if` brace chain across partials.
- After touching views, compile them all:
  `node -e "const ejs=require('ejs'),fs=require('fs');for(const f of process.argv.slice(1))ejs.compile(fs.readFileSync(f,'utf8'),{filename:f});console.log('ok')" views/*.ejs views/pages/*.ejs views/partials/*.ejs`
- A missing `require` isn't a syntax error. It only crashes when that code path runs, so exercise every path you touched.

## Conventions
- Rate limiters are singletons in `middleware/rateLimits.js`; import them, never re-create.
- `userContextCache` (middleware/auth.js) must be cleared when a user's role, team or status changes.
- Write an `audit(...)` entry for every create, update and delete.
- Anything that changes data is a POST form, never a GET link. Deletes post `action=delete, table, id`.
- Form actions throw `Object.assign(new Error(msg), { status })`, and `controllers/app/index.js` turns that into a flash message.
- Keep files under ~600 lines; split by responsibility when they grow (`public/app.js` is already over).
- Dates: `config/env.js` sets `process.env.TZ` to `APP_TIMEZONE` (default Asia/Kolkata), so `new Date()`, `setHours` and `toLocale*` are business time. For datetime-local inputs use `toDateTimeInput()`, never `toISOString()` (that's UTC).
- One-off data changes go in `migrations/` as dated scripts with a dry-run default and `--apply`.

## Commands
- `npm run dev`: local server with reload (needs `.env.development.local`, see `.env.example`)
- `npm start`: production start
