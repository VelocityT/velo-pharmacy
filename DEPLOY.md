# Vercel deployment

## Project settings — these three, exactly

| Setting | Value |
|---|---|
| **Root Directory** | **`apps/cloud`** |
| Framework Preset | Next.js |
| Build / Output / Install commands | **leave all blank** (use defaults) |

That's it. Vercel understands npm workspaces: it installs from the repository
root — so the root `postinstall` runs `prisma generate` — and then builds only
`apps/cloud`.

### Why not Root Directory = `./`

The first deploy failed with:

```
npm error workspace @velocare/core@0.1.0
npm error location /vercel/path0/packages/core
npm error Missing script: "build:cloud"
```

`packages/core` lists `next` as a dependency because it imports `next/server`
for its route handlers. With the root as the project directory, Vercel's
framework detection found that package first and tried to build it as the
Next.js app. Pointing Root Directory at `apps/cloud` removes the ambiguity —
there is exactly one Next app there.

The root `vercel.json` was also forcing `buildCommand: npm run build:cloud`,
which fought the same detection. It has been deleted; Vercel's defaults are
correct once Root Directory is right.

## Environment variables

Six, copied from your local `.env`:

```
NODE_MODE          CLOUD
NODE_KEY           CLOUD
DATABASE_URL       <pooled, port 6543, with ?pgbouncer=true&connection_limit=1>
DIRECT_URL         <session pooler, port 5432>
JWT_SECRET         <same value as local>
JWT_EXPIRES_IN     12h
```

## Verify after deploy

1. `https://<app>.vercel.app/api/health` → `"status": "ok"`, `"seeded": true`
2. Root URL → login → bill a Crocin

The schema and demo data are already in Supabase from local setup. Nothing to
run on first deploy.

## Notes

- **Supabase free tier pauses after 7 days idle** and needs a manual restore
  from the dashboard. Open the app the morning of any client demo.
- **Cold starts are 2–3 seconds** on Vercel's free tier. Fine for testing; a
  pharmacist would notice. For a demo that must feel fast, run the on-prem
  Dockerfile on Railway with `NODE_MODE=CLOUD` — always-on, ~$5/mo.
