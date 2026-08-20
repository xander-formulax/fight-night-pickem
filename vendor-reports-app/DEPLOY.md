# Getting the reporting centre into the monday account

Follow these in order. Steps 1–7 are one-time setup; after that, shipping a
change is just step 8 again.

You need two different secrets and it is easy to mix them up:

| | What it is | Where it comes from |
| --- | --- | --- |
| **API token** | Logs the app into monday to read your boards. Also how the CLI knows which account to deploy to. | Avatar → Developers → My Access Tokens |
| **Signing secret** | Proves that requests hitting the app really came from monday. | Developer Center → your app → Basic Information |

Never paste either into a chat, an email, or a commit.

---

## 1. Install the deploy tool

```bash
npm install -g @mondaycom/apps-cli
mapps help
```

If `mapps help` prints a list of commands, it worked.

## 2. Log the tool into your account

```bash
mapps init -t <YOUR_API_TOKEN>
```

## 3. Create the app

1. Avatar (bottom left in monday) → **Developers**. The Developer Center opens in a new tab.
2. **Create app**. Name it **Vendor Reports**.
3. Copy the **Signing Secret** from Basic Information — you need it in step 6.

## 4. Add the full-page feature

1. In your app, open the **Features** tab.
2. **Create new feature** → type **Object** in the search → select **Object** → **Create**.

This is the standalone, full-page view that lives in the workspace's left-hand
menu. Not a board tab, not a widget.

You are now on the Feature Details page. **The URL of this page contains the
App Version ID** — a number. Copy it; step 5 needs it.

## 5. Accept hosting terms, then deploy

In the Developer Center, open **Hosting** once and accept the terms — deploys
fail with "access denied" until you do.

Then, from inside the `vendor-reports-app` folder:

```bash
mapps code:push -i <APP_VERSION_ID>
```

monday zips the project, builds it, and prints a URL when it's done. First
build takes a few minutes. **Copy that URL.**

## 6. Give the app its two secrets

Either in the Developer Center under **Host on monday → Server-side code →
Secrets**, or from the terminal:

```bash
mapps code:secret -m set -k MONDAY_API_TOKEN     -v <YOUR_API_TOKEN>
mapps code:secret -m set -k MONDAY_SIGNING_SECRET -v <SIGNING_SECRET>
```

Without `MONDAY_API_TOKEN` the app cannot read your boards and every screen
shows an error. Without `MONDAY_SIGNING_SECRET` every request is rejected as
unauthorised.

Secrets cannot be read back after they are set. Store them in a password
manager now.

## 7. Point the feature at the deployed code

Back on the Feature Details page, find the **Feature Deployment** widget in the
top right:

1. Choose **CLI (client/server)**.
2. Set the subroute to `/`.
3. **Save**.

Then open the app from the left-hand menu of the Dragon Transport workspace.
You should see the vendor list load.

## 8. Shipping a change later

```bash
mapps code:push -i <APP_VERSION_ID>
```

That's the whole loop. Secrets and the feature configuration stay as they are.

---

## If something goes wrong

| What you see | What it means |
| --- | --- |
| `access denied` on push | Accept the Hosting terms in the Developer Center (step 5). |
| App list is empty in the CLI | `mapps init` ran against a different account. Re-run it with the right token. |
| "This app has to be opened from inside monday.com" | You opened the monday-code URL directly in a browser tab. Open it from the workspace menu instead — that's where it gets its session token. |
| "MONDAY_API_TOKEN is not configured" | Step 6 was skipped, or the secret was set on a different app version. |
| Every vendor list is empty | No jobs have a **Bill to** vendor set. See the data notes in README.md. |
| Build fails immediately | Check that `npm start` runs locally first. monday builds with the same `package.json`. |

## Before you deploy — check it locally

```bash
npm install
npm test        # 16 tests, the report rules
npm run demo    # http://localhost:8080, real board snapshot, no token needed
```

`npm run demo` serves the real frontend against a recorded snapshot of the
boards. It's the fastest way to see a change without deploying.
