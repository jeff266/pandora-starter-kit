# Pandora Homepage — Integration Guide

## Files Provided

| File | What it does |
|---|---|
| `pandora-homepage.jsx` | Full landing page React component (all sections) |
| `pandora-waitlist-api.ts` | Backend: `/api/waitlist` endpoint + Resend integration |
| `pandora-logo.png` | Your uploaded logo (for static assets) |

## Quick Integration (Replit App)

### 1. Add the homepage component

Copy `pandora-homepage.jsx` to your client-side components:

```
client/src/pages/homepage.tsx  (rename to .tsx if using TypeScript)
```

### 2. Wire the route

In your router (likely using Wouter), add the homepage as the default unauthenticated route:

```tsx
// client/src/App.tsx or wherever your routes live
import PandoraHomepage from './pages/homepage';

// Route: show homepage for unauthenticated users, app for authenticated
<Route path="/">
  {isAuthenticated ? <Dashboard /> : <PandoraHomepage />}
</Route>
```

### 3. Add the waitlist API endpoint

```typescript
// server/routes.ts
import { waitlistHandler, waitlistListHandler } from './waitlist-api';

router.post('/api/waitlist', waitlistHandler);
router.get('/api/admin/waitlist', requireAuth, waitlistListHandler);
```

### 4. Run the migration

```sql
CREATE TABLE IF NOT EXISTS waitlist (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  source TEXT DEFAULT 'homepage',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_waitlist_email ON waitlist(email);
CREATE INDEX idx_waitlist_created ON waitlist(created_at DESC);
```

### 5. Set environment variables

```env
RESEND_API_KEY=re_xxxxxxxxxxxx
RESEND_AUDIENCE_ID=aud_xxxxxxxxxxxx   # Optional: for mailing list
```

Install the Resend SDK:
```bash
npm install resend
```

### 6. Add the logo to static assets

Copy `pandora-logo.png` to your public/static directory. Then in the homepage component, you can replace the inline SVG logo with an `<img>` tag:

```jsx
<img src="/pandora-logo.png" alt="Pandora" style={{ width: 140 }} />
```

The current implementation uses inline SVGs that approximate the logo's eye/circuit design, so it works without the image file too.

## Customization Points

### Nav buttons
- **Join Waitlist** → scrolls to `#waitlist` section
- **Open App →** → links to `/login` (change to your auth route)

### Waitlist flow
1. User enters email in hero or CTA section
2. POST to `/api/waitlist` with `{ email }`
3. Backend stores in `waitlist` table
4. Backend adds to Resend audience (mailing list)
5. Backend sends confirmation email via Resend
6. User sees success message

### Sections included (top to bottom)
1. **Nav** — Logo + Waitlist + Open App
2. **Hero** — Animated logo, headline, tagline, waitlist form
3. **Outcome Stats** — 38s / 16 skills / 4¢ / 10min (animated counters)
4. **Remove the Blindfold** — Before/after insight comparison
5. **Break the Handcuffs** — Before/after efficiency comparison
6. **Connect the Stack** — Sources → Pandora → Outputs flow diagram
7. **RevOps in a Box** — 4 cadence cards (Mon/Fri/Monthly/On-demand)
8. **Built by a Practitioner** — Founder quote + social proof stats
9. **CTA** — Final waitlist form + sign-in link
10. **Footer**

### To swap the logo for the actual image
Replace the inline SVG in the hero with:
```jsx
<img 
  src="/pandora-logo.png" 
  alt="Pandora" 
  style={{ width: 140, animation: "float 6s ease-in-out infinite" }} 
/>
```

## Responsive Notes

The current implementation uses CSS `clamp()` for font sizes and grid layouts. For mobile:
- Stats grid collapses to 2×2
- Before/after cards stack vertically  
- Flow diagram needs a mobile layout (vertical stack)

These responsive breakpoints should be added via `@media` queries or by detecting viewport width in the component.
