# Multiverse Side-Scroller: preliminary build

This is a 16-bit multiverse side-scroller prototype built with Phaser 3 (vendored, MIT). It is a static site with no build step.

**Play:** https://ngtrooper.github.io/multiverse-sidescroller/

## Controls
| Key | Action |
| --- | --- |
| ← / → or A / D | move |
| Shift | run |
| Space / W / ↑ | jump (hold to jump higher) |
| J / Z | attack (Asagi: katana · Flash: rapid punch combo) |
| Tab or 1 / 2 | tag-swap hero in place (each keeps own HP) |
| F | Flashpoint special: portal, fade, stage restarts (rebirth prototype) |
| R | restart |

Start as The Flash: https://ngtrooper.github.io/multiverse-sidescroller/?hero=Flash

## What's in this build
- One test stage with parallax, one-way platforms, gaps, oni and drone enemies, an HP HUD, crits and a goal portal.
- Asagi's sprites come from image-to-video animation. Each clip is keyed off a magenta background, the feet are stabilised, and the frames are reduced to a locked 96-colour palette with a 1px outline. In game she is drawn at a 300px body height, so 1 texel = 1 screen pixel on the 1280x720 canvas.
  - idle, walk and attack each come from their own generated video clip.
  - run reuses the walk cycle at a higher rate.
  - jump and hurt are placeholder frames.

- **The Flash (Barry Allen)** is the second hero. His sprites use the same video pipeline: idle, sprint (run, which is also his jog), a punch combo, and a Flashpoint special clip (crouch, lightning charge, sprint). Jump and hurt are placeholders.
  - He is about 1.9x faster than Asagi. While running he leaves programmatic afterimages, speed lines and lightning.
  - Flashpoint (F) opens a procedural time portal. He dashes into it and the stage restarts.
- The hero stats file ships only the heroes in this build.

To run it locally, serve the folder over HTTP: `python3 -m http.server`, then open http://localhost:8000/.
