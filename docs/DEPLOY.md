# Putting the website online (for a demo on a real phone)

Right now the website runs on the laptop (`npm run dev`, http://localhost:3000). The backend is
already online (Convex, `benevolent-spoonbill-986`), and it keeps checking Mom's mail whether or
not the laptop is open. Only the website needs a public address, and only if you want a real
phone to open Mom's page or her invite link. **You don't need this for a laptop-only demo.**

## Option A: Vercel (about 10 minutes, needs your Vercel login)

1. `npx vercel` in the repo, log in, accept the defaults (framework: Next.js).
2. In the Vercel project's settings, add the two environment variables from `.env.local`:
   `NEXT_PUBLIC_CONVEX_URL` and `NEXT_PUBLIC_CONVEX_SITE_URL`. Then `npx vercel --prod`.
3. Point the backend at the new address (this is the important step):
   ```bash
   npx convex env set SITE_URL https://<your-app>.vercel.app
   ```
4. Open `https://<your-app>.vercel.app`, sign in as the kid, and use it from any phone.

## Option B: a temporary tunnel (no account)

1. `brew install cloudflared`, then `cloudflared tunnel --url http://localhost:3000`.
2. It prints an address like `https://something.trycloudflare.com`. Set it as above:
   `npx convex env set SITE_URL https://something.trycloudflare.com`.
3. The address changes every time the tunnel restarts; set SITE_URL again if it does.

## What SITE_URL changes (read before switching)

- **Connecting Gmail:** the invite only works from the address in SITE_URL (the backend checks
  where the request came from). With SITE_URL on the public address, connecting from localhost
  stops working, and the other way around.
- **Links in Mom's notes** ("See what Lucas sees") point at SITE_URL.
- **Signing in** works from either address.
- To go back to the laptop: `npx convex env set SITE_URL http://localhost:3000`.

## Not needed

- Google's OAuth redirect stays the same: it points at the Convex backend
  (`https://benevolent-spoonbill-986.convex.site/gmail/callback`), not at the website.
- Nothing about the backend moves; the database and the minute-by-minute checks are unchanged.
