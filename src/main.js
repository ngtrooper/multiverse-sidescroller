// Rift Runners — test stage. Phaser 3 (vendored), arcade physics.
// World is laid out in 640x360 "world px"; the canvas is 2x (1280x720) and the camera zooms 2x, so the
// HD hero sprites (drawn at 0.5 scale) show 1 texel = 1 screen px while the world tiles stay chunky 2x.
// Party: every roster hero is loaded; Tab / 1-5 tag-swaps in place. F = Flashpoint (rebirth demo).
// Enemies: Hydra Grunts / Elites (data/enemies.json) march in, hold a 250-300 px standoff and fire 3-round bursts of
// dodgeable energy bolts; drones swoop. Robot (hero 5) shoots an arm blaster, K/X deploys 2 auto-firing drones,
// and his Logic Engine passive (+15% ATK to the whole party) is applied in loader.js.
// Flying heroes (roster.flight, e.g. Iron Man) ignore gravity and move 8-way; ranged heroes fire projectiles with Burn DoT.
// roster.poison (Poison Ivy's Toxic): 50% per hit to add an uncapped Poison stack, each ticking 2% of the enemy's max HP per second.
const VW = 640, VH = 360, GROUND_Y = 316, WORLD_W = 3600, ZOOM = 2;
// scrollFactor-0 objects are zoomed around the screen centre; this offset pins them to the top-left
const UIX = VW * (ZOOM - 1) / 2, UIY = VH * (ZOOM - 1) / 2;

