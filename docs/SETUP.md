# PCCguessr setup

Follow these steps in order. Dashboard labels can change over time, so if a label differs, look for the nearest match.

Never commit or paste into the repo: the `service_role` key, the database password, the Resend API key, or the JWT secret. Only the anon key and the restricted Maps key go into `js/config.js`.

## 1. Create the Supabase project

1. Go to https://supabase.com, sign in, and click **New project**.
2. Choose a name, a region close to Florida, and a strong database password. Store the password in a password manager.
3. Wait for the project to finish provisioning.

## 2. Run the database SQL in order

1. In the Supabase dashboard, open **SQL Editor** and click **New query**.
2. Open `supabase/migrations/0001_schema.sql` from the repo, copy all of it, paste it into the editor, and click **Run**.
3. Repeat for `0002_rls.sql`, `0003_game_functions.sql`, `0004_admin_functions.sql`, and `0005_auth_hooks.sql`. Run them in that order.
4. Run `supabase/seed.sql`.
5. Run `supabase/seed_denylist.sql`.

Each file can be re-run safely except the migrations. If a migration fails, fix the error and start again from a fresh project.

## 3. Confirm the private schema is not exposed

1. Open **Project Settings → Data API** (sometimes labeled **API Settings**).
2. Under **Exposed schemas**, make sure only `public` is listed. Do not add `private`.

## 4. Configure email sign-in (OTP)

1. Open **Authentication → Sign In / Providers** (labeled **Providers** in some versions).
2. Turn on **Email**. Turn off every other provider, including Google, GitHub, and phone.
3. Turn off **Allow anonymous sign-ins**.
4. Set **Email OTP length** to `6`.
5. Set **Email OTP expiration** to `600` seconds.
6. Keep **Confirm email** on.
7. Save.

## 5. Set the email templates to send a code, not a link

1. Open **Authentication → Email Templates**.
2. Edit **Magic Link** and **Confirm signup**.
3. In each template body, include `{{ .Token }}` where the code should appear. Do not include `{{ .ConfirmationURL }}` anywhere. School email filters rewrite links, so codes are used instead.

Example body:

```html
<h2>Your PCCguessr code</h2>
<p>Enter this 6-digit code to sign in:</p>
<p style="font-size: 24px; font-weight: bold;">{{ .Token }}</p>
<p>The code expires in 10 minutes. If you did not request it, ignore this email.</p>
```

4. Save each template.

## 6. Set up custom SMTP with Resend

Supabase's built-in email is rate-limited to a few messages per hour, so custom SMTP is required.

1. Create an account at https://resend.com.
2. In Resend, open **Domains**, click **Add domain**, and enter a domain you control (for example, `mail.example.com`).
3. Add the DNS records Resend shows (SPF and DKIM, and any others listed) at your DNS provider. Wait until Resend shows the domain as **Verified**.
4. In Resend, open **API Keys** and create a key with sending permission. Copy it once and store it in a password manager.
5. In Supabase, open **Project Settings → Authentication** (labeled **Authentication → SMTP Settings** in some versions) and turn on **Enable custom SMTP**. Enter:
   - Sender email: an address on your verified domain (for example, `no-reply@mail.example.com`)
   - Sender name: `PCCguessr`
   - Host: `smtp.resend.com`
   - Port: `465`
   - Username: `resend`
   - Password: the Resend API key from step 4
6. Save. Then open **Authentication → Rate Limits** and leave the defaults, or lower the email limit if needed.

## 7. Set the Site URL

1. Open **Authentication → URL Configuration**.
2. Set **Site URL** to `https://<your-github-username>.github.io/pccguessr/`.
3. Under **Redirect URLs**, add `http://localhost:8000/**` for local testing.
4. Save.

## 8. Enable the Before User Created hook

This hook rejects any signup whose email is not on the allowed-domain list.

1. Open **Authentication → Hooks**.
2. Click **Add hook** under **Before User Created**.
3. Choose **Postgres** as the hook type.
4. Select the schema `public` and the function `hook_before_user_created`.
5. Enable the hook and save.

## 9. Set up Google Maps

1. Go to https://console.cloud.google.com and create a project, or select an existing one.
2. Open **APIs & Services → Library**, search for **Maps JavaScript API**, and click **Enable**.
3. Open **APIs & Services → Credentials**, click **Create credentials → API key**, and copy the key.
4. Click the key to edit it:
   - **Application restrictions:** choose **Websites (HTTP referrers)** and add these two entries:
     - `https://<your-github-username>.github.io/pccguessr/*`
     - `http://localhost:*/*`
   - **API restrictions:** choose **Restrict key**, then select only **Maps JavaScript API**. Street View is included in that API.
   - Save.
5. Open **APIs & Services → Maps JavaScript API → Quotas** and set a daily limit on map loads. Street View panoramas are billed per load, and each game loads about five or more.
6. Open **Billing → Budgets & alerts**, create a budget (for example, $10 per month), and add alert thresholds at 50%, 90%, and 100%.

