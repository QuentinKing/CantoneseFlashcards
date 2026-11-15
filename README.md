# Cantonese Flashcards

> **🤖 AI-generated project.** All of the code, the card data and this README were written
> by an AI coding assistant (Claude, by Anthropic), not by the repository owner. The owner
> asked for the app and uses it to study Cantonese, but makes no claim to having written any of it.

A small flashcard app for learning Cantonese. It's a web app (PWA), so the same
files run on Windows for testing and install on an iPhone as a home-screen app.
There's no build step and nothing to install.

## Files

| File | What it is |
|---|---|
| `cards.txt` | **The database.** One card per line: `English,Character,Jyutping,AudioLink` |
| `index.html`, `style.css`, `app.js` | The app |
| `start-windows.bat` / `serve.ps1` | Local web server for Windows |
| `sw.js`, `manifest.webmanifest`, `icon-*.png` | Lets the app install on iOS and work offline |

## Run it on Windows

Double-click **`start-windows.bat`**. It opens http://localhost:8000 in your browser.
Press Ctrl+C in the console window to stop it.
(Opening `index.html` directly won't work, because browsers block reading `cards.txt` from `file://`.)

Desktop keyboard shortcuts while studying: **Space** flips the card, **→** or **1** means right,
**←** or **2** means wrong, and **P** plays the audio.

## Put it on your iPhone

iOS needs the files served over HTTPS to install the app properly. The easiest free options:

1. **Netlify Drop**: go to https://app.netlify.com/drop and drag the `CantoneseFlashcards` folder in.
   You get an https URL.
   **or GitHub Pages**: push this folder to a repo and enable Pages in its settings.
2. On the iPhone, open that URL in **Safari**, tap **Share**, then **Add to Home Screen**.
3. It now opens full-screen like a native app and works offline. Audio falls back to the
   built-in voice when you're offline.

### Offline / weak signal

After the first launch with a connection, the app always opens instantly from the copy stored
on the phone and never waits on the network. It downloads updates quietly in the background, so
after you push a change to `cards.txt` the new deck appears on the **second** launch.
If a pronunciation recording hasn't started within 2 seconds (no signal, or a weak one), the
app reads the word with the iPhone's Cantonese voice instead. To get a better voice, go to
Settings, Accessibility, Spoken Content, Voices, Chinese (Hong Kong).

## Editing the deck (`cards.txt`)

```
English definition,Chinese character,Jyutping,Audio link(s)
hello,你好,nei5 hou2,https://.../nei5.wav https://.../hou2.wav
water,水,seoi2,
```

- Lines starting with `#` are comments.
- Avoid commas inside a field, or wrap the field in `"double quotes"`.
- The audio field is **optional**. It can be blank, one URL (mp3, wav, m4a and so on), or several
  URLs separated by spaces, which play one after another.
- If the audio field is blank, the app uses the device's Cantonese text-to-speech voice
  (iOS has one built in. On Windows, you can add "Chinese (Traditional, Hong Kong SAR)" under
  Settings, Time & language, Speech).
- You can also put mp3 files next to the app (for example `audio/water.mp3`) and use relative links.

### Audio source

The included links are per-syllable recordings from the CUHK *Chinese Character Database*
(humanum.arts.cuhk.edu.hk/Lexis/lexi-can). Multi-syllable words play each syllable in sequence, so
they sound a little choppy compared with natural speech, but each tone is clear.

## Stats

Your right and wrong counts are saved on the device (browser localStorage), per card and per study mode.
Hover over a row on the Stats page on desktop to see the per-mode breakdown. **Reset all stats**
clears them. Stats are keyed by character and English text, so if you change a card's text, that card's stats start over.
