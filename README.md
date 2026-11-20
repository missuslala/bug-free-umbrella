# Closet Outfit Maker

A small web app for cataloguing the clothes in your closet and putting outfits together from them.

## Use it

Open `index.html` in any modern browser. There's no build step and nothing to install.
To use it from your phone, host the folder anywhere static (GitHub Pages works), or run
`python3 -m http.server` in this folder and open the address it prints.

## Features

- **My closet** – add items with an optional photo, a category (top, bottom, dress, outerwear, shoes, accessory),
  a color, and the seasons and occasions they suit. Filter by category or search by name or color. Tap an item to edit or delete it.
- **Make outfit** – **Shuffle** builds an outfit (top + bottom, or a dress, then shoes, plus optional outerwear
  and an accessory). It filters by occasion and season and avoids clashes: it allows at most two accent
  colors and one patterned piece (neutrals like black, white, navy, beige and denim go with anything).
  Lock 🔒 a piece to keep it while you shuffle the rest, or tap a piece to choose one yourself.
- **Saved** – name and save outfits you like, then open them again later.
- **Export / Import** – back up your closet (photos included) to a JSON file, or move it to another browser.

Your data stays on your device in browser storage (IndexedDB). Photos are shrunk before they're saved so
lots of items fit. Clearing site data will erase the closet, so export a backup now and then.