7. Create a Map ID (needed for the map markers): open **Google Maps Platform → Map Management → Create Map ID**. Name it `pccguessr`, set **Map type** to **JavaScript** and **Map type: Vector**, and save. Copy the Map ID. (Until you set one, the app falls back to Google's `DEMO_MAP_ID` and logs a console warning.)

## 10. Fill in `js/config.js`

1. Open `js/config.js` in the repo.
2. Set `SUPABASE_URL` to **Project Settings → Data API → Project URL**.
3. Set `SUPABASE_ANON_KEY` to the **anon public** key from **Project Settings → API Keys**. Do not use the `service_role` key.
4. Set `GOOGLE_MAPS_KEY` to the restricted key from step 9, and `GOOGLE_MAP_ID` to the Map ID from step 9.7.
5. Set `ALLOWED_DOMAINS` to the same domains in the database. Run this in the SQL editor, then match the list in `config.js`:

```sql
update private.settings
set allowed_domains = '{pcci.edu,students.pcci.edu}'
where id = 1;
```

Replace the domains with the ones the college confirms. Both places must match.

Email rules enforced by the server: addresses are lowercased, must be plain ASCII (`a-z 0-9 . _ % -` before the `@`), must match an allowed domain exactly, and **plus-addressing is rejected** (`name+tag@pcci.edu` cannot sign up) so one student cannot create many accounts.

6. Check `CAMPUS_CENTER` and `CAMPUS_BOUNDS`. The bounds are placeholders to confirm before launch.

## 11. Sign up and grant yourself admin

1. Start the local server (step 14), open `http://localhost:8000/`, and sign in with your school email. Enter the code from the email.
2. Set a display name on the profile page. The profile row is created automatically when you sign up.
3. In the SQL editor, make yourself an admin. Replace the email with the one you signed up with:

```sql
update public.profiles
set is_admin = true
where id = (select id from auth.users where email = 'you@students.pcci.edu');
```

4. Refresh the page. The **Admin** link should appear in the navigation.

## 12. Add at least five locations

1. Open `admin.html` (the **Admin** link).
2. Under **Locations**, click a spot on the campus map. The app searches for Street View at that point.
3. If you see **No Street View here**, click a different spot.
4. When a panorama appears, drag it to set the view you want. Enter a name, such as `Library steps`, and click **Save**. The app stores the panorama's own position, not the spot you clicked.
5. Repeat until at least five active locations exist. The game needs at least five to start.

## 13. Deploy to GitHub Pages

1. On GitHub, create a new public repository named `pccguessr`. Leave it empty.
2. In the repo folder on your computer, run:

```bash
git init
git add .
git commit -m "Initial PCCguessr"
git branch -M main
git remote add origin https://github.com/<your-github-username>/pccguessr.git
git push -u origin main
```

3. Before pushing, confirm the repo folder contains an empty `.nojekyll` file at the root. Create it with `touch .nojekyll` if it is missing.
4. On GitHub, open **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, select `main`, and choose the `/ (root)` folder. Save.
5. Wait a minute or two, then open `https://<your-github-username>.github.io/pccguessr/`.

Before pushing, check that `js/config.js` contains only the public values.

## 14. Local testing

From the repo root, run:

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000/` in a browser. Pages use relative links, so they work from the root locally and from `/pccguessr/` on GitHub Pages.

## 15. Campus approval

Before inviting students or announcing the site, get written approval from the college, as described in the README. Until then, keep the site unlisted, label it as an unofficial student project, and test only with consenting friends.

## Final checklist

- [ ] Replace `CONTACT_EMAIL` in `privacy.html` (two places) with a real contact address before sharing the site.
- [ ] `js/config.js` has your Supabase URL, anon key, Maps key, and Map ID; no secret keys anywhere in the repo.
- [ ] Allowed domains match in `js/config.js` and `private.settings`.
- [ ] Before User Created hook is enabled; a non-PCC address is rejected.
- [ ] At least five active locations exist; `seed_denylist.sql` has been run.
- [ ] Written campus approval obtained (step above) or the site stays unlisted.

## Troubleshooting

### The sign-in code email does not arrive

- Check spam and junk folders. Some school filters delay unfamiliar senders.
- Confirm the sender domain shows as **Verified** in Resend, and check the Resend **Emails** log for a delivery status.
- Open the **Confirm signup** and **Magic Link** templates and confirm they contain `{{ .Token }}` and no `{{ .ConfirmationURL }}`.
- If the sign-in page says only PCC email addresses can sign up, the address domain is not in the allowed list. Check the domains in `js/config.js` and in `private.settings`.
- Supabase limits how often a code can be requested for the same address. Wait a few minutes before resending.
- The **Resend** button stays disabled for 60 seconds by design.

### `RefererNotAllowedMapError` on the guess map

- The key's HTTP referrer list must match the URL you are using. For GitHub Pages, the entry is `https://<your-github-username>.github.io/pccguessr/*`. A missing `/pccguessr/` or a typo in the username causes this error.
- For local testing, `http://localhost:*/*` must be listed.
- Changes can take a few minutes to apply. Wait, then reload with the cache cleared.

### No Street View coverage at a spot

- Not every campus spot has Street View. In `admin.html`, click a nearby point with a road or path.
- If a saved location stops resolving, use **Check all** in `admin.html` and deactivate any location that no longer shows a panorama.
- If fewer than five active locations exist, the game cannot start and shows a "not enough locations" message.

### Rate limit or quota errors

- A `PCCG_GAME_IN_PROGRESS` response means the player already has an active game; the app resumes it. The **Forfeit** button abandons it (it still counts toward the daily limit).
- A `PCCG_DAILY_LIMIT` message means the player has used the daily game cap, which is 20 games per Central-time day by default. This is not an email limit.
- Email rate-limit errors from Supabase mean you should wait before requesting another code. Resend's plan limits also apply.
- If Maps stops loading, check the daily quota in Google Cloud and the budget alerts.
