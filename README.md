# ifhost demos

Three small, self-contained apps you can deploy on [ifhost](https://host.impossi.build) — each one is a ready-to-ship project. Open any folder, hand it to your AI coding assistant, and it goes live.

| Demo | What it is | Folder |
|------|------------|--------|
| **QR code generator** | Type a link, get a downloadable QR code. Doubles as an API other apps can call. | [`qr-generator/`](./qr-generator) |
| **Live poll** | Ask a question, share the link, watch votes update live. Votes are saved on a persistent volume. | [`live-poll/`](./live-poll) |
| **Meme generator** | Add captions to any image and download it. 100% in the browser — nothing is uploaded. | [`meme-generator/`](./meme-generator) |

## Deploy one

Open the folder you want in Claude Code, Codex, Cursor, or any AI coding assistant, then paste:

```
install github.com/ImpossibleFinance/impossible-hosting-skill
and deploy this project to ifhost
```

The assistant installs what it needs, picks specs, and ships it. Each folder also has its own `README.md` with details and how to run it locally.
