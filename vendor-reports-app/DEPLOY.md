# Getting the reporting centre into the monday account

## Before you start

You need three things on your computer:

| | Check it with | If missing |
| --- | --- | --- |
| **Node.js 20+** | `node --version` | nodejs.org → the green **LTS** button |
| **Git** | `git --version` | git-scm.com, or install GitHub Desktop |
| **The project folder** | see below | clone it — step 0 |

### Step 0 — get the code onto your computer

The app lives on a branch of your `fight-night-pickem` repo. Easiest way is
**GitHub Desktop** (desktop.github.com):

1. **File → Clone repository** → pick `xander-formulax/fight-night-pickem`.
2. Note the folder it saves to — usually `C:\Users\<you>\Documents\GitHub\fight-night-pickem`.
3. Use the **Current Branch** dropdown at the top to switch to
   `claude/vendor-reports-app-design-xs0s9w`.

The app is the `vendor-reports-app` folder inside it. **Every `mapps` command
below must be run from inside that folder**, not from `C:\WINDOWS\system32`.

To get there in PowerShell, type `cd ` (with a space) and then drag the
`vendor-reports-app` folder onto the PowerShell window — it fills in the path.
Press Enter. Check you're in the right place:

```powershell
dir
```

You should see `package.json`, `src`, and `public` listed.

---

## Windows notes

**Deprecation warnings are normal.** `npm warn deprecated ...` in yellow is not
an error. Only lines starting with `npm ERR!` are.

**If `mapps` says scripts are disabled**, PowerShell is blocking the tool. Run
this once, answer `Y`, then try again:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

**If `mapps` says "not recognized"** after a successful install, close
PowerShell completely and open a new window — the PATH only refreshes on a new
session.

---

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

```powershell
npm install -g @mondaycom/apps-cli
```

Wait for the prompt to come back. Yellow `deprecated` warnings along the way
are fine. Then check it worked:

```powershell
mapps help
```

If that prints a list of commands, you're good. If it errors, see **Windows
notes** above.

## 2. Log the tool into your account

```powershell
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

```powershell
mapps code:push -i <APP_VERSION_ID>
```

monday zips the project, builds it, and prints a URL when it's done. First
build takes a few minutes. **Copy that URL.**

## 6. Give the app its two secrets

Either in the Developer Center under **Host on monday → Server-side code →
Secrets**, or from the terminal:

```powershell
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

```powershell
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
| `mapps` not recognized | Close PowerShell and open a new window. |
| "running scripts is disabled" | Run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, answer Y. |
| `ENOENT package.json` on push | You're in the wrong folder. `cd` into `vendor-reports-app` first. |

## Before you deploy — check it locally

```powershell
npm install
npm test        # 16 tests, the report rules
npm run demo    # http://localhost:8080, real board snapshot, no token needed
```

`npm run demo` serves the real frontend against a recorded snapshot of the
boards. It's the fastest way to see a change without deploying.


## Corrections learned from the first real deploy (2026-08-20)

1. **The session-token secret is the CLIENT SECRET.** Set
   `mapps code:secret -m set -k MONDAY_SIGNING_SECRET -v <Client Secret>` using the
   **Client Secret** from General settings — not the field literally named
   "Signing Secret". monday signs `monday.get('sessionToken')` JWTs with the
   client secret.
2. **The Object feature has TWO places to configure.** Feature Details →
   Deployment (pick *Server-side code (monday code)*) AND the **View Setup**
   tab, where Source = Custom URL must contain the full deployment URL. An
   empty View Setup renders as a blank page in the workspace.
3. **A workspace object added before the view was configured stays blank.**
   Delete the object from the left pane and re-add it after View Setup is saved.
4. **Secret changes may need a restart** — re-run `mapps code:push` if a new
   secret doesn't take effect.
