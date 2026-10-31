# Multiverse Side-Scroller: preliminary build

This is a 16-bit multiverse side-scroller prototype built with Phaser 3 (vendored, MIT). It is a static site with no build step.

**Play:** https://ngtrooper.github.io/multiverse-sidescroller/

## Controls
| Key | Action |
| --- | --- |
| ← / → or A / D | move |
| Shift | run |
| Space / W / ↑ | jump (hold to jump higher) |
| J / Z | attack (Asagi: katana · Flash: rapid punch combo · Iron Man: hold to fire repulsors, alternating hands · Poison Ivy: vine whip) |
| K / X | Poison Ivy: Thorn Eruption, a thorny vine bursts out of the floor under the nearest enemy (3.5 s cooldown) |
| Tab or 1 / 2 / 3 / 4 | tag-swap hero in place (each keeps own HP) |
| Iron Man | arrows / WASD fly 8-way · Space / Shift boost · no gravity while he's active |
| F | Flashpoint special: portal, fade, stage restarts (rebirth prototype) |
| R | restart |

Start as The Flash: https://ngtrooper.github.io/multiverse-sidescroller/?hero=Flash
Start as Iron Man: https://ngtrooper.github.io/multiverse-sidescroller/?hero=IronMan
Start as Poison Ivy: https://ngtrooper.github.io/multiverse-sidescroller/?hero=PoisonIvy

## What's in this build
- One test stage with parallax, one-way platforms, gaps, oni and drone enemies, an HP HUD, crits and a goal portal.
- Asagi's sprites come from image-to-video animation. Each clip is keyed off a magenta background, the feet are stabilised, and the frames are reduced to a locked 96-colour palette with a 1px outline. In game she is drawn at a 300px body height, so 1 texel = 1 screen pixel on the 1280x720 canvas.
  - idle, walk and attack each come from their own generated video clip.
  - run reuses the walk cycle at a higher rate.
  - jump and hurt are placeholder frames.

- **The Flash (Barry Allen)** is the second hero. His sprites use the same video pipeline: idle, sprint (run, which is also his jog), a punch combo, and a Flashpoint special clip (crouch, lightning charge, sprint). Jump and hurt are placeholders.
  - He is about 1.9x faster than Asagi. While running he leaves programmatic afterimages, speed lines and lightning.
  - Flashpoint (F) opens a procedural time portal. He dashes into it and the stage restarts.
- **Iron Man MK VII** is the third hero and the first flying, ranged unit. Sprites from the same video pipeline: hover idle with boot jets, a forward-lean flight loop, and repulsor attacks that alternate hands: a palm-raise shot, then a straight cross-chest shot from the other hand. Each bolt leaves from the hand that fired it. Jump and hurt are placeholders.
  - Flight: no gravity, 8-way movement with acceleration, drag and a hover bob; Space/Shift boost. He can hover over pits but can't go through the ground.
  - Repulsor: hold J/Z for about 2.4 shots per second, alternating hands (0.55× ATK each, 300px range, light aim assist). Every hit adds a Burn stack (2 on crit) that ticks 5% ATK per stack every 0.5s for 2s, shown as small flames.
  - Tag-swapping midair to Asagi or Flash makes them fall; swapping back resumes hovering. More drones were added to the stage.
- **Poison Ivy (Shtora)** is the fourth hero: a melee fighter with a damage-over-time passive. Her sprites use the same video pipeline: idle (breathing, hair and leaf sway, curling fingers), a catwalk walk cycle, a thorny vine-whip attack from her raised hand that snaps back, and a real hurt flinch. Jump is a placeholder.
  - Vine whip (J/Z): reach about 84px, one hit per enemy per whip.
  - Thorn Eruption (K/X): a thorny vine bursts out of the floor under the nearest enemy within 360px (or just in front of her), lashes, and sinks back. It hits each enemy it touches once for 1.4× ATK, always adds a Poison stack, reaches flying drones, and has a 3.5s cooldown shown in the HUD. The vine is its own sprite made with the same video pipeline (no character).
  - Toxic: every hit has a 50% chance to add a Poison stack. Stacks have no cap and last until the enemy dies. Every second, each stack deals 2% of the enemy's max HP. You'll see green bubbles, stack pips over the enemy's HP bar and green tick numbers. Poison keeps ticking after you tag her out.
- The hero stats file ships only the heroes in this build.

To run it locally, serve the folder over HTTP: `python3 -m http.server`, then open http://localhost:8000/.