class GameScene extends Phaser.Scene {
  constructor() { super('game'); }
  init(data) {
    this.party = data.party; this.idx = data.idx || 0; this.hero = this.party[this.idx];
    if (data.enemies) GameScene.E = data.enemies;   // enemy archetypes + Hydra sprite meta (kept across restarts)
    this.E = GameScene.E;
    this.rebirths = data.rebirths || 0; this.msg = null; this.dashFx = false;
  }
  preload() {
    for (const h of this.party) {
      const m = h.sprite.meta;
      for (const [name, a] of Object.entries(m.animations))
        if (!this.textures.exists(`${h.key}_${name}`))
          this.load.spritesheet(`${h.key}_${name}`, h.sprite.dir + a.sheet, { frameWidth: a.frameWidth || m.frameWidth, frameHeight: a.frameHeight || m.frameHeight });
      if (!this.textures.exists(`portrait_${h.key}`)) this.load.image(`portrait_${h.key}`, h.portrait);
      if (h.floorVine && !this.textures.exists(`${h.key}_floorvine`)) {   // Poison Ivy: Thorn Eruption FX sheet
        const V = h.floorVine.meta;
        this.load.spritesheet(`${h.key}_floorvine`, h.floorVine.dir + V.animations.floor_vine.sheet, { frameWidth: V.frameWidth, frameHeight: V.frameHeight });
      }
      if (h.ranged && !this.textures.exists(`${h.key}_bolt`)) {
        this.load.spritesheet(`${h.key}_bolt`, h.sprite.dir + 'repulsor.png', { frameWidth: 56, frameHeight: 24 });
        this.load.spritesheet(`${h.key}_bolthit`, h.sprite.dir + 'repulsor_hit.png', { frameWidth: 40, frameHeight: 40 });
        if (h.burn && !this.textures.exists('burn')) this.load.spritesheet('burn', h.sprite.dir + 'burn.png', { frameWidth: 16, frameHeight: 20 });
      }
      if (h.drones && !this.textures.exists(`${h.key}_drone`)) {   // Robot: support drones + their laser
        this.load.spritesheet(`${h.key}_drone`, h.sprite.dir + h.drones.sheet, { frameWidth: 40, frameHeight: 28 });
        this.load.image(`${h.key}_dlaser`, h.sprite.dir + h.drones.laser);
      }
    }
    // Hydra Grunt / Elite (palette swap): one sheet per anim, death has its own frame box
    const E = this.E, M = E.meta;
    for (const t of Object.values(E.types)) for (const [name, a] of Object.entries(M.animations)) {
      const k = `${t.sheetPrefix}_${name}`;
      if (!this.textures.exists(k)) this.load.spritesheet(k, E.dir + a.sheet.replace(/^hydra_/, t.sheetPrefix + '_'), { frameWidth: a.frameWidth || M.frameWidth, frameHeight: a.frameHeight || M.frameHeight });
    }
    if (!this.textures.exists('hydra_bolt')) {
      this.load.spritesheet('hydra_bolt', E.bolt.sheet, { frameWidth: E.bolt.frameWidth, frameHeight: E.bolt.frameHeight });
      this.load.spritesheet('hydra_flash', E.bolt.flash, { frameWidth: E.bolt.flashSize, frameHeight: E.bolt.flashSize });
    }
    if (!this.cache.json.exists('structures')) {   // spawn gate + hero base (tools/make_structures.py)
      const D = 'assets/sprites/structures/';
      this.load.json('structures', D + 'structures.json');
      [['st_gate', 'spawn_gate'], ['st_gate_lamps', 'spawn_gate_lamps'], ['st_gate_cond', 'spawn_gate_conduits'], ['st_rift_loop', 'rift_loop'],
       ['st_rift_burst', 'rift_burst'], ['st_base', 'hero_base'], ['st_base_anim', 'hero_base_anim']].forEach(([k, f]) => this.load.image(k, D + f + '.png'));
    }
  }
  A(name, h = this.hero) { return `${h.key}:${name}`; }
  // ranged heroes with *_alt sheets fire with alternating hands: hand 0 = attack/shoot/lower, hand 1 = *_alt
  RA(name, hand = this.st.hand) { return this.A(hand && this.hero.sprite.meta.animations[name + '_alt'] ? name + '_alt' : name); }
  isFireAnim(key) { return ['attack', 'shoot', 'attack_alt', 'shoot_alt'].some(n => key === this.A(n)); }
  create() {
    Tex.all(this, VW, VH);
    makePoisonTex(this);
    makeTimePortal(this);
    this.physics.world.setBounds(0, 0, WORLD_W, VH + 200);
    this.cameras.main.setBounds(0, 0, WORLD_W, VH).setZoom(ZOOM).setRoundPixels(true);

    // ---- parallax layers (fixed to camera, scrolled via tilePosition) ----
    this.add.image(UIX, UIY, 'bg_sky').setOrigin(0).setScrollFactor(0);
    this.par = [['bg_far', 0.15, 0], ['bg_mid', 0.35, 10], ['bg_near', 0.6, 40]].map(([k, f, y]) =>
      ({ f, s: this.add.tileSprite(UIX, UIY + y, VW, VH, k).setOrigin(0).setScrollFactor(0) }));

    // ---- level ----
    this.solids = this.physics.add.staticGroup();
    this.oneway = this.physics.add.staticGroup();
    const ground = (x, w) => {
      const top = this.add.tileSprite(x, GROUND_Y, w, 16, 'tile_ground').setOrigin(0);
      this.add.tileSprite(x, GROUND_Y + 16, w, VH - GROUND_Y, 'tile_fill').setOrigin(0);
      this.solids.add(top); top.body.setSize(w, 16).setOffset(0, 0); top.body.updateFromGameObject();
    };
    ground(0, 1100); ground(1180, 900); ground(2170, WORLD_W - 2170);
    const plat = (x, y, w) => {
      const p = this.add.tileSprite(x, y, w, 10, 'tile_plat').setOrigin(0);
      this.oneway.add(p); p.body.updateFromGameObject();
      p.body.checkCollision.down = p.body.checkCollision.left = p.body.checkCollision.right = false;
    };
    [[360, 250, 96], [520, 200, 80], [700, 240, 112], [1060, 236, 128], [1320, 220, 96], [1480, 170, 96], [1660, 230, 128],
     [1990, 240, 160], [2300, 220, 96], [2480, 180, 112], [2700, 236, 96], [2900, 200, 128]].forEach(a => plat(...a));

    // Tex.all regenerates these textures on every (re)start, so their anims must be rebuilt too
    ['oni_walk', 'drone_fly'].forEach(k => this.anims.remove(k));
    // ---- structures: hero base (start / tag-in / rebirth point) and the enemy spawn gate (goal: seal it) ----
    makeStructures(this);
    this.goal = this.gate;

    // ---- player ----
    this.party.forEach(h => this.makeAnims(h));
    this.player = this.physics.add.sprite(this.base.doorX, GROUND_Y - 4, `${this.hero.key}_idle`, 0).setDepth(5);
    this.player.body.setMaxVelocity(520, 900);
    this.physics.add.collider(this.player, this.solids);
    this.physics.add.collider(this.player, this.oneway, null, () => !this.hero.flight);   // flyers pass through one-way platforms
    this.hpStore = Object.fromEntries(this.party.map(h => [h.key, h.stats.hp]));
    this.st = { hp: this.hero.stats.hp, maxHp: this.hero.stats.hp, facing: 1, attacking: false, hitSet: null, invuln: 0, hurtT: 0, jumpT: 0, landT: 0,
      wasGround: true, dead: false, won: false, special: false, swapCd: 0, momentum: 0, trailT: 0, vineCd: 0 };
    this.applyHero();
    this.player.on('animationcomplete', (a) => {
      if (this.isFireAnim(a.key)) { this.st.attacking = false; if (this.hero.ranged) this.st.raisedT = this.hero.ranged.holdMs / 1000; }
      if (a.key === this.A('lower') || a.key === this.A('lower_alt')) this.st.lowering = false;
    });
    this.player.on('animationupdate', (a, f) => {
      if (this.hero.ranged) { if (this.isFireAnim(a.key) && f.index - 1 === this.hero.sprite.meta.animations[a.key.split(':')[1]].fireFrame) this.fireBolt(); return; }
      if (a.key === this.A('attack')) this.onAttackFrame(f.index - 1);
    });
    this.bolts = this.physics.add.group({ allowGravity: false });

    // ---- enemies ----
    this.enemies = this.physics.add.group({ allowGravity: true });
    this.anims.create({ key: 'oni_walk', frames: this.anims.generateFrameNumbers('oni', { frames: [0, 1] }), frameRate: 5, repeat: -1 });
    this.anims.create({ key: 'drone_fly', frames: this.anims.generateFrameNumbers('drone', { frames: [0, 1] }), frameRate: 10, repeat: -1 });
    this.makeEnemyAnims();
    this.ebolts = this.physics.add.group({ allowGravity: false });
    // Hydra Grunts replace the old placeholder oni on the ground; two Elites guard the back half. Drones unchanged.
    [[620, 'hydra'], [980, 'drone'], [1140, 'drone', 150], [1400, 'hydra'], [1750, 'hydra'], [1900, 'drone'], [2120, 'drone', 140], [2400, 'elite'],
     [2600, 'drone']]
      .forEach(([x, t, y]) => this.spawn(t, x, y));
    // the last three come out of the spawn gate as one wave when the hero gets close (same enemies / homes as before)
    this.gateWave = { at: 2550, done: false, list: [['drone', 2820, 130], ['hydra', 3000], ['elite', 3200]] };
    this.physics.add.collider(this.enemies, this.solids);
    this.physics.add.overlap(this.player, this.enemies, (p, e) => this.touchEnemy(e));
    this.physics.add.overlap(this.bolts, this.enemies, (b, e) => this.boltHit(b, e));
    this.physics.add.collider(this.bolts, this.solids, (b) => this.boltPop(b));
    this.physics.add.overlap(this.player, this.ebolts, (p, b) => this.enemyBoltHit(b));
    this.physics.add.collider(this.ebolts, this.solids, (b) => this.enemyBoltPop(b));
    this.dbolts = this.physics.add.group({ allowGravity: false }); this.drones = [];
    this.physics.add.overlap(this.dbolts, this.enemies, (b, e) => this.droneBoltHit(b, e));

    // ---- camera / input / hud ----
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12, 0, 40).setDeadzone(60, 40);
    this.keys = this.input.keyboard.addKeys('LEFT,RIGHT,UP,DOWN,A,D,W,S,SPACE,J,Z,K,X,SHIFT,R,F,TAB,ONE,TWO,THREE,FOUR,FIVE');
    this.input.keyboard.addCapture('SPACE,UP,DOWN,LEFT,RIGHT,TAB');
    this.buf = { jump: 0, atk: 0 };
    const kb = this.input.keyboard;
    ['SPACE', 'UP', 'W'].forEach(k => kb.on('keydown-' + k, () => this.buf.jump = 0.12));
    ['J', 'Z'].forEach(k => kb.on('keydown-' + k, () => this.buf.atk = 0.15));
    kb.on('keydown-TAB', () => this.swapTo((this.idx + 1) % this.party.length));
    ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE'].forEach((k, i) => kb.on('keydown-' + k, () => this.swapTo(i)));
    kb.on('keydown-F', () => this.flashpoint());
    ['K', 'X'].forEach(k => kb.on('keydown-' + k, () => this.castSpecial()));   // Ivy: Thorn Eruption · Robot: drones
    this.makeHud();
    this.heroEmerge();
    if (this.rebirths) {
      this.msg.setText(`FLASHPOINT #${this.rebirths}\ntimeline rewritten`);
      this.time.delayedCall(1800, () => { if (!this.st.dead && !this.st.won) this.msg.setText(''); });
      this.cameras.main.fadeIn(500, 255, 240, 200);
    }
  }

  // ---------------- structures ----------------
  heroEmerge() {   // the hero steps out of the base's door on start / rebirth: core flare + white fade-in
    const p = this.player, B = this.base;
    p.setTintFill(0xfff6c8).setAlpha(0.2);
    this.tweens.add({ targets: p, alpha: 1, duration: 420, onComplete: () => { if (!this.st.dead) p.clearTint(); } });
    this.time.delayedCall(260, () => { if (p.isTintFill && !this.st.dead) p.clearTint(); });
    B.flare(1);
    this.sparks(B.doorX, GROUND_Y - 50, 0xfff2a0, 10);
  }
  updateStructures(dt, time) {
    const G = this.gate, W = this.gateWave, t = time / 1000;
    // gate lights: slow blink idle, fast strobe while it is spawning / bursting, off once sealed
    const hot = G.hotT > 0; G.hotT = Math.max(0, G.hotT - dt);
    if (!G.sealed) {
      G.lamps.setAlpha(hot ? (Math.floor(t * 10) % 2 ? 1 : 0.25) : (Math.floor(t * 1.4) % 2 ? 0.95 : 0.35));
      G.cond.setAlpha(hot ? 0.95 : 0.35 + 0.3 * (0.5 + 0.5 * Math.sin(t * 2.6)));
    }
    this.base.core.setAlpha(this.base.coreBase + 0.12 * Math.sin(t * 3.1));
    if (!W.done && !this.st.dead && this.player.x > W.at) {
      W.done = true;
      W.list.forEach(([type, home, y], i) => this.time.delayedCall(250 + i * 1100, () => this.gateSpawn(type, home, y)));
    }
  }
  gateBurst() {
    const G = this.gate; if (G.sealed) return;
    G.hotT = 1.3; G.rift.play('st:rift_burst', true);
    this.cameras.main.shake(160, 0.003);
    this.sparks(G.cx, G.cy, 0x9dff7a, 10); this.sparks(G.cx, G.cy, 0xc070ff, 10);
  }
  gateSpawn(type, home, y) {   // enemy fades / steps out of the rift, then walks (or flies) to its old post
    const G = this.gate; if (G.sealed || this.st.won) return;
    this.gateBurst();
    const n = this.enemies.getLength();
    this.spawn(type, G.x, type === 'drone' ? G.cy - 20 : y);
    const e = this.enemies.getChildren()[n]; if (!e) return;
    e.home = home; if (type === 'drone') e.homeY = y;
    e.emerge = e.emergeT = type === 'drone' ? 0.8 : 1.1;
    e.setAlpha(0.3).setTint(0xe6b8ff).setDepth(1.05);   // behind the gate frame while it steps out
    this.time.delayedCall(e.emergeT * 1000 * 0.75, () => e.active && e.setDepth(4));
  }
  sealGate() {
    const G = this.gate; if (G.sealed) return; G.sealed = true;
    G.rift.play('st:rift_burst', true);
    this.cameras.main.flash(260, 200, 140, 255); this.cameras.main.shake(260, 0.004);
    this.sparks(G.cx, G.cy, 0xffffff, 18); this.sparks(G.cx, G.cy, 0x9dff7a, 14);
    this.tweens.add({ targets: G.rift, scaleX: 0, alpha: 0, delay: 350, duration: 520, ease: 'Back.easeIn' });
    this.tweens.add({ targets: [G.lamps, G.cond], alpha: 0, duration: 700 });
    this.player.setDepth(5);
  }

  makeAnims(h) {
    const m = h.sprite.meta;
    const mk = (name, sheetName, a, fps) => {
      const key = this.A(name, h); if (this.anims.exists(key)) return;
      const tex = `${h.key}_${sheetName}`;
      let frames = this.anims.generateFrameNumbers(tex, { start: 0, end: a.frames - 1 });
      if (a.durationsMs) { // per-frame timing (Phaser adds frame.duration on top of 1000/frameRate)
        frames = frames.map((f, i) => ({ ...f, duration: a.durationsMs[i] - 1 })); fps = 1000;
      }
      this.anims.create({ key, frames, frameRate: fps, repeat: a.loop ? -1 : 0 });
    };
    const M = h.move, an = m.animations;
    for (const [name, a] of Object.entries(an)) {
      let fps = a.fps;
      if (name === 'walk' && M.walkCyclePx) fps = M.walkSpeed * a.frames / M.walkCyclePx;        // no foot sliding
      if (name === 'run' && M.runCyclePx && an.run.source) fps = M.runSpeed * a.frames / M.runCyclePx;
      mk(name, name, a, fps);
    }
    // heroes without a run video reuse the walk cycle faster; heroes without a walk video jog with the run cycle
    if (an.fly) { mk('run', 'fly', an.fly, an.fly.fps); mk('walk', 'fly', an.fly, an.fly.fps); }   // flyers: dash = fly pose
    else {
      if (!an.run) mk('run', 'walk', { ...an.walk }, M.runSpeed * an.walk.frames / (M.runCyclePx || M.walkCyclePx * 1.6));
      if (!an.walk) mk('walk', 'run', { ...an.run }, M.walkSpeed * an.run.frames / M.runCyclePx);
    }
    if (h.floorVine && !this.anims.exists(`${h.key}:floorvine`)) {
      const a = h.floorVine.meta.animations.floor_vine;
      const frames = this.anims.generateFrameNumbers(`${h.key}_floorvine`, { start: 0, end: a.frames - 1 }).map((f, i) => ({ ...f, duration: a.durationsMs[i] - 1 }));
      this.anims.create({ key: `${h.key}:floorvine`, frames, frameRate: 1000, repeat: 0 });
    }
    if (h.ranged) {
      const k1 = `${h.key}:bolt`, k2 = `${h.key}:bolthit`;
      if (!this.anims.exists(k1)) this.anims.create({ key: k1, frames: this.anims.generateFrameNumbers(`${h.key}_bolt`, { start: 0, end: 3 }), frameRate: 16, repeat: -1 });
      if (!this.anims.exists(k2)) this.anims.create({ key: k2, frames: this.anims.generateFrameNumbers(`${h.key}_bolthit`, { start: 0, end: 3 }), frameRate: 20, repeat: 0 });
      if (h.burn && !this.anims.exists('burn')) this.anims.create({ key: 'burn', frames: this.anims.generateFrameNumbers('burn', { start: 0, end: 5 }), frameRate: 14, repeat: -1 });
    }
  }

  makeEnemyAnims() {
    const E = this.E, M = E.meta;
    for (const t of Object.values(E.types)) for (const [name, a] of Object.entries(M.animations)) {
      const key = `${t.sheetPrefix}:${name}`; if (this.anims.exists(key)) continue;
      let frames = this.anims.generateFrameNumbers(`${t.sheetPrefix}_${name}`, { start: 0, end: a.frames - 1 }), fps = a.fps;
      if (a.durationsMs) { frames = frames.map((f, i) => ({ ...f, duration: a.durationsMs[i] - 1 })); fps = 1000; }
      if (name === 'walk') fps = t.walkSpeed * a.frames / t.walkCyclePx;   // feet don't slide at walkSpeed (timeScale follows |vx|)
      this.anims.create({ key, frames, frameRate: fps, repeat: a.loop ? -1 : 0 });
    }
    if (!this.anims.exists('hydra:bolt')) {
      this.anims.create({ key: 'hydra:bolt', frames: this.anims.generateFrameNumbers('hydra_bolt', { start: 0, end: 3 }), frameRate: 16, repeat: -1 });
      this.anims.create({ key: 'hydra:flash', frames: this.anims.generateFrameNumbers('hydra_flash', { start: 0, end: 3 }), frameRate: 30, repeat: 0 });
    }
    for (const h of this.party) if (h.drones && !this.anims.exists(`${h.key}:drone`))
      this.anims.create({ key: `${h.key}:drone`, frames: this.anims.generateFrameNumbers(`${h.key}_drone`, { start: 0, end: 3 }), frameRate: 14, repeat: -1 });
  }

  // put the current hero's textures / origin / hitbox on the shared player body
  applyHero() {
    const h = this.hero, m = h.sprite.meta, p = this.player, B = h.sprite.body;
    const ax = m.anchor.x, ay = (m.anchor.footRow + 1) / m.frameHeight;
    p.anims.stop(); p.setTexture(`${h.key}_idle`, 0).setOrigin(ax, ay).setScale(h.sprite.scale || 1).setAngle(0);
    p.body.setAllowGravity(!h.flight);                     // flyers hover; ground heroes fall when tagged in mid-air
    if (h.flight) p.setVelocityY(Math.min(0, p.body.velocity.y));
    Object.assign(this.st, { attacking: false, lowering: false, raisedT: 0, fireCd: 0, hand: 1 });   // hand 1 so the first shot uses hand 0
    p.body.setSize(B.width, B.height).setOffset(m.frameWidth * ax - B.width / 2, m.anchor.footRow + 1 - B.height);
    p.anims.play(this.A('idle'), true);
  }
  swapTo(i) {
    const st = this.st;
    if (i === this.idx || i >= this.party.length || st.dead || st.special || (st.attacking && !this.hero.ranged) || st.swapCd > 0 || st.won) return;
    this.hpStore[this.hero.key] = st.hp;
    const oldX = this.player.x, oldY = this.player.y;
    this.ghost(0xffffff, 0.7, 260);
    this.idx = i; this.hero = this.party[i];
    st.hp = this.hpStore[this.hero.key]; st.maxHp = this.hero.stats.hp; st.swapCd = 0.45; st.momentum = 0; st.invuln = Math.max(st.invuln, 0.6); st.hurtT = 0;
    this.applyHero(); this.player.setPosition(oldX, oldY);
    this.sparks(oldX, oldY - 70, 0xffe14a, 14); this.sparks(oldX, oldY - 70, 0x7ff0ff, 8);
    this.cameras.main.flash(90, 255, 240, 200);
    this.hud.destroy(); this.makeHud(); this.hpShown = st.hp;
    this.popText(oldX, oldY - 165, 'TAG IN: ' + this.hero.name.toUpperCase(), '#ffe14a', 10);
    if (st.hp <= 0) this.die();
  }

  spawn(type, x, y = 190) {
    let e;
    if (type === 'hydra' || type === 'elite') {
      const T = this.E.types[type], M = this.E.meta, B = this.E.sprite.body, sc = this.E.sprite.scale;
      e = this.enemies.create(x, GROUND_Y, `${T.sheetPrefix}_idle`, 0).setOrigin(M.anchor.x, (M.anchor.footRow + 1) / M.frameHeight).setScale(sc);
      e.body.setSize(B.width, B.height).setOffset(M.frameWidth * M.anchor.x - B.width / 2, M.anchor.footRow + 1 - B.height);
      e.play(`${T.sheetPrefix}:idle`);
      Object.assign(e, { kind: 'hydra', T, pre: T.sheetPrefix, hp: T.hp, maxHp: T.hp, atk: T.contact, speed: T.walkSpeed, dir: -1, home: x, range: T.patrolPx,
        cd: 0.6 + Math.random() * 0.8, shooting: false, hurtT: 0 });
      e.on('animationupdate', (a, f) => { if (a.key === `${e.pre}:attack` && M.animations.attack.fireFrames.includes(f.index - 1)) this.enemyFire(e); });
      e.on('animationcomplete', (a) => {
        if (a.key === `${e.pre}:attack`) { e.shooting = false; e.cd = T.cooldownMs / 1000 * Phaser.Math.FloatBetween(0.85, 1.15); }
        if (a.key === `${e.pre}:hurt`) e.hurtT = 0;
      });
    } else if (type === 'oni') {
      e = this.enemies.create(x, GROUND_Y - 70, 'oni', 0).setScale(2.5).play('oni_walk');
      e.body.setSize(22, 36).setOffset(4, 2);
      Object.assign(e, { kind: 'oni', hp: 2400, maxHp: 2400, atk: 140, speed: 34, dir: -1, home: x, range: 120 });
    } else {
      e = this.enemies.create(x, y, 'drone', 0).setScale(2.5).play('drone_fly');
      e.body.setAllowGravity(false); e.body.setSize(18, 16).setOffset(4, 3);
      Object.assign(e, { kind: 'drone', hp: 1400, maxHp: 1400, atk: 100, speed: 50, dir: -1, home: x, homeY: y, range: 90, t: Math.random() * 6 });
    }
    e.setDepth(4); e.stun = 0; e.hpBar = this.add.graphics().setDepth(6);
  }

  critChance() { const h = this.hero; return Math.min(1, h.stats.crit + (h.momentum ? Math.min(h.momentum.max, this.st.momentum * h.momentum.perHit) : 0)); }
  makeHud() {
    const h = this.hero;
    this.hud = this.add.container(UIX, UIY).setScrollFactor(0).setDepth(20);
    const g = this.add.graphics();
    g.fillStyle(0x0b0a18, 0.85).fillRect(6, 6, 246, 50);
    g.lineStyle(1, 0x6a5c8e).strokeRect(6.5, 6.5, 246, 50);
    g.fillStyle(h.ui?.accent ?? 0x44d8ff).fillRect(8, 8, 44, 44);
    const por = this.add.image(10, 10, `portrait_${h.key}`).setOrigin(0);
    const nm = h.name.length > 22 ? h.name.replace(/\s*\(.*\)/, '') : h.name;
    const name = this.add.text(58, 8, nm.toUpperCase(), { fontFamily: 'monospace', fontSize: '10px', color: '#ffffff' });
    this.subT = this.add.text(58, 20, '', { fontFamily: 'monospace', fontSize: '8px', color: '#b8a8ff' });
    this.hpG = this.add.graphics();
    this.hpT = this.add.text(58, 42, '', { fontFamily: 'monospace', fontSize: '8px', color: '#ffffff' });
    // party strip: who is benched (Tab / 1-4)
    const strip = this.party.map((ph, i) => this.add.text(6 + i * 70, 60, `${i + 1} ${ph.key.toUpperCase()}`, { fontFamily: 'monospace', fontSize: '8px',
      color: i === this.idx ? '#ffe14a' : '#8a80a8', backgroundColor: '#0b0a18cc', padding: { x: 3, y: 1 } }));
    this.msg = this.msg && this.msg.text ? this.add.text(VW / 2, 120, this.msg.text, this.msgStyle()) : this.add.text(VW / 2, 120, '', this.msgStyle());
    this.msg.setOrigin(0.5);
    this.vineT = (h.floorVine || h.drones) ? this.add.text(150, 42, '', { fontFamily: 'monospace', fontSize: '8px', color: '#7dff6a' }) : null;   // K special cooldown
    const buffs = (h.partyBuffs || []).map(b => this.add.text(6 + this.party.length * 70, 60, `${b.name.toUpperCase()} +${Math.round(b.atkPct * 100)}% ATK`,
      { fontFamily: 'monospace', fontSize: '8px', color: '#ffb46a', backgroundColor: '#0b0a18cc', padding: { x: 3, y: 1 } }));
    this.hud.add([g, por, name, this.subT, this.hpG, this.hpT, ...strip, ...buffs, this.msg, ...(this.vineT ? [this.vineT] : [])]);
    this.hpShown = this.st.hp;
  }
  msgStyle() { return { fontFamily: 'monospace', fontSize: '16px', color: '#ffffff', align: 'center', stroke: '#1a0f2a', strokeThickness: 4 }; }
  drawHud(dt) {
    const st = this.st, h = this.hero, w = 128, x = 58, y = 32;
    this.hpShown += (st.hp - this.hpShown) * Math.min(1, dt * 4);
    const g = this.hpG; g.clear();
    g.fillStyle(0x1a1028).fillRect(x - 1, y - 1, w + 2, 10);
    g.fillStyle(0xffffff).fillRect(x, y, w * Math.max(0, this.hpShown) / st.maxHp, 8);         // trailing damage
    const f = Math.max(0, st.hp) / st.maxHp, col = f > 0.5 ? 0x58e070 : f > 0.25 ? 0xffd23f : 0xff3a6e;
    g.fillStyle(col).fillRect(x, y, w * f, 8);
    g.fillStyle(0xffffff, 0.35).fillRect(x, y, w * f, 2);
    this.hpT.setText(`HP ${Math.max(0, Math.ceil(st.hp))}/${st.maxHp}`);
    this.subT.setText(`${h.faction} · ATK ${h.stats.atk}${h.stats.atk > h.stats.baseAtk ? '+' : ''} · CRIT ${Math.round(this.critChance() * 100)}%`);
    if (this.vineT && h.drones) { const cd = st.droneCd || 0, up = this.drones.length;
      this.vineT.setText(up ? `DRONES ${Math.max(0, this.drones[0].t).toFixed(1)}s` : cd > 0 ? `K DRONES ${cd.toFixed(1)}s` : 'K DRONES READY').setColor(up ? '#ffb46a' : cd > 0 ? '#7a6a5a' : '#9dff7a'); }
    else if (this.vineT) { const cd = st.vineCd; this.vineT.setText(cd > 0 ? `K VINE ${cd.toFixed(1)}s` : 'K VINE READY').setColor(cd > 0 ? '#5f7f5a' : '#7dff6a'); }
  }

  // ---------------- combat ----------------
  onAttackFrame(i) {
    const an = this.hero.sprite.meta.animations.attack, active = an.activeFrames || [6, 7];
    if (!active.includes(i)) return;
    const p = this.player, A = this.hero.attack, st = this.st;
    if (an.hitPerActiveFrame) st.hitSet = new Set();   // multi-hit combo: each active frame can hit once
    const x0 = st.facing > 0 ? p.x - 6 : p.x - A.reach, rect = new Phaser.Geom.Rectangle(x0, p.y - A.height, A.reach + 6, A.height + 4);
    this.enemies.getChildren().forEach(e => {
      if (!e.active || e.dying || st.hitSet.has(e)) return;
      if (Phaser.Geom.Intersects.RectangleToRectangle(rect, e.getBounds())) { st.hitSet.add(e); this.damageEnemy(e); }
    });
  }
  damageEnemy(e, o = {}) {
    if (!e.active || e.dying) return;
    const s = this.hero.stats, crit = Math.random() < this.critChance();
    const dmg = Math.round(s.atk * s.baseDmgPct * (o.mult || 1) * (crit ? s.critDmg : 1) * Phaser.Math.FloatBetween(0.9, 1.1));
    if (this.hero.momentum) this.st.momentum++;
    e.hp -= dmg; e.stun = o.stun ?? 0.25;
    const kb = o.knockback ?? this.hero.attack.knockback, dir = o.dir || this.st.facing;
    e.setVelocityX(dir * kb); if (e.kind === 'oni' && !o.ranged) e.setVelocityY(-120);
    if (e.kind === 'hydra' && o.quiet) { e.setTintFill(0xd8ffd0); this.time.delayedCall(50, () => e.active && e.clearTint()); }   // drone laser: no flinch
    else if (e.kind === 'hydra') {   // flinch: interrupts a burst, the next one comes after a short reset
      if (e.shooting) { e.shooting = false; e.cd = Math.max(e.cd, 0.7); }
      e.play(`${e.pre}:hurt`, true); e.hurtT = 0.5;
    } else { e.anims.pause(); e.setFrame(2); }
    if (this.hero.burn) this.addBurn(e, crit ? 2 : 1);   // Mark VII: Burn on every hit, +1 stack on crit
    if (this.hero.poison && (o.poison || (!o.noToxicRoll && Math.random() < this.hero.poison.chance))) this.addPoison(e);   // Poison Ivy: Toxic
    const cy = this.cy(e);
    this.popText(e.x, cy - 26, (crit ? '⚡' : '') + dmg, crit ? '#ffe14a' : '#ffffff', crit ? 14 : 11);
    this.sparks(e.x, cy - 8, this.hero.ui?.spark ?? (crit ? 0x7ff0ff : 0xffffff), crit ? 10 : 6);
    if (!o.quiet) {   // drone lasers don't shake / freeze the screen
      this.cameras.main.shake(o.ranged ? 40 : 60, crit ? 0.005 : o.ranged ? 0.0015 : 0.003);
      this.hitstop(crit ? (o.ranged ? 40 : 70) : this.hero.attack?.hitstopMs ?? 45);
    }
    if (e.hp <= 0) this.killEnemy(e);
  }
  cy(e) { return e.body ? e.body.center.y : e.y; }   // enemy body centre (Hydra sprites are anchored at the feet)
  top(e) { return e.kind === 'hydra' ? e.y - this.E.sprite.body.height * e.scaleY : e.y - e.displayHeight / 2; }
  castSpecial() { if (this.hero.floorVine) this.castVine(); else if (this.hero.drones) this.deployDrones(); }
  // ---- Poison Ivy: Thorn Eruption (K / X) — a thorny vine bursts from the floor under the nearest enemy in range ----
  groundAt(x) {   // nearest x with floor under it (the stage has two pits)
    const gaps = [[1100, 1180], [2080, 2170]];
    for (const [a, b] of gaps) if (x > a - 14 && x < b + 14) return x - a < b - x ? a - 14 : b + 14;
    return Phaser.Math.Clamp(x, 20, WORLD_W - 20);
  }
  castVine() {
    const h = this.hero, V = h.floorVine, st = this.st, p = this.player;
    if (!V || st.dead || st.won || st.special || st.vineCd > 0) return;
    let best = null, bd = V.rangePx;
    this.enemies.getChildren().forEach(e => { if (!e.active || !e.body || e.dying) return; const d = Math.abs(e.x - p.x); if (d <= bd && Math.abs(e.y - p.y) < 220) { bd = d; best = e; } });
    if (best) { st.facing = best.x < p.x ? -1 : 1; p.setFlipX(st.facing < 0); }
    const dir = st.facing, x = this.groundAt(best ? best.x : p.x + dir * V.fallbackPx), y = GROUND_Y;
    st.vineCd = V.cooldownMs / 1000; this.vineCasts = (this.vineCasts || 0) + 1;
    this.sparks(p.x + dir * 20, p.y - 90, h.ui?.spark ?? 0x91fd68, 6);   // a flick of the raised hand
    // telegraph: green spores + cracking soil, the mound fades in, then the vine erupts
    for (let i = 0; i < 8; i++) this.time.delayedCall(i * 18, () => this.sparks(x + Phaser.Math.Between(-14, 14), y - 2, i % 2 ? 0x5cff3a : 0x6b4a2a, 2));
    const A = V.meta.animations.floor_vine, vs = this.add.sprite(x, y + 1, `${h.key}_floorvine`, 0)
      .setOrigin(V.meta.anchor.x, (V.meta.anchor.footRow + 1) / V.meta.frameHeight).setScale(V.scale).setDepth(4.5).setFlipX(dir < 0).setAlpha(0);
    this.vines = this.vines || []; this.vines.push(vs);
    vs.hit = new Set(); vs.caster = h; vs.dir = dir;
    this.tweens.add({ targets: vs, alpha: 1, duration: V.telegraphMs, onComplete: () => {
      if (!vs.active) return;
      vs.play(`${h.key}:floorvine`); this.cameras.main.shake(90, 0.004);
    } });
    vs.on('animationupdate', (a, f) => { const i = f.index - 1; if (A.activeFrames.includes(i)) this.vineHit(vs, i); });
    vs.on('animationcomplete', () => this.tweens.add({ targets: vs, alpha: 0, duration: 180, onComplete: () => { vs.destroy(); this.vines = this.vines.filter(v => v !== vs); } }));
  }
  vineHit(vs, i) {
    const V = vs.caster.floorVine, A = V.meta.animations.floor_vine, sc = V.scale;
    const top = GROUND_Y - A.heightPx[i] * sc, reach = Math.max(V.widthPx / 2, A.reachPx[i] * sc);
    const x0 = vs.dir > 0 ? vs.x - V.widthPx / 2 : vs.x - reach, rect = new Phaser.Geom.Rectangle(x0, top, V.widthPx / 2 + reach, GROUND_Y - top);
    this.enemies.getChildren().forEach(e => {
      if (!e.active || !e.body || e.dying || vs.hit.has(e)) return;
      if (!Phaser.Geom.Intersects.RectangleToRectangle(rect, e.getBounds())) return;
      vs.hit.add(e); this.vineHits = (this.vineHits || 0) + 1;
      const cur = this.hero; this.hero = vs.caster;   // a vine cast before a tag-swap still uses Ivy's stats + Toxic
      try { this.damageEnemy(e, { mult: V.damagePct, knockback: V.knockback, dir: vs.dir, stun: V.stun, poison: V.guaranteedPoison, noToxicRoll: true }); }
      finally { this.hero = cur; }
      if (e.active && e.body && (e.kind === 'oni' || e.kind === 'hydra')) e.setVelocityY(-260);   // tossed up by the eruption
    });
  }
  // ---- ranged: repulsor bolts + Burn DoT ----
  fireBolt() {
    const h = this.hero, p = this.player, st = this.st, R = h.ranged, m = (st.hand && h.sprite.muzzleAlt) || h.sprite.muzzle, f = st.facing;
    const x = p.x + f * m.x, y = p.y + m.y;
    const b = this.bolts.create(x, y, `${h.key}_bolt`, 0).setScale(0.5).setDepth(7).setFlipX(f < 0).play(`${h.key}:bolt`);
    // light aim assist: the palm sits at head height, so bolts bend toward the nearest enemy in a forward cone (±R.aimDeg)
    let ang = f > 0 ? 0 : Math.PI, best = 1e9;
    this.enemies.getChildren().forEach(e => {
      if (!e.active || e.dying) return;
      const ex = e.x - x, ey = e.body.center.y - y, d = Math.hypot(ex, ey);
      if (ex * f <= 10 || d > R.rangePx || d >= best) return;
      const a = Math.atan2(ey, ex * f); if (Math.abs(a) > Phaser.Math.DegToRad(R.aimDeg)) return;
      best = d; ang = f > 0 ? a : Math.PI - a;
    });
    b.setRotation(f > 0 ? ang : ang - Math.PI);
    b.body.setSize(14, 14).setOffset(f > 0 ? 38 : 4, 5);   // round head hitbox (body doesn't rotate)
    b.setVelocity(Math.cos(ang) * R.speed + p.body.velocity.x * 0.3, Math.sin(ang) * R.speed); b.startX = x; b.startY = y; b.dir = f; b.hero = h;
    st.fireCd = R.cooldownMs / 1000; st.shots = (st.shots || 0) + 1;
    const fl = this.add.sprite(x, y, `${h.key}_bolthit`, 0).setScale(0.35).setDepth(7).play(`${h.key}:bolthit`);   // muzzle flash
    fl.once('animationcomplete', () => fl.destroy());
    p.setVelocityX(p.body.velocity.x - f * 25);   // tiny recoil
  }
  boltPop(b) {
    if (!b.active) return;
    const fx = this.add.sprite(b.x, b.y, `${b.hero.key}_bolthit`, 0).setScale(0.5).setDepth(8).play(`${b.hero.key}:bolthit`);
    fx.once('animationcomplete', () => fx.destroy());
    b.destroy();
  }
  boltHit(b, e) {
    if (!b.active || b.dying || !e.active || b.hero !== this.hero) { if (b.active && b.hero !== this.hero) this.boltPop(b); return; }
    const R = this.hero.ranged;
    this.boltPop(b);
    this.damageEnemy(e, { mult: R.damagePct, knockback: R.knockback, stun: 0.12, dir: b.dir, ranged: true });
  }
  addBurn(e, n) {
    const B = this.hero.burn;
    if (!e.burn) {
      e.burn = { stacks: 0, t: 0, tick: B.tickMs / 1000, B, atk: this.hero.stats.atk };
      e.flame = this.add.sprite(e.x, e.y, 'burn', 0).setScale(0.75).setDepth(6).play('burn');
    }
    e.burn.stacks = Math.min(B.maxStacks, e.burn.stacks + n); e.burn.t = B.durationMs / 1000;
    this.popText(e.x + 14, this.cy(e) - 40, `BURN x${e.burn.stacks}`, '#ff9a3c', 8);
  }
  updateBurn(e, dt) {
    const u = e.burn; if (!u) return;
    u.t -= dt; u.tick -= dt;
    e.flame.setPosition(e.x + Math.sin(this.time.now / 90) * 2, this.top(e) + 2).setScale(0.6 + 0.08 * u.stacks);
    if (Math.random() < dt * (4 + u.stacks * 3)) {   // embers
      const s = this.add.image(e.x + Phaser.Math.Between(-10, 10), this.cy(e) + Phaser.Math.Between(-12, 8), 'px').setTint(Math.random() < 0.5 ? 0xff8a1e : 0xffd23f).setDepth(6);
      this.tweens.add({ targets: s, y: s.y - 16 - Math.random() * 10, alpha: 0, duration: 420, onComplete: () => s.destroy() });
    }
    if (u.tick <= 0) {
      u.tick += u.B.tickMs / 1000;
      const d = Math.max(1, Math.round(u.atk * u.B.pctAtkPerTick * u.stacks));
      e.hp -= d; e.setTintFill(0xff8a3c); this.time.delayedCall(60, () => e.active && e.clearTint());
      this.popText(e.x + Phaser.Math.Between(-8, 8), this.cy(e) - 18, '' + d, '#ff8a3c', 9);
      if (e.hp <= 0) { this.killEnemy(e); return; }
    }
    if (u.t <= 0) this.clearBurn(e);
  }
  clearBurn(e) { if (e.flame) e.flame.destroy(); e.burn = null; e.flame = null; }
  // ---- Toxic: Poison stacks (uncapped, no expiry) tick % of the enemy's max HP; the DoT keeps running after Ivy tags out ----
  addPoison(e) {
    const P = this.hero.poison;
    if (!e.poison) e.poison = { stacks: 0, tick: P.tickMs / 1000, P, pips: this.add.graphics().setDepth(6) };
    e.poison.stacks++;
    this.popText(e.x - 14, this.cy(e) - 40, `POISON x${e.poison.stacks}`, '#7dff6a', 8);
    for (let i = 0; i < 6; i++) this.bubble(e, 1);   // splash of spores on application
  }
  bubble(e, burst) {
    const b = this.add.image(e.x + Phaser.Math.Between(-11, 11), this.cy(e) + Phaser.Math.Between(-10, 10), Math.random() < 0.6 ? 'pbubble' : 'pbubble_s')
      .setDepth(6).setTint(Math.random() < 0.5 ? 0xffffff : 0xb8ff7a);
    this.tweens.add({ targets: b, y: b.y - (burst ? 14 : 18) - Math.random() * 12, x: b.x + Phaser.Math.Between(-4, 4), alpha: 0,
      duration: burst ? 380 : 700, ease: 'Sine.easeOut', onComplete: () => b.destroy() });
  }
  updatePoison(e, dt) {
    const u = e.poison; if (!u) return;
    u.tick -= dt;
    if (Math.random() < dt * (3 + Math.min(u.stacks, u.P.visualCap) * 2)) this.bubble(e, 0);   // rising toxic bubbles, denser with more stacks
    // stack pips under the HP bar (capped visually), xN when there are more
    const g = u.pips, n = Math.min(u.stacks, u.P.visualCap), y = this.top(e) - 11, x0 = e.x - n * 2;
    g.clear(); g.fillStyle(0x0d2a0a);
    for (let i = 0; i < n; i++) g.fillRect(x0 + i * 4 - 1, y - 1, 4, 4);
    g.fillStyle(0x6cf04a); for (let i = 0; i < n; i++) g.fillRect(x0 + i * 4, y, 2, 2);
    if (u.stacks > u.P.visualCap) { if (!u.lbl) u.lbl = this.add.text(0, 0, '', { fontFamily: 'monospace', fontSize: '7px', color: '#9dff7a', stroke: '#0d2a0a', strokeThickness: 2 }).setOrigin(0, 0.5).setDepth(6);
      u.lbl.setText('x' + u.stacks).setPosition(x0 + n * 4 + 1, y + 1); }
    if (u.tick <= 0) {
      u.tick += u.P.tickMs / 1000;
      const d = Math.max(1, Math.round(e.maxHp * u.P.pctMaxHpPerTick * u.stacks));
      e.hp -= d; e.setTintFill(0x5cff3a); this.time.delayedCall(70, () => e.active && e.clearTint());
      this.popText(e.x + Phaser.Math.Between(-8, 8), this.cy(e) - 10, '' + d, '#5cff3a', 9);
      for (let i = 0; i < 4; i++) this.bubble(e, 1);
      this.poisonTicks = (this.poisonTicks || 0) + 1; this.poisonDmg = (this.poisonDmg || 0) + d;
      if (e.hp <= 0) { this.killEnemy(e); return; }
    }
  }
  clearPoison(e) { if (e.poison) { e.poison.pips.destroy(); if (e.poison.lbl) e.poison.lbl.destroy(); } e.poison = null; }
  thrusterFx(dt, flying) {
    const h = this.hero, p = this.player, st = this.st, f = st.facing;
    st.jetT = (st.jetT || 0) - dt; if (st.jetT > 0) return;
    const boost = st.boost; st.jetT = boost ? 0.016 : flying ? 0.03 : 0.06;
    const pts = flying ? h.sprite.jets.fly : h.sprite.jets.idle;
    for (const [jx, jy] of pts) {
      const x = p.x + f * jx, y = p.y + jy;
      const s = this.add.image(x + Phaser.Math.Between(-1, 1), y, 'px').setTint(Math.random() < 0.4 ? 0xffffff : Math.random() < 0.6 ? 0x9fe6ff : 0x4a9cf6)
        .setDepth(4).setScale(boost ? 2 : 1.4);
      const vx = flying ? -f * (40 + Math.random() * 40) : Phaser.Math.Between(-6, 6), vy = flying ? 20 + Math.random() * 20 : 30 + Math.random() * 30;
      this.tweens.add({ targets: s, x: x + vx * 0.35 - p.body.velocity.x * 0.12, y: y + vy * 0.35, alpha: 0, scale: 0.5, duration: 260 + Math.random() * 140, onComplete: () => s.destroy() });
    }
    if (boost && Math.random() < 0.5) this.ghost(0x7fd8ff, 0.35, 160);
  }

  killEnemy(e) {
    this.clearBurn(e); this.clearPoison(e);
    this.sparks(e.x, this.cy(e) - 8, 0xe055b0, 16);
    e.hpBar.destroy();
    this.kills = (this.kills || 0) + 1;
    if (e.kind === 'hydra') {   // death anim (own frame box), hold the last frame, then fade out
      const D = this.E.meta.animations.death;
      e.disableBody(true, false); e.dying = true; e.removeAllListeners('animationupdate');
      e.setTexture(`${e.pre}_death`, 0).setOrigin(D.anchor.x, (D.anchor.footRow + 1) / D.frameHeight).setY(GROUND_Y);
      e.play(`${e.pre}:death`); e.setFlipX(e.dir < 0);
      e.once('animationcomplete', () => this.tweens.add({ targets: e, alpha: 0, delay: 500, duration: 500, onComplete: () => e.destroy() }));
      return;
    }
    e.disableBody(true, false);
    this.tweens.add({ targets: e, alpha: 0, scaleY: 0.2, duration: 220, onComplete: () => e.destroy() });
  }
  touchEnemy(e) {
    if (!e.active || e.dying || e.stun > 0 || e.emerge > 0) return;
    this.hurtPlayer(e.atk, e.x);
  }
  hurtPlayer(dmg, srcX, kb = 1) {
    const st = this.st; if (st.invuln > 0 || st.dead || st.special || st.won) return false;
    st.hp -= dmg; st.invuln = 1.0; st.hurtT = 0.32; st.attacking = false; this.player.setFlipX(st.facing < 0);
    const d = this.player.x < srcX ? -1 : 1;
    this.player.setVelocity(d * 200 * kb, this.hero.flight ? -60 * kb : -220 * kb);
    this.player.anims.play(this.A('hurt'), true);
    this.cameras.main.shake(90, 0.008); this.cameras.main.flash(80, 120, 20, 40);
    this.popText(this.player.x, this.player.y - 160, '-' + dmg, '#ff6a8a', 12);
    this.dmgTaken = (this.dmgTaken || 0) + dmg;
    if (st.hp <= 0) this.die();
    return true;
  }
  // ---- Hydra rifle: 3-round burst, each bolt aimed at the hero's body at the moment it fires (±aimDeg), so moving / jumping / flying dodges ----
  enemyFire(e) {
    const T = e.T, mz = this.E.meta.animations.attack.muzzle, sc = this.E.sprite.scale, f = e.dir;
    const x = e.x + f * mz.x * sc, y = e.y + mz.y * sc, p = this.player;
    const tx = p.x, ty = p.body.center.y;
    let a = Math.atan2(ty - y, (tx - x) * f);
    a = Phaser.Math.Clamp(a, -Phaser.Math.DegToRad(T.aimDeg), Phaser.Math.DegToRad(T.aimDeg));
    const ang = f > 0 ? a : Math.PI - a;
    const b = this.ebolts.create(x, y, 'hydra_bolt', 0).setScale(0.5).setDepth(7).play('hydra:bolt');
    b.setRotation(ang); b.body.setSize(12, 10).setOffset(26, 3);
    if (f < 0) b.body.setOffset(2, 3);
    b.setVelocity(Math.cos(ang) * T.boltSpeed, Math.sin(ang) * T.boltSpeed);
    Object.assign(b, { dmg: T.boltDmg, startX: x, startY: y, range: T.boltRange, src: e });
    const fl = this.add.sprite(x + f * 4, y, 'hydra_flash', 0).setScale(0.5).setDepth(7).play('hydra:flash');
    fl.once('animationcomplete', () => fl.destroy());
    this.enemyShots = (this.enemyShots || 0) + 1;
  }
  enemyBoltPop(b) {
    if (!b.active) return;
    const fx = this.add.sprite(b.x, b.y, 'hydra_flash', 1).setScale(0.4).setDepth(8).play('hydra:flash');
    fx.once('animationcomplete', () => fx.destroy());
    b.destroy();
  }
  enemyBoltHit(b) {
    if (!b.active || b.dying) return;
    const st = this.st; if (st.dead || st.special || st.won) return;
    if (st.invuln > 0) return;   // i-frames: bolts pass through
    const dmg = b.dmg, srcX = b.x - b.body.velocity.x;
    this.enemyBoltPop(b); this.boltHits = (this.boltHits || 0) + 1;
    this.hurtPlayer(dmg, srcX, 0.6);
  }
  // ---- Robot: Drone Support (K / X) — 2 drones hover beside the active hero and laser the nearest enemy ----
  deployDrones() {
    const h = this.hero, D = h.drones, st = this.st, p = this.player;
    if (!D || st.dead || st.won || st.special || (st.droneCd || 0) > 0) return;
    st.droneCd = D.cooldownMs / 1000; this.droneCasts = (this.droneCasts || 0) + 1;
    this.drones.forEach(d => d.destroy()); this.drones = [];
    for (let i = 0; i < D.count; i++) {
      const side = i % 2 ? -1 : 1;
      const d = this.add.sprite(p.x, p.y - 120, `${h.key}_drone`, 0).setScale(1).setDepth(6).play(`${h.key}:drone`);
      Object.assign(d, { caster: h, side, t: D.durationMs / 1000, fireT: 0.25 + i * D.fireMs / 2000, ph: i * Math.PI });
      this.tweens.add({ targets: d, x: p.x + side * D.offsetX, y: p.y + D.offsetY, duration: 260, ease: 'Back.easeOut' });
      this.sparks(p.x, p.y - 120, 0xff9a3c, 6);
      this.drones.push(d);
    }
    this.popText(p.x, p.y - 170, 'DRONES DEPLOYED', '#9dff7a', 9);
  }
  updateDrones(dt) {
    if (!this.drones.length) return;
    const p = this.player, now = this.time.now / 1000;
    this.drones = this.drones.filter(d => {
      const D = d.caster.drones;
      d.t -= dt;
      if (d.t <= 0 || this.st.won) {
        this.sparks(d.x, d.y, 0xff9a3c, 5);
        this.tweens.add({ targets: d, y: d.y - 30, alpha: 0, duration: 260, onComplete: () => d.destroy() });
        return false;
      }
      const tx = p.x + d.side * D.offsetX - this.st.facing * 6, ty = p.y + D.offsetY + Math.sin(now * 4 + d.ph) * 5;
      d.x += (tx - d.x) * Math.min(1, dt * 6); d.y += (ty - d.y) * Math.min(1, dt * 6);
      // target: nearest living enemy in range
      let best = null, bd = D.rangePx;
      this.enemies.getChildren().forEach(e => { if (!e.active || !e.body || e.dying) return; const dd = Math.hypot(e.x - d.x, this.cy(e) - d.y); if (dd < bd) { bd = dd; best = e; } });
      d.setFlipX(best ? best.x < d.x : this.st.facing < 0);
      d.fireT -= dt;
      if (best && d.fireT <= 0) {
        d.fireT = D.fireMs / 1000;
        const a = Math.atan2(this.cy(best) - d.y, best.x - d.x);
        const b = this.dbolts.create(d.x + Math.cos(a) * 8, d.y + Math.sin(a) * 8, `${d.caster.key}_dlaser`).setScale(0.5).setDepth(7).setRotation(a);
        b.body.setSize(10, 8).setOffset(7, 0);
        b.setVelocity(Math.cos(a) * D.speed, Math.sin(a) * D.speed);
        Object.assign(b, { caster: d.caster, startX: b.x, startY: b.y, range: D.rangePx + 40, dir: Math.sign(Math.cos(a)) || 1 });
        this.sparks(d.x + Math.cos(a) * 8, d.y + Math.sin(a) * 8, 0x9dff7a, 2);
      }
      return true;
    });
  }
  droneBoltHit(b, e) {
    if (!b.active || !e.active || !e.body || e.dying) return;
    const D = b.caster.drones;
    b.destroy(); this.droneHits = (this.droneHits || 0) + 1;
    const cur = this.hero; this.hero = b.caster;   // drones keep Robot's stats after a tag-swap
    try { this.damageEnemy(e, { mult: D.damagePct, knockback: D.knockback, stun: 0.05, dir: b.dir, ranged: true, quiet: true }); }
    finally { this.hero = cur; }
  }
  die() { const st = this.st; st.dead = true; this.player.setAngle(0); this.player.body.setAllowGravity(true); /* a downed flyer drops */ this.player.setTint(0x9070a0); this.msg.setText('THE RIFT CLAIMED YOU\npress R (or F for a Flashpoint)'); this.player.anims.play(this.A('hurt')); }
  hitstop(ms) { this.physics.world.pause(); this.anims.pauseAll(); this.time.delayedCall(ms, () => { this.physics.world.resume(); this.anims.resumeAll(); }); }
  popText(x, y, s, col, size) {
    const t = this.add.text(x, y, s, { fontFamily: 'monospace', fontSize: size + 'px', color: col, stroke: '#140812', strokeThickness: 3 }).setOrigin(0.5).setDepth(15);
    this.tweens.add({ targets: t, y: y - 22, alpha: 0, duration: 650, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }
  sparks(x, y, col, n) {
    for (let i = 0; i < n; i++) {
      const s = this.add.image(x, y, 'px').setTint(col).setDepth(14), a = Math.random() * Math.PI * 2, r = 10 + Math.random() * 22;
      this.tweens.add({ targets: s, x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, alpha: 0, duration: 260 + Math.random() * 160, onComplete: () => s.destroy() });
    }
  }

  // ---------------- speed FX (programmatic, so they never fight the sprite palette) ----------------
  ghost(tint, alpha, ms) {
    const p = this.player;
    const g = this.add.image(p.x, p.y, p.texture.key, p.frame.name).setOrigin(p.originX, p.originY).setScale(p.scaleX, p.scaleY)
      .setFlipX(p.flipX).setTintFill(tint).setAlpha(alpha).setDepth(4);
    this.tweens.add({ targets: g, alpha: 0, duration: ms, onComplete: () => g.destroy() });
  }
  speedFx(dt, force) {
    const fx = this.hero.fx; if (!fx || !fx.trail) return;
    const p = this.player, vx = Math.abs(p.body.velocity.x), st = this.st;
    if (!force && vx < this.hero.move.walkSpeed * 0.7) return;
    st.trailT -= dt; if (st.trailT > 0) return;
    st.trailT = force ? 0.012 : vx > this.hero.move.runSpeed * 0.8 ? 0.03 : 0.055;
    this.ghost(Math.random() < 0.5 ? 0xffd23f : 0xff8a1e, force ? 0.6 : 0.42, force ? 160 : 200);
    const back = -Math.sign(p.body.velocity.x || st.facing);
    for (let i = 0; i < (force ? 3 : 2); i++) {   // speed lines
      const y = p.y - 10 - Math.random() * 130, len = 18 + Math.random() * 40, x = p.x + back * (12 + Math.random() * 30);
      const l = this.add.rectangle(x, Math.round(y), len, 1, Math.random() < 0.6 ? 0xfff2a0 : 0xffffff).setOrigin(back > 0 ? 0 : 1, 0.5).setDepth(4).setAlpha(0.9);
      this.tweens.add({ targets: l, x: x + back * 40, alpha: 0, scaleX: 0.3, duration: 180, onComplete: () => l.destroy() });
    }
    if (Math.random() < (force ? 0.6 : 0.3)) {   // lightning zig-zag behind him
      const g = this.add.graphics().setDepth(4); g.lineStyle(1, 0xffe14a, 1);
      let x = p.x + back * 8, y = p.y - 40 - Math.random() * 80; g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 5; k++) { x += back * (8 + Math.random() * 10); y += (Math.random() - 0.5) * 14; g.lineTo(Math.round(x), Math.round(y)); }
      g.strokePath();
      this.tweens.add({ targets: g, alpha: 0, duration: 140, onComplete: () => g.destroy() });
    }
  }

  // ---------------- Flashpoint (rebirth prototype) ----------------
  flashpoint() {
    const st = this.st, p = this.player, h = this.hero;
    if (st.special || st.won) return;
    st.special = true; st.attacking = false; st.hurtT = 0; this.msg.setText('');
    if (st.dead) { st.dead = false; p.clearTint(); }
    p.setAlpha(1).setVelocity(0, 0); p.setFlipX(st.facing < 0);
    const dir = st.facing, portalX = p.x + dir * 190, portalY = h.flight ? Math.min(GROUND_Y - 66, p.y - 66) : GROUND_Y - 66;
    p.setAngle(0); if (h.flight) p.y = Math.min(p.y, portalY + 66);
    const portal = this.add.sprite(portalX, portalY, 'tportal', 0).setScale(0).setDepth(6).play('tportal');
    portal.setFlipX(dir < 0);
    const an = h.sprite.meta.animations.special;
    const charge = an ? an.durationsMs.reduce((a, b) => a + b, 0) : 500;
    if (an) p.anims.play(this.A('special'), true); else p.anims.play(this.A('idle'), true);
    this.tweens.add({ targets: portal, scale: 1.5, duration: Math.min(700, charge * 0.6), delay: charge * 0.35, ease: 'Back.easeOut' });
    const crackle = this.time.addEvent({ delay: 70, loop: true, callback: () => this.sparks(p.x + Phaser.Math.Between(-30, 30), p.y - Phaser.Math.Between(10, 120), 0xffe14a, 3) });
    this.time.delayedCall(charge, () => {
      crackle.remove();
      p.body.setAllowGravity(false); p.anims.play(this.A('run'), true); p.anims.timeScale = 1.5;
      this.dashFx = true;
      this.tweens.add({ targets: p, x: portalX, duration: 260, ease: 'Quad.easeIn', onComplete: () => {
        this.dashFx = false;
        this.tweens.add({ targets: p, scaleX: 0.02, alpha: 0, duration: 120 });
        this.tweens.add({ targets: portal, scale: 2.1, duration: 220, yoyo: true });
        this.sparks(portalX, portalY, 0xffffff, 18); this.sparks(portalX, portalY, 0xff3a2e, 12);
        this.cameras.main.flash(260, 255, 236, 170);
        this.time.delayedCall(380, () => {
          this.cameras.main.fadeOut(520, 255, 200, 120);
          this.cameras.main.once('camerafadeoutcomplete', () => this.scene.restart({ party: this.party, idx: this.idx, rebirths: this.rebirths + 1 }));
        });
      } });
    });
  }

  // ---------------- update ----------------
  update(time, deltaMs) {
    const dt = Math.min(deltaMs, 50) / 1000, p = this.player, st = this.st, K = this.keys, h = this.hero;
    const cam = this.cameras.main;
    this.par.forEach(l => l.s.tilePositionX = cam.scrollX * l.f);
    this.drawHud(dt);
    if (Phaser.Input.Keyboard.JustDown(K.R)) { this.scene.restart({ party: this.party, idx: this.idx }); return; }
    this.updateEnemies(dt); this.updateDrones(dt); this.updateStructures(dt, time);
    if (st.special) { if (this.dashFx) this.speedFx(dt, true); return; }
    if (p.y > VH + 60 && !st.dead) { st.hp = 0; this.die(); }
    if (st.dead) { p.setVelocityX(p.body.velocity.x * 0.9); return; }

    st.vineCd = Math.max(0, st.vineCd - dt); st.droneCd = Math.max(0, (st.droneCd || 0) - dt);
    st.invuln = Math.max(0, st.invuln - dt); st.hurtT = Math.max(0, st.hurtT - dt); st.swapCd = Math.max(0, st.swapCd - dt);
    p.setAlpha(st.invuln > 0 && st.hurtT <= 0 ? (Math.floor(time / 60) % 2 ? 0.35 : 1) : 1);
    const onGround = p.body.blocked.down || p.body.touching.down;
    st.coyote = onGround ? 0.09 : Math.max(0, (st.coyote || 0) - dt); // late-jump grace after leaving a ledge
    const left = K.LEFT.isDown || K.A.isDown, right = K.RIGHT.isDown || K.D.isDown;
    this.buf.jump = Math.max(0, this.buf.jump - dt); this.buf.atk = Math.max(0, this.buf.atk - dt);
    const jumpPressed = this.buf.jump > 0, atkPressed = this.buf.atk > 0;
    const running = K.SHIFT.isDown;

    if (!st.won && Math.abs(p.x - this.goal.x) < 20 && (onGround || (h.flight && Math.abs(p.y - GROUND_Y) < 90))) { st.won = true; this.msg.setText('RIFT SEALED\nstage clear — press R'); this.sealGate(); }
    if (h.flight) { this.updateFlight(dt, time, left, right, atkPressed); return; }
    if (st.hurtT > 0) { this.applyFriction(onGround, dt); return; }

    const mirrorAtk = !!h.sprite.attackArtFacesLeft;   // Asagi's attack take slashes toward image-left
    if (atkPressed && !st.attacking) {
      this.buf.atk = 0; st.attacking = true; st.hitSet = new Set(); p.anims.play(this.A('attack'), true);
      p.setFlipX(mirrorAtk ? st.facing > 0 : st.facing < 0);
      if (onGround) p.setVelocityX(st.facing * 30);
    }
    let dir = (right ? 1 : 0) - (left ? 1 : 0);
    if (st.attacking && onGround) dir = 0;
    const speed = running ? h.move.runSpeed : h.move.walkSpeed;
    if (dir) {
      if (!st.attacking) st.facing = dir;
      const target = dir * speed, ctl = onGround ? 1 : h.move.airControl;
      p.setVelocityX(Phaser.Math.Linear(p.body.velocity.x, target, Math.min(1, dt * (h.move.accel || 14) * ctl)));
    } else this.applyFriction(onGround, dt);
    p.setFlipX(st.attacking && mirrorAtk ? st.facing > 0 : st.facing < 0);
    this.speedFx(dt, false);

    if (jumpPressed && st.coyote > 0 && st.jumpT <= 0 && !st.attacking) { st.jumpT = 0.06; st.coyote = 0; this.buf.jump = 0; }
    if (st.jumpT > 0) { st.jumpT -= dt; if (st.jumpT <= 0) p.setVelocityY(-h.move.jumpVelocity); }
    if (!onGround && p.body.velocity.y < -180 && st.jumpT <= 0 && !(K.SPACE.isDown || K.UP.isDown || K.W.isDown)) p.setVelocityY(-180);
    if (onGround && !st.wasGround) st.landT = 0.08;
    st.wasGround = onGround; st.landT = Math.max(0, st.landT - dt);

    if (st.attacking) return;
    // jump: placeholder frames (0 = stride/rise, 1 = stand/fall) until a jump video exists
    const jt = `${h.key}_jump`;
    if (st.jumpT > 0 || st.landT > 0) { p.anims.stop(); p.setTexture(jt, 1); return; }
    if (!onGround) { p.anims.stop(); p.setTexture(jt, p.body.velocity.y < 60 ? 0 : 1); return; }
    const vx = Math.abs(p.body.velocity.x);
    if (vx > (h.move.walkSpeed + h.move.runSpeed) / 2 - 5) this.playLoop('run', vx / h.move.runSpeed);
    else if (vx > 12) this.playLoop('walk', vx / h.move.walkSpeed);
    else this.playLoop('idle', 1);
  }
  // ---- flying hero: no gravity, 8-way accel/drag, idle bob, hold-to-fire repulsors ----
  updateFlight(dt, time, left, right, atkPressed) {
    const p = this.player, st = this.st, K = this.keys, h = this.hero, F = h.flight, R = h.ranged;
    const up = K.UP.isDown || K.W.isDown, down = K.DOWN.isDown || K.S.isDown;
    st.fireCd = Math.max(0, (st.fireCd || 0) - dt); st.raisedT = Math.max(0, (st.raisedT || 0) - dt);
    if (st.hurtT > 0) { p.setVelocity(p.body.velocity.x * (1 - dt * 3), p.body.velocity.y * (1 - dt * 3)); p.setAngle(0); return; }
    let dx = (right ? 1 : 0) - (left ? 1 : 0), dy = (down ? 1 : 0) - (up ? 1 : 0);
    if (dx && !st.attacking && st.raisedT <= 0) st.facing = dx;
    st.boost = (K.SPACE.isDown || K.SHIFT.isDown) && (dx || dy) && !st.attacking;
    const n = Math.hypot(dx, dy) || 1, sp = st.boost ? F.boostSpeed : F.speed * (st.attacking ? 0.75 : 1);
    const bob = (dy === 0) ? Math.cos(time / 1000 * Math.PI * 2 * F.bobHz) * F.bobPx * Math.PI * 2 * F.bobHz : 0;   // gentle hover bob
    const tx = dx / n * sp, ty = dy / n * sp + bob;
    const kx = dx ? F.accel : F.drag, ky = dy ? F.accel : F.drag;
    p.setVelocity(Phaser.Math.Linear(p.body.velocity.x, tx, Math.min(1, dt * kx)), Phaser.Math.Linear(p.body.velocity.y, ty, Math.min(1, dt * ky)));
    // stay inside the level: ceiling, side walls, never below the bottom of a pit
    if (p.y < F.ceilingY) { p.y = F.ceilingY; if (p.body.velocity.y < 0) p.setVelocityY(0); }
    if (p.y > VH - 4) { p.y = VH - 4; if (p.body.velocity.y > 0) p.setVelocityY(0); }
    p.x = Phaser.Math.Clamp(p.x, 24, WORLD_W - 24);
    // fire: tap or hold J/Z
    const held = K.J.isDown || K.Z.isDown;
    if ((atkPressed || held) && !st.attacking && st.fireCd <= 0.12) {
      this.buf.atk = 0; st.attacking = true; st.lowering = false;
      if (h.sprite.meta.animations.attack_alt) {
        // alternate hands every shot; if the other arm is still raised, skip the rest-pose frames of the new hand's raise
        const raised = st.raisedT > 0; st.hand = st.hand ? 0 : 1;
        p.anims.play({ key: this.RA('attack'), startFrame: raised ? 3 : 0 }, true);
      } else p.anims.play(this.A(st.raisedT > 0 ? 'shoot' : 'attack'), true);
    }
    p.setFlipX(st.facing < 0);
    const vx = p.body.velocity.x, vy = p.body.velocity.y, flying = Math.abs(vx) > 70 && !st.attacking && st.raisedT <= 0 && !st.lowering;
    const tilt = Phaser.Math.Clamp(vy / F.speed, -1, 1) * F.maxTiltDeg * st.facing * (flying ? 1 : 0.5);
    p.setAngle(Phaser.Math.Linear(p.angle, tilt, Math.min(1, dt * 8)));
    this.thrusterFx(dt, flying);
    if (st.attacking || st.raisedT > 0) return;
    if (!st.lowering && p.anims.currentAnim && this.isFireAnim(p.anims.currentAnim.key)) {
      st.lowering = true; p.anims.play(this.RA('lower'), true); return;
    }
    if (st.lowering && !flying) return;
    st.lowering = false;
    if (flying) this.playLoop('fly', 1); else this.playLoop('idle', 1);
  }
  playLoop(name, rate) {
    const p = this.player, key = this.A(name);
    if (p.anims.currentAnim?.key !== key || !p.anims.isPlaying) p.anims.play(key, true);
    p.anims.timeScale = Phaser.Math.Clamp(rate, 0.5, 1.5);
  }
  applyFriction(onGround, dt) { const p = this.player; p.setVelocityX(p.body.velocity.x * (onGround ? Math.max(0, 1 - dt * 14) : 1 - dt * 2)); }

  // Hydra AI: patrol -> (hero within aggro) march in -> hold a 250-300 px standoff -> 3-round burst -> cooldown. Never walks into a pit.
  updateHydra(e, dt) {
    const p = this.player, T = e.T, st = this.st;
    this.updateBurn(e, dt); if (!e.active || e.dying) return;
    this.updatePoison(e, dt); if (!e.active || e.dying) return;
    e.cd -= dt; e.hurtT = Math.max(0, e.hurtT - dt);
    const onGround = e.body.blocked.down || e.body.touching.down;
    const dx = p.x - e.x, adx = Math.abs(dx), alive = !st.dead && !st.special && !st.won;
    const aggro = alive && adx < T.aggroPx && p.y > GROUND_Y - 330;
    let vx = 0, anim = 'idle';
    if (e.emerge > 0 && onGround && e.stun <= 0 && e.hurtT <= 0) {   // stepping out of the spawn gate
      e.dir = -1; e.setVelocityX(-T.walkSpeed * 0.7); if (e.anims.currentAnim?.key !== `${e.pre}:walk`) e.play(`${e.pre}:walk`, true);
      e.setFlipX(true); this.drawEnemyBar(e); return;
    }
    if (e.stun > 0 || e.hurtT > 0 || !onGround) {
      e.setVelocityX(e.body.velocity.x * (onGround ? 0.85 : 0.98));
      e.setFlipX(e.dir < 0); this.drawEnemyBar(e); return;   // hurt anim / knockback plays out
    }
    if (e.shooting) { e.setVelocityX(0); e.setFlipX(e.dir < 0); this.drawEnemyBar(e); return; }
    if (aggro) {
      e.dir = dx < 0 ? -1 : 1;
      const [near, far] = T.standoffPx;
      if (adx > far) vx = e.dir * T.walkSpeed;                                     // close in
      else if (adx < near - 40 && e.cd > 0) vx = -e.dir * T.walkSpeed * 0.6;      // too close: back off while reloading
      if (adx <= far + 20 && e.cd <= 0) {                                          // in range: burst
        e.shooting = true; e.setVelocityX(0); e.play(`${e.pre}:attack`, true); e.setFlipX(e.dir < 0); this.drawEnemyBar(e); return;
      }
    } else {
      if (e.x < e.home - e.range) e.dir = 1; else if (e.x > e.home + e.range) e.dir = -1;
      vx = e.dir * T.walkSpeed * 0.6;
    }
    // ledge check: don't step into a pit or off the world
    const ahead = e.x + Math.sign(vx) * 22;
    if (vx && (this.groundAt(ahead) !== Phaser.Math.Clamp(ahead, 20, WORLD_W - 20) || e.body.blocked.left && vx < 0 || e.body.blocked.right && vx > 0)) {
      if (!aggro) e.dir = -e.dir;
      vx = 0;
    }
    e.setVelocityX(vx);
    const key = `${e.pre}:${vx ? 'walk' : 'idle'}`;
    if (e.anims.currentAnim?.key !== key || !e.anims.isPlaying) e.play(key, true);
    e.anims.timeScale = vx ? Phaser.Math.Clamp(Math.abs(vx) / T.walkSpeed, 0.5, 1.5) : 1;
    e.setFlipX(e.dir < 0);
    this.drawEnemyBar(e);
  }
  drawEnemyBar(e) {
    const g = e.hpBar; g.clear();
    if (e.hp < e.maxHp) { const w = e.kind === 'hydra' ? 32 : 24, x = e.x - w / 2, y = this.top(e) - 6;
      g.fillStyle(0x140812).fillRect(x - 1, y - 1, w + 2, 4); g.fillStyle(e.T && e.T === this.E.types.elite ? 0xff2a3a : 0xff3a6e).fillRect(x, y, w * e.hp / e.maxHp, 2); }
  }
  updateEnemies(dt) {
    const p = this.player;
    this.bolts.getChildren().slice().forEach(b => {
      if (!b.dying && (Math.hypot(b.x - b.startX, b.y - b.startY) > b.hero.ranged.rangePx || b.x < 0 || b.x > WORLD_W)) {   // fade out at max range
        b.dying = true; b.body.enable = false; this.tweens.add({ targets: b, alpha: 0, scaleX: 0.2, duration: 90, onComplete: () => b.destroy() });
      }
    });
    const fade = (b) => { b.dying = true; b.body.enable = false; this.tweens.add({ targets: b, alpha: 0, scaleX: 0.2, duration: 90, onComplete: () => b.destroy() }); };
    [this.ebolts, this.dbolts].forEach(grp => grp.getChildren().slice().forEach(b => {
      if (!b.dying && (Math.hypot(b.x - b.startX, b.y - b.startY) > b.range || b.x < 0 || b.x > WORLD_W || b.y > VH)) fade(b);
    }));
    this.enemies.getChildren().forEach(e => {
      if (!e.active || !e.body || e.dying) return;
      e.stun = Math.max(0, e.stun - dt);
      if (e.emerge > 0) { e.emerge -= dt; const k = Phaser.Math.Clamp(1 - e.emerge / e.emergeT, 0, 1); e.setAlpha(0.3 + 0.7 * k); if (e.emerge <= 0) { e.clearTint(); e.setAlpha(1); } }
      if (e.kind === 'hydra') { this.updateHydra(e, dt); return; }
      this.updateBurn(e, dt); if (!e.active || !e.body) return;
      this.updatePoison(e, dt); if (!e.active || !e.body) return;
      if (e.stun <= 0 && !e.anims.isPlaying) e.anims.resume?.() || e.play(e.kind === 'oni' ? 'oni_walk' : 'drone_fly');
      if (e.stun <= 0) {
        if (e.kind === 'oni') {
          const near = Math.abs(p.x - e.x) < 160 && Math.abs(p.y - e.y) < 80 && !this.st.dead && !this.st.special;
          if (near) e.dir = p.x < e.x ? -1 : 1;
          else if (e.x < e.home - e.range) e.dir = 1; else if (e.x > e.home + e.range) e.dir = -1;
          if (e.body.blocked.left) e.dir = 1; if (e.body.blocked.right) e.dir = -1;
          e.setVelocityX(e.dir * e.speed * (near ? 1.6 : 1));
        } else {
          e.t += dt;
          const near = Math.abs(p.x - e.x) < 180 && !this.st.dead && !this.st.special;
          const tx = near ? p.x : e.home + Math.sin(e.t * 0.8) * e.range, ty = near ? p.y - 60 + Math.sin(e.t * 3) * 18 : e.homeY + Math.sin(e.t * 2) * 10;
          e.setVelocity(Phaser.Math.Clamp((tx - e.x) * 2, -e.speed * 1.4, e.speed * 1.4), Phaser.Math.Clamp((ty - e.y) * 2, -60, 60));
          e.dir = e.body.velocity.x < 0 ? -1 : 1;
        }
      } else if (e.kind === 'drone') e.setVelocity(e.body.velocity.x * 0.9, e.body.velocity.y * 0.9);
      e.setFlipX(e.dir > 0);
      if (e.y > VH + 80) { this.clearBurn(e); this.clearPoison(e); e.hpBar.destroy(); e.destroy(); return; }
      const g = e.hpBar; g.clear();
      if (e.hp < e.maxHp) { const w = 24, x = e.x - 12, y = e.y - e.displayHeight / 2 - 6; g.fillStyle(0x140812).fillRect(x - 1, y - 1, w + 2, 4); g.fillStyle(0xff3a6e).fillRect(x, y, w * e.hp / e.maxHp, 2); }
    });
  }
}

