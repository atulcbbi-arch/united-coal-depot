# United Coal Depot — Firebase edition

This is the full source of **United Coal Depot**. It is set up to run on **your** Firebase project:

- **Google sign-in** via Firebase Auth
- **Parties, books, stock** in Cloud Firestore (your data, on your account)
- **Hosting** at `https://YOUR-PROJECT.web.app`

The Grok preview is separate. This zip is what you own.

Same books rules as the preview:

- Opening balances / stock as of **31 Aug 2026**
- Live entries from **1 Sep 2026**
- Date on every sale, purchase, payment, expense, delivery, stock adj.
- Chase checkbox on the party list (saves immediately)
- Number fields start empty, no spinner arrows

---

## 1. One-time tools on your computer

1. Install **Node.js 22** from [https://nodejs.org](https://nodejs.org) (LTS).
2. Unzip this folder. Open a terminal **inside** `united-coal-depot`.
3. Run:

```bash
npm install
```

---

## 2. Create a Firebase project

1. Open [https://console.firebase.google.com](https://console.firebase.google.com) and sign in with Google.
2. **Add project** → name it e.g. `united-coal-depot` → continue (Google Analytics optional).
3. Click the **web** icon (`</>`) to add a web app. Nickname: `depot`. Do **not** tick Hosting yet. Register.
4. Copy the `firebaseConfig` values (apiKey, authDomain, projectId, …).

### Authentication

1. Build → **Authentication** → Get started.
2. Sign-in method → **Google** → Enable → save.
3. Later, after hosting is live, add your site under Authentication → Settings → **Authorized domains** (Firebase usually adds `YOUR-PROJECT.web.app` itself).

### Firestore

1. Build → **Firestore Database** → Create database.
2. Start in **production mode**.
3. Pick a region close to you (e.g. `asia-south1`).

---

## 3. Put your keys in the app

In the project folder:

```bash
cp .env.example .env
cp .firebaserc.example .firebaserc
```

Edit `.env` and paste the values from Firebase:

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

Edit `.firebaserc` and replace `YOUR_FIREBASE_PROJECT_ID` with the same project id.

---

## 4. Deploy

```bash
npx firebase-tools login
npm run deploy
```

The first command opens Google in the browser so Firebase CLI can use your account. The second builds the app and uploads:

- Hosting (the website)
- Firestore rules (only you can read/write your own books)

When it finishes you get a URL like:

**https://united-coal-depot.web.app**

Open it → Continue with Google.

---

## 5. Try it locally first (optional)

```bash
npm run dev
```

Open the local address it prints, usually `http://localhost:5173`. Google sign-in needs `localhost` in Authentication → Authorized domains (it is there by default).

---

## Data

Each Google account gets its own parties and entries under `users/{yourUid}/...` in Firestore. Nobody else can see them (see `firestore.rules`).

This Firebase copy starts empty. It does **not** automatically import parties from the Grok preview. Add parties again once, then they stay in your Firebase project.

---

## Useful commands

| Command | What it does |
|---|---|
| `npm run dev` | Run on your computer |
| `npm run build` | Build for hosting |
| `npm run deploy` | Build + upload to Firebase |

To update after you change code: `npm run deploy` again.
