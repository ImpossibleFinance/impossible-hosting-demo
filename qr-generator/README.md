# QR Studio

Type a link or a message, get a beautiful QR code instantly — style it and download it as a crisp PNG. It's also a tiny image API you can call from your own apps.

## Run it locally

```bash
npm install
npm start
```

Then open **http://localhost:3000**.

## API reference

One endpoint. Hit the URL, get a PNG back.

```
GET /qr?text=<your text>&size=<px>&color=<hex>&bg=<hex>
```

| Param      | Required | Default   | Notes                                            |
|------------|----------|-----------|--------------------------------------------------|
| `text`     | yes      | —         | The link or text to encode (URL-encode it).      |
| `size`     | no       | `512`     | Image width in px (clamped to 64–1200).          |
| `color`    | no       | `#0b0f17` | Foreground (module) color, hex.                  |
| `bg`       | no       | `#ffffff` | Background color, hex.                            |
| `download` | no       | —         | Set `download=1` to get a `Content-Disposition` attachment header. |

The response is `Content-Type: image/png`.

### Examples

```bash
# Basic
curl "http://localhost:3000/qr?text=hello" --output qr.png

# A styled, larger code that downloads as a file
curl "http://localhost:3000/qr?text=https%3A%2F%2Fhost.impossi.build&size=800&color=%23818cf8&download=1" --output qr.png
```

Embed it straight into a webpage with an `<img>` tag:

```html
<img src="https://ifh-qr-demo.host.impossi.build/qr?text=hello&size=300" alt="QR code">
```

## Deploy your own

This whole project is a self-contained ifhost app. To put your own copy online, open your AI coding assistant in this folder and paste:

```
install github.com/ImpossibleFinance/impossible-hosting-skill
and deploy this project to ifhost
```

Your assistant handles the rest — it'll pick an app name with you and ship it. Your QR generator goes live at `https://<your-app>.host.impossi.build`.

## What's in here

| File              | What it does                                              |
|-------------------|-----------------------------------------------------------|
| `server.js`       | Plain Node HTTP server. Serves the UI and the `/qr` API.  |
| `index.html`      | The single-page web UI (no build step, no framework).     |
| `package.json`    | One dependency: [`qrcode`](https://www.npmjs.com/package/qrcode). |
| `impossible.toml` | ifhost app config (port 3000, 256 MB, shared CPU).        |
