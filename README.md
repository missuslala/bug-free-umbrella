# Closet Outfit Maker

A small web app for cataloguing the clothes in your closet and putting outfits together from them.

## Use it

Open `index.html` in any modern browser. There's no build step and nothing to install.
To use it from your phone, host the folder anywhere static (GitHub Pages works), or run
`python3 -m http.server` in this folder and open the address it prints.

## Features

- **My closet** – add items with an optional photo, a category (top, bottom, dress, outerwear, shoes, accessory),
  a color, and the seasons and occasions they suit. Filter by category or search by name or color. Tap an item to edit or delete it.
- **Add from a shop link** – paste a product link from an online shop and the app reads the name, category,
  color, season and occasion from the link itself, marks the item *On order*, and keeps an "Open in shop" link.
  Copy the product photo in the shop and paste it into the dialog to add the picture. (Shop pages can't be
  fetched from the browser, so links without a product name in them, such as Uniqlo's, need the details typed in.)
- **Make outfit** – **New look** asks the built-in stylist for an outfit (top + bottom, or a dress, then shoes,
  plus optional outerwear and an accessory), filtered by occasion and season. The stylist ranks looks on a
  single color story, matching formality, color harmony (analogous or complementary), one print at a time,
  a finishing piece that echoes a base color, and light/dark contrast. It then explains the look in
  *Stylist's notes*, gives a styling tip and a verdict, and suggests three more looks to try.
  Choose **Keep** on a piece to hold it while the rest changes, or tap a piece to choose one yourself.
- **Saved** – name and save outfits you like, then open them again later.
- **Export / Import** – back up your closet (photos included) to a JSON file, or move it to another browser.

Your data stays on your device in browser storage (IndexedDB). Photos are shrunk before they're saved so
lots of items fit. Clearing site data will erase the closet, so export a backup now and then.
