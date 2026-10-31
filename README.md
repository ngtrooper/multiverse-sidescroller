# Multiverse Side-Scroller: preliminary build

This is a 16-bit multiverse side-scroller prototype built with Phaser 3 (vendored, MIT). It is a static site with no build step.

**Play:** https://ngtrooper.github.io/multiverse-sidescroller/

## Controls
| Key | Action |
| --- | --- |
| ← / → or A / D | move |
| Shift | run |
| Space / W / ↑ | jump (hold to jump higher) |
| J / Z | katana attack |
| R | restart |

## What's in this build
- One test stage with parallax, one-way platforms, gaps, oni and drone enemies, an HP HUD, crits and a goal portal.
- Asagi's sprites come from image-to-video animation. Each clip is keyed off a magenta background, the feet are stabilised, and the frames are reduced to a locked 96-colour palette with a 1px outline. In game she is drawn at a 300px body height, so 1 texel = 1 screen pixel on the 1280x720 canvas.
  - idle, walk and attack each come from their own generated video clip.
  - run reuses the walk cycle at a higher rate.
  - jump and hurt are placeholder frames.

To run it locally, serve the folder over HTTP: `python3 -m http.server`, then open http://localhost:8000/.