// toxic bubbles for Poison (tiny pixel rings, generated so they always match the palette)
function makePoisonTex(scene) {
  const mk = (key, rows) => {
    if (scene.textures.exists(key)) return;
    const cv = document.createElement('canvas'); cv.width = rows[0].length; cv.height = rows.length; const ctx = cv.getContext('2d');
    const col = { o: '#1f6b14', g: '#6cf04a', w: '#e8ffd0' };
    rows.forEach((r, y) => [...r].forEach((c, x) => { if (col[c]) { ctx.fillStyle = col[c]; ctx.fillRect(x, y, 1, 1); } }));
    scene.textures.addCanvas(key, cv);
  };
  mk('pbubble', ['.ooo.', 'ogwgo', 'og.go', 'oggg.', '.ooo.'].map(r => r.replace(/\./g, ' ')));
  mk('pbubble_s', ['.o.', 'owo', '.o.'].map(r => r.replace(/\./g, ' ')));
}

// swirling yellow/red time portal, drawn per pixel (ordered dither, hard edges) so it matches the 16-bit look
function makeTimePortal(scene) {
  if (scene.textures.exists('tportal')) { if (!scene.anims.exists('tportal')) mkAnim(); return; }
  const W = 56, H = 84, N = 8, cv = document.createElement('canvas'); cv.width = W * N; cv.height = H;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(W * N, H);
  const pal = [[26, 6, 20], [70, 8, 26], [150, 16, 30], [214, 44, 34], [246, 120, 30], [255, 200, 60], [255, 244, 190]];
  const bayer = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
  for (let f = 0; f < N; f++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const nx = (x + 0.5 - W / 2) / (W / 2 - 1), ny = (y + 0.5 - H / 2) / (H / 2 - 1), r = Math.hypot(nx, ny);
    if (r > 1) continue;
    const th = Math.atan2(ny, nx), ph = f / N * Math.PI * 2;
    const sw = Math.sin(th * 3 + r * 9 - ph * 1.0) * 0.5 + 0.5;            // 3-arm spiral, rotates with ph
    let v = r < 0.22 ? 0.05 + sw * 0.4 : r > 0.9 ? 5.6 + sw : 1.2 + r * 3.2 + sw * 1.6 - 0.8;
    v += (bayer[y & 3][x & 3] / 16 - 0.5) * 0.9;
    const c = pal[Math.max(0, Math.min(pal.length - 1, Math.floor(v)))], o = (y * W * N + f * W + x) * 4;
    img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  scene.textures.addSpriteSheet('tportal', cv, { frameWidth: W, frameHeight: H });
  mkAnim();
  function mkAnim() { scene.anims.create({ key: 'tportal', frames: scene.anims.generateFrameNumbers('tportal', { start: 0, end: N - 1 }), frameRate: 14, repeat: -1 }); }
}

(async () => {
  const q = new URLSearchParams(location.search);
  let party;
  try { party = await CharacterLoader.loadParty(q.get('hero')); }
  catch (err) { document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f88;padding:16px">Failed to load hero data: ${err.message}\nServe this folder over http (python3 -m http.server), not file://</pre>`); throw err; }
  window.game = new Phaser.Game({
    type: Phaser.AUTO, parent: 'game', width: VW * ZOOM, height: VH * ZOOM, pixelArt: true, roundPixels: true, backgroundColor: '#0b0a18',
    physics: { default: 'arcade', arcade: { gravity: { y: 1100 }, debug: q.has('debug') } },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [],
  });
  window.game.scene.add('game', GameScene, true, party);
})();

// spawn gate + hero base (art: tools/make_structures.py). All textures are drawn at 0.5 like the HD heroes (1 texel = 1 screen px).
function makeStructures(scene) {
  const S = scene.cache.json.get('structures'), sc = 0.5;
  const frames = (tex, prefix, n, cols, fw, fh, ox = 0, oy = 0) => {
    const T = scene.textures.get(tex);
    for (let k = 0; k < n; k++) if (!T.has(prefix + k)) T.add(prefix + k, 0, ox + (k % cols) * fw, oy + Math.floor(k / cols) * fh, fw, fh);
    return [...Array(n).keys()].map(k => ({ key: tex, frame: prefix + k }));
  };
  // ---- hero base: static building + per-region animated patches (flags, time core, lights) from the idle video ----
  const B = S.base, BA = B.anim, bx = 170, left = bx - B.width * sc * B.anchor.x, top = GROUND_Y - B.height * sc * B.anchor.y;
  scene.add.image(bx, GROUND_Y + 1, 'st_base').setOrigin(B.anchor.x, B.anchor.y).setScale(sc).setDepth(1);
  BA.patches.forEach((P, i) => {
    const key = 'st:base_p' + i;
    if (!scene.anims.exists(key)) scene.anims.create({ key, frames: [...Array(BA.frames).keys()].map((k) => {
      const T = scene.textures.get('st_base_anim'), name = `q${i}_${k}`;
      if (!T.has(name)) T.add(name, 0, (k % BA.cols) * BA.blockW, Math.floor(k / BA.cols) * BA.blockH + P.oy, P.w, P.h);
      return { key: 'st_base_anim', frame: name };
    }), frameRate: BA.fps, repeat: -1 });
    scene.add.sprite(left + P.x * sc, top + 1 + P.y * sc, 'st_base_anim').setOrigin(0).setScale(sc).setDepth(1.01).play(key);
  });
  const cx = left + B.core[0] * sc, cy = top + 1 + B.core[1] * sc;
  const core = scene.add.image(cx, cy, makeGlowTex(scene, 'st_coreglow', 34, [255, 214, 90])).setBlendMode(Phaser.BlendModes.ADD).setDepth(1.02).setAlpha(0.25);
  scene.base = { x: bx, doorX: bx, core, coreBase: 0.22,
    flare(k) { scene.tweens.add({ targets: core, scale: { from: 1 + 0.8 * k, to: 1 }, duration: 700, ease: 'Quad.easeOut' }); this.coreBase = 0.9; scene.tweens.add({ targets: this, coreBase: 0.22, duration: 900 }); } };
  // ---- spawn gate: rift (behind) + frame + additive lamp / conduit glow ----
  const G = S.gate, R = G.rift, gx = WORLD_W - 120, gl = gx - G.width * sc * G.anchor.x, gt = GROUND_Y + 1 - G.height * sc * G.anchor.y;
  if (!scene.anims.exists('st:rift_loop')) {
    scene.anims.create({ key: 'st:rift_loop', frames: frames('st_rift_loop', 'f', R.loop.frames, R.loop.cols, R.frameWidth, R.frameHeight), frameRate: R.loop.fps, repeat: -1 });
    scene.anims.create({ key: 'st:rift_burst', frames: frames('st_rift_burst', 'f', R.burst.frames, R.burst.cols, R.frameWidth, R.frameHeight), frameRate: R.burst.fps, repeat: 0 });
  }
  const rift = scene.add.sprite(gl + (R.x + R.frameWidth / 2) * sc, gt + (R.y + R.frameHeight / 2) * sc, 'st_rift_loop').setScale(sc).setDepth(1).play('st:rift_loop');
  rift.on('animationcomplete', (a) => { if (a.key === 'st:rift_burst' && !scene.gate.sealed) rift.play('st:rift_loop'); });
  scene.add.image(gx, GROUND_Y + 1, 'st_gate').setOrigin(G.anchor.x, G.anchor.y).setScale(sc).setDepth(1.1);
  const lamps = scene.add.image(gx, GROUND_Y + 1, 'st_gate_lamps').setOrigin(G.anchor.x, G.anchor.y).setScale(sc).setDepth(1.12).setBlendMode(Phaser.BlendModes.ADD);
  const cond = scene.add.image(gx, GROUND_Y + 1, 'st_gate_cond').setOrigin(G.anchor.x, G.anchor.y).setScale(sc).setDepth(1.12).setBlendMode(Phaser.BlendModes.ADD);
  scene.gate = { x: gx, cx: gl + R.center[0] * sc, cy: gt + R.center[1] * sc, rift, lamps, cond, hotT: 0, sealed: false };
}
// round dithered pixel glow (hard alpha steps), used additively over the base's time core
function makeGlowTex(scene, key, r, [cr, cg, cb]) {
  if (scene.textures.exists(key)) return key;
  const N = r * 2, cv = scene.textures.createCanvas(key, N, N), ctx = cv.getContext(), id = ctx.createImageData(N, N);
  const BY = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const d = Math.hypot(x - r + 0.5, y - r + 0.5) / r, v = Math.max(0, 1 - d) ** 1.4;
    const lv = Math.min(3, Math.floor(v * 4 + BY[(y & 3) * 4 + (x & 3)] / 16)), i = (y * N + x) * 4;
    if (lv <= 0) continue;
    id.data[i] = cr; id.data[i + 1] = cg; id.data[i + 2] = cb; id.data[i + 3] = [0, 70, 140, 220][lv];
  }
  ctx.putImageData(id, 0, 0); cv.refresh(); return key;
}
