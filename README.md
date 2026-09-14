# Participation Grade Book

A client-side Svelte participation grade book. Teachers make their own copy of one Google Sheets template, choose it with Google Picker, and grade directly from the browser. Student data travels only between the browser and Google.

Sign-in and Google Drive authorization go through the auth broker at `https://auth.teacher.dev`. The broker holds the long-lived Google refresh token server-side and hands the browser short-lived access tokens on demand; the browser never runs an OAuth flow itself and never sees a client secret.

## Local setup

Requires Node.js 20.19+ or 22.12+.

```sh
cp .env.example .env.local
npm install
npm run dev
```

The dev server is pinned to port 5173 (`strictPort`) because the broker's origin allowlist holds exactly `http://localhost:5173`. If the port is taken, free it rather than moving the app; a different port has to be added to the broker's `AUTH_BROKER_DEV_APP_ORIGIN`.

Fill in `.env.local`:

- `VITE_AUTH_BROKER_URL`: base URL of the auth broker. Defaults to `https://auth.teacher.dev` when unset.
- `VITE_GOOGLE_TEMPLATE_ID`: ID between `/d/` and `/edit` in the template URL. The repository is currently configured for `1cS83Iyp41lX6Hli14NfibPIjETNTwglhU_0uGRNOIYo`.
- `VITE_CF_BEACON` (optional): Cloudflare Web Analytics token. Set it in Vercel's production environment only; when unset the beacon script is not loaded.

The Google OAuth client ID, Picker API key, and Cloud project number live on the broker. `appId` and `apiKey` arrive with every minted token, so the client never hardcodes which Google Cloud project backs it.

## Local click-through without Google

`scripts/mock-broker.mjs` stands in for `auth.teacher.dev`, with a pretend Google consent page and a control panel for breaking things. Pair it with `VITE_FAKE_GOOGLE=true` and Picker and the Sheets API are faked too, so the whole onboarding ladder and the grading screen work with no Google account.

```sh
# .env.local
VITE_AUTH_BROKER_URL=http://localhost:8787
VITE_FAKE_GOOGLE=true
```

```sh
npm run mock-broker   # http://localhost:8787 — control panel at /
npm run dev           # http://localhost:5173
```

Open `http://localhost:5173/?emptyRoster` to start with no students and click through the add-roster flow.

The consent page offers Continue, Cancel (`?error=access_denied`), a wrong-account choice (`google_account_mismatch`), and a simulated Google failure. The control panel can mark the grant `invalid_grant` or `admin_policy_enforced`, end sessions, or reset. State is in memory; restart to start over.

Neither the mock nor the fake ships: `VITE_FAKE_GOOGLE` is a build-time constant, and `npm run build` with it unset drops `src/lib/fake-google.ts` from the bundle.

## How authorization works

1. **Sign in** — `POST /auth/google/start` returns a Google URL; the page navigates there and comes back with an `HttpOnly` session cookie on `.teacher.dev`.
2. **Connect Google Drive** — `POST /oauth/google/start`, same shape. Google asks for `drive.file` only. The broker stores the refresh token; the connected account must match the signed-in one.
3. **Mint a token** — `POST /oauth/google/token` returns a short-lived access token plus Picker `appId`/`apiKey`. The broker caches tokens with more than five minutes left, and the app additionally caches the result in memory until a minute before expiry, so the 60/hour/user mint limit is never approached in normal use.
4. **Use it** — Google Picker and the Sheets API are called directly from the browser with the bearer token. The broker never sees file content.

