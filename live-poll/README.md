# Live Poll

Ask a question, add a few options, and share a link. People tap to vote and watch
the results fill in live — animated bars, vote counts, percentages. No accounts,
no setup, no clutter. One screen to create, one link to share.

It's a tiny, self-contained app: a single Node file with **zero dependencies**,
serving its own pages. Perfect for a quick team decision, an audience poll, or a
"where should we eat?" group text.

## Try it

1. **Home** — type your question, add at least two options, hit **Create poll**.
2. **Share** — you land on the poll page with a copy-able link. Send it to anyone.
3. **Vote** — each person taps an option and instantly sees the live results.
   Results keep updating on their own, so it feels alive as votes come in.

## Run it locally

You need [Node.js](https://nodejs.org) 18 or newer. Then:

```sh
npm install      # there are no dependencies, but this is the standard step
npm start
```

Open <http://localhost:3000>, create a poll, and you'll be redirected to its page.
Share that page's URL (it looks like `http://localhost:3000/p/ab2c3de`) with anyone
on your network to collect votes.

## Where votes are stored

Votes are saved to a small JSON file so they survive restarts:

- **On ifhost:** to the persistent volume at `/data/polls.json`. Your poll and its
  votes stay put across restarts and redeploys (the app requests this volume with
  `storage = "local"` in `impossible.toml`).
- **Locally / no volume:** the app falls back to `./data/polls.json`, and if it
  can't write there either, it keeps everything in memory for the session. It never
  crashes over storage — it detects what's available and degrades gracefully.

There are no accounts or logins. A poll is just a short random id in the URL
(`/p/<id>`), and a light best-effort guard (a flag in your browser) stops the most
trivial accidental double-voting.

## Deploy your own

Paste this to your AI coding assistant:

```
install github.com/ImpossibleFinance/impossible-hosting-skill
and deploy this project to ifhost
```

Your poll tool will be live at `https://<your-app-name>.host.impossi.build`.
