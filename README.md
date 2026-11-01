# Multiverse Side-Scroller: preliminary build

This is a 16-bit multiverse side-scroller prototype built with Phaser 3 (vendored, MIT). It is a static site with no build step.

**Play:** https://ngtrooper.github.io/multiverse-sidescroller/

## Controls
| Key | Action |
| --- | --- |
| ← / → or A / D | move |
| Shift | run |
| Space / W / ↑ | jump (hold to jump higher) |
| J / Z | attack (Asagi: katana · Flash: rapid punch combo · Iron Man: hold to fire repulsors, alternating hands · Poison Ivy: vine whip · Robot: arm blaster) |
| K / X | Poison Ivy: Thorn Eruption, a thorny vine bursts out of the floor under the nearest enemy (3.5 s cooldown) · Robot: Drone Support, 2 drones laser the nearest enemy for 5 s (10 s cooldown) |
| Tab or 1 / 2 / 3 / 4 / 5 / 6 | tag-swap hero in place (each keeps own HP) |
| Sakura (ninja) | Space in the air: front-flip double jump · **L or C**: dash (i-frames, afterimages, also once in the air) |
| Iron Man | arrows / WASD fly 8-way · Space / Shift boost · no gravity while he's active |
| F | Flashpoint special: portal, fade, stage restarts (rebirth prototype) |
| R | restart |

Start as The Flash: https://ngtrooper.github.io/multiverse-sidescroller/?hero=Flash
Start as Iron Man: https://ngtrooper.github.io/multiverse-sidescroller/?hero=IronMan
Start as Poison Ivy: https://ngtrooper.github.io/multiverse-sidescroller/?hero=PoisonIvy
Start as Robot: https://ngtrooper.github.io/multiverse-sidescroller/?hero=Robot

## What's in this build
- One test stage with parallax, one-way platforms, gaps, Hydra gunners and drone enemies, an HP HUD and crits.
- **Hero base and enemy spawn gate** (16-bit structures in the same style as the heroes):
  - The heroes' outpost at the left is where you start and come back after a Flashpoint. The hero appears at its door. Its flags flutter, the time core pulses, and the lights blink.
  - The Hydra-tech rift gate at the right end has a swirling purple and green rift with blinking warning lamps. When you get close it bursts and the last wave (a drone, a Grunt and an Elite) steps out of it. Reach its centre to seal the rift and clear the stage.
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
- **Robot (Invincible)** is the fifth hero: a ranged tactician and summoner. His sprites use the same video pipeline: idle (mechanical breathing, head scan, eye pulse), walk, an arm-blaster attack where his arm reconfigures into a cannon, and a hurt flinch. Jump is a placeholder.
  - Arm blaster (J/Z): one green bolt per shot, 0.8× ATK, 330px range, with a wide aim assist so he can hit enemies below a platform.
  - Drone Support (K/X): 2 pixel-art drones hover beside the active hero for 5s and laser the nearest enemy every 0.5s (0.2× ATK each). They keep going after a tag-swap. 10s cooldown.
  - Logic Engine: +15% ATK to every party member while Robot is in the party (the HUD shows `ATK 402+` and the buff tag).
- **Sakura Igawa (Action Taimanin)** is the sixth hero and the first with the **ninja movement kit**, an opt-in profile in `data/roster.json` that other heroes can adopt later. Her sprites use the same video pipeline: idle, a fast ninja run, a 4-hit dual-blade combo, a front-flip double jump, an air slash, a low dash, an iaido dash cut and a hurt flinch.
  - Combo (tap J/Z): 4 hits at 85/95/110/160% ATK. Press during a hit or within 0.26s after to chain; the finisher launches grunts.
  - Air slash (J/Z in the air): one per jump, with a small hop. Dash (L or C): 560px/s with i-frames and afterimages. Dash cut (J/Z during a dash): she streaks 260px and every enemy in the line is cut as she sheathes.
  - Shadow Clone (K/X): she vanishes, up to 3 shadow clones slash the nearest enemies, and she blinks in behind the last one. 6s cooldown.
- **Hydra Grunts** replace the old placeholder oni and are the first ranged enemies. They march in, stop 250–300px away and fire 3-round bursts of slow green energy bolts from their rifles. Jump over the bolts, back out of range, or fly over them as Iron Man. Sprites come from the same video pipeline (idle, walk, rifle burst, hurt, death).
  - **Hydra Elite** is a crimson palette swap with 2× HP, harder-hitting faster bolts and a shorter reload. Two of them guard the second half of the stage.
  - The stage has 4 Grunts, 2 Elites and 6 drones. Enemy numbers live in `data/enemies.json`.
- The hero stats file ships only the heroes in this build.

To run it locally, serve the folder over HTTP: `python3 -m http.server`, then open http://localhost:8000/.