Every broker call sends `credentials: "include"` and, on POST/DELETE, an `X-Requested-With` header (the broker's CSRF defence). See `src/lib/broker.ts`.

Failures during the Google redirect come back as `?error=<code>` on the app URL. `access_denied` (the user pressed Cancel) is shown quietly; anything else shows a retry banner. A connection whose refresh token has died shows as `status: "invalid"` and the setup screen offers **Reconnect Google Drive**.

The Picker API key on the broker's project must allow the app origins under its website restrictions (`*.teacher.dev/*` plus `teacher.dev/*`, and `localhost:5173/*` for development). The app origin does **not** need to be an Authorized JavaScript origin on the OAuth client, and the app deliberately does not call `setOrigin()` on the Picker.

## Build the one spreadsheet template

The easiest option is the included CreateTemplate.gs script:

1. Open [script.google.com](https://script.google.com) and create a new project.
2. Replace Code.gs with the contents of CreateTemplate.gs.
3. Run createParticipationTemplate.
4. Approve the requested Google Sheets permission.
5. Open the spreadsheet URL shown in the execution log.
6. Share that file as view-only with the intended audience and allow viewers to copy it.
7. Put its spreadsheet ID into VITE_GOOGLE_TEMPLATE_ID.

The script creates and formats all four tabs, installs the formulas and validation, and leaves the roster ready to fill. TEMPLATE_TIME_ZONE defaults to America/New_York and can be changed at the top of the script before it runs.

### Manual fallback

Create a Google Sheet and set its timezone under **File → Settings**. Make it viewable by anyone who needs to copy it, with copying enabled. It needs four tabs.

### Day Records

Put these exact headers in `A1:H1`:

```text
Name | Date | Timely-ness | Prepared-ness | Attentive-ness | Contribution-ness | Collaboration-ness | Total
```

Format column B as `yyyy-mm-dd`. Put this formula in `H2`:

```gs
=ARRAYFORMULA(IF(A2:A="","",N(C2:C="Yes")+N(D2:D="Yes")+N(E2:E="Yes")+N(F2:F="Yes")+N(G2:G="Yes")))
```

### Class Roster

Put these exact headers in `A1:B1`:

```text
Name | Initials
```

Initials are optional; the app derives them when blank.

### Week Ranges

Put these exact headers in `A1:C1` and format B:C as `yyyy-mm-dd`:

```text
Week | Start Date | End Date
```

### Weekly Grades

Put these headers in `A1:C1`:

```text
Name | Week | Average
```

Put this formula in `A2`:

```gs
=ARRAYFORMULA(SPLIT(FLATTEN(FILTER('Class Roster'!A2:A,'Class Roster'!A2:A<>"")&"♦"&TRANSPOSE(FILTER('Week Ranges'!A2:A,'Week Ranges'!A2:A<>""))),"♦"))
```

Put this formula in `C2`:

```gs
=MAP(FILTER(A2:A,A2:A<>""),FILTER(B2:B,A2:A<>""),LAMBDA(name,week,IFERROR(AVERAGEIFS('Day Records'!H:H,'Day Records'!A:A,name,'Day Records'!B:B,">="&XLOOKUP(week,'Week Ranges'!A:A,'Week Ranges'!B:B),'Day Records'!B:B,"<="&XLOOKUP(week,'Week Ranges'!A:A,'Week Ranges'!C:C)),"")))
```

Do not include an example row in Day Records. On the first load each day, the app creates a default 5/5 row for every rostered student.

## Commands

```sh
npm run dev
npm run check
npm run build
```

## Privacy and concurrency

The Google access token is kept in memory only and is discarded on expiry, sign-out, and tab close. The refresh token never reaches the browser. The browser stores only the selected spreadsheet ID in local storage. Student data travels directly between the browser and Google.

**Sign out** clears the broker session but leaves the Drive grant intact, so coming back is one Google click. **Switch grade book** only forgets the saved spreadsheet.

Setup is a five-step ladder — sign in, connect Drive, copy the template, pick the copy, start grading — and each step unlocks the next. Steps 1–2 come from the broker's connection state; steps 3–4 are remembered per device in local storage (the browser cannot observe the copy being made, so "Make a copy" marks step 3 done when pressed).

Writes are serialized across tabs in the same browser with the Web Locks API. Google Sheets does not offer a cross-device conditional upsert, so this app assumes one teacher is actively grading from one device at a time.
