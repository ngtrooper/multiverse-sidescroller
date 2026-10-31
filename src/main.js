// Rift Runners — test stage. Phaser 3 (vendored), arcade physics.
// World is laid out in 640x360 "world px"; the canvas is 2x (1280x720) and the camera zooms 2x, so the
// HD hero sprites (drawn at 0.5 scale) show 1 texel = 1 screen px while the world tiles stay chunky 2x.
// Party: every roster hero is loaded; Tab / 1 / 2 / 3 tag-swaps in place. F = Flashpoint (rebirth demo).
// Flying heroes (roster.flight, e.g. Iron Man) ignore gravity and move 8-way; ranged heroes fire projectiles with Burn DoT.
const VW = 640, VH = 360, GROUND_Y = 316, WORLD_W = 3600, ZOOM = 2;
// scrollFactor-0 objects are zoomed around the screen centre; this offset pins them to the top-left
const UIX = VW * (ZOOM - 1) / 2, UIY = VH * (ZOOM - 1) / 2;

class GameScene extends Phaser.Scene {
  constructor() { super('game'); }
  init(data) {
    this.party = data.party; this.idx = data.idx || 0; this.hero = this.party[this.idx];
    this.rebirths = data.rebirths || 0; this.msg = null; this.dashFx = false;
  }
  preload() {
    for (const h of this.party) {
      const m = h.sprite.meta;
      for (const [name, a] of Object.entries(m.animations))
        if (!this.textures.exists(`${h.key}_${name}`))
          this.load.spritesheet(`${h.key}_${name}`, h.sprite.dir + a.sheet, { frameWidth: m.frameWidth, frameHeight: m.frameHeight });
      if (!this.textures.exists(`portrait_${h.key}`)) this.load.image(`portrait_${h.key}`, h.portrait);
      if (h.ranged && !this.textures.exists(`${h.key}_bolt`)) {
        this.load.spritesheet(`${h.key}_bolt`, h.sprite.dir + 'repulsor.png', { frameWidth: 56, frameHeight: 24 });
        this.load.spritesheet(`${h.key}_bolthit`, h.sprite.dir + 'repulsor_hit.png', { frameWidth: 40, frameHeight: 40 });
        if (!this.textures.exists('burn')) this.load.spritesheet('burn', h.sprite.dir + 'burn.png', { frameWidth: 16, frameHeight: 20 });
      }
    }
  }
  A(name, h = this.hero) { return `${h.key}:${name}`; }
  create() {
    Tex.all(this, VW, VH);
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

    // goal rift portal
    // Tex.all regenerates these textures on every (re)start, so their anims must be rebuilt too
    ['portal', 'oni_walk', 'drone_fly'].forEach(k => this.anims.remove(k));
    this.anims.create({ key: 'portal', frames: this.anims.generateFrameNumbers('portal', { start: 0, end: 3 }), frameRate: 8, repeat: -1 });
    this.goal = this.physics.add.staticSprite(WORLD_W - 120, GROUND_Y - 36, 'portal', 0).play('portal');

    // ---- player ----
    this.party.forEach(h => this.makeAnims(h));
    this.player = this.physics.add.sprite(120, GROUND_Y - 4, `${this.hero.key}_idle`, 0).setDepth(5);
    this.player.body.setMaxVelocity(520, 900);
    this.physics.add.collider(this.player, this.solids);
    this.physics.add.collider(this.player, this.oneway, null, () => !this.hero.flight);   // flyers pass through one-way platforms
    this.hpStore = Object.fromEntries(this.party.map(h => [h.key, h.stats.hp]));
    this.st = { hp: this.hero.stats.hp, maxHp: this.hero.stats.hp, facing: 1, attacking: false, hitSet: null, invuln: 0, hurtT: 0, jumpT: 0, landT: 0,
      wasGround: true, dead: false, won: false, special: false, swapCd: 0, momentum: 0, trailT: 0 };
    this.applyHero();
    this.player.on('animationcomplete', (a) => {
      if (a.key === this.A('attack') || a.key === this.A('shoot')) { this.st.attacking = false; if (this.hero.ranged) this.st.raisedT = this.hero.ranged.holdMs / 1000; }
      if (a.key === this.A('lower')) this.st.lowering = false;
    });
    this.player.on('animationupdate', (a, f) => {
      if (this.hero.ranged) { if ((a.key === this.A('attack') || a.key === this.A('shoot')) && f.index - 1 === this.hero.sprite.meta.animations[a.key.split(':')[1]].fireFrame) this.fireBolt(); return; }
      if (a.key === this.A('attack')) this.onAttackFrame(f.index - 1);
    });
    this.bolts = this.physics.add.group({ allowGravity: false });

    // ---- enemies ----
    this.enemies = this.physics.add.group({ allowGravity: true });
    this.anims.create({ key: 'oni_walk', frames: this.anims.generateFrameNumbers('oni', { frames: [0, 1] }), frameRate: 5, repeat: -1 });
    this.anims.create({ key: 'drone_fly', frames: this.anims.generateFrameNumbers('drone', { frames: [0, 1] }), frameRate: 10, repeat: -1 });
    [[620, 'oni'], [980, 'drone'], [1140, 'drone', 150], [1400, 'oni'], [1750, 'oni'], [1900, 'drone'], [2120, 'drone', 140], [2400, 'oni'],
     [2600, 'drone'], [2820, 'drone', 130], [3000, 'oni'], [3150, 'drone']]
      .forEach(([x, t, y]) => this.spawn(t, x, y));
    this.physics.add.collider(this.enemies, this.solids);
    this.physics.add.overlap(this.player, this.enemies, (p, e) => this.touchEnemy(e));
    this.physics.add.overlap(this.bolts, this.enemies, (b, e) => this.boltHit(b, e));
    this.physics.add.collider(this.bolts, this.solids, (b) => this.boltPop(b));

    // ---- camera / input / hud ----
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12, 0, 40).setDeadzone(60, 40);
    this.keys = this.input.keyboard.addKeys('LEFT,RIGHT,UP,DOWN,A,D,W,S,SPACE,J,Z,SHIFT,R,F,TAB,ONE,TWO,THREE');
    this.input.keyboard.addCapture('SPACE,UP,DOWN,LEFT,RIGHT,TAB');
    this.buf = { jump: 0, atk: 0 };
    const kb = this.input.keyboard;
    ['SPACE', 'UP', 'W'].forEach(k => kb.on('keydown-' + k, () => this.buf.jump = 0.12));
    ['J', 'Z'].forEach(k => kb.on('keydown-' + k, () => this.buf.atk = 0.15));
    kb.on('keydown-TAB', () => this.swapTo((this.idx + 1) % this.party.length));
    kb.on('keydown-ONE', () => this.swapTo(0));
    kb.on('keydown-TWO', () => this.swapTo(1));
    kb.on('keydown-THREE', () => this.swapTo(2));
    kb.on('keydown-F', () => this.flashpoint());
    this.makeHud();
    if (this.rebirths) {
      this.msg.setText(`FLASHPOINT #${this.rebirths}\ntimeline rewritten`);
      this.time.delayedCall(1800, () => { if (!this.st.dead && !this.st.won) this.msg.setText(''); });
      this.cameras.main.fadeIn(500, 255, 240, 200);
    }
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
    if (h.ranged) {
      const k1 = `${h.key}:bolt`, k2 = `${h.key}:bolthit`;
      if (!this.anims.exists(k1)) this.anims.create({ key: k1, frames: this.anims.generateFrameNumbers(`${h.key}_bolt`, { start: 0, end: 3 }), frameRate: 16, repeat: -1 });
      if (!this.anims.exists(k2)) this.anims.create({ key: k2, frames: this.anims.generateFrameNumbers(`${h.key}_bolthit`, { start: 0, end: 3 }), frameRate: 20, repeat: 0 });
      if (!this.anims.exists('burn')) this.anims.create({ key: 'burn', frames: this.anims.generateFrameNumbers('burn', { start: 0, end: 5 }), frameRate: 14, repeat: -1 });
    }
  }

  // put the current hero's textures / origin / hitbox on the shared player body
  applyHero() {
    const h = this.hero, m = h.sprite.meta, p = this.player, B = h.sprite.body;
    const ax = m.anchor.x, ay = (m.anchor.footRow + 1) / m.frameHeight;
    p.anims.stop(); p.setTexture(`${h.key}_idle`, 0).setOrigin(ax, ay).setScale(h.sprite.scale || 1).setAngle(0);
    p.body.setAllowGravity(!h.flight);                     // flyers hover; ground heroes fall when tagged in mid-air
    if (h.flight) p.setVelocityY(Math.min(0, p.body.velocity.y));
    Object.assign(this.st, { attacking: false, lowering: false, raisedT: 0, fireCd: 0 });
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
    if (type === 'oni') {
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
    // party strip: who is benched (Tab / 1 / 2)
    const strip = this.party.map((ph, i) => this.add.text(6 + i * 70, 60, `${i + 1} ${ph.key.toUpperCase()}`, { fontFamily: 'monospace', fontSize: '8px',
      color: i === this.idx ? '#ffe14a' : '#8a80a8', backgroundColor: '#0b0a18cc', padding: { x: 3, y: 1 } }));
    this.msg = this.msg && this.msg.text ? this.add.text(VW / 2, 120, this.msg.text, this.msgStyle()) : this.add.text(VW / 2, 120, '', this.msgStyle());
    this.msg.setOrigin(0.5);
    this.hud.add([g, por, name, this.subT, this.hpG, this.hpT, ...strip, this.msg]);
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
    this.subT.setText(`${h.faction} · ATK ${h.stats.atk} · CRIT ${Math.round(this.critChance() * 100)}%`);
  }

  // ---------------- combat ----------------
  onAttackFrame(i) {
    const an = this.hero.sprite.meta.animations.attack, active = an.activeFrames || [6, 7];
    if (!active.includes(i)) return;
    const p = this.player, A = this.hero.attack, st = this.st;
    if (an.hitPerActiveFrame) st.hitSet = new Set();   // multi-hit combo: each active frame can hit once
    const x0 = st.facing > 0 ? p.x - 6 : p.x - A.reach, rect = new Phaser.Geom.Rectangle(x0, p.y - A.height, A.reach + 6, A.height + 4);
    this.enemies.getChildren().forEach(e => {
      if (!e.active || st.hitSet.has(e)) return;
      if (Phaser.Geom.Intersects.RectangleToRectangle(rect, e.getBounds())) { st.hitSet.add(e); this.damageEnemy(e); }
    });
  }
  damageEnemy(e, o = {}) {
    const s = this.hero.stats, crit = Math.random() < this.critChance();
    const dmg = Math.round(s.atk * s.baseDmgPct * (o.mult || 1) * (crit ? s.critDmg : 1) * Phaser.Math.FloatBetween(0.9, 1.1));
    if (this.hero.momentum) this.st.momentum++;
    e.hp -= dmg; e.stun = o.stun ?? 0.25;
    const kb = o.knockback ?? this.hero.attack.knockback, dir = o.dir || this.st.facing;
    e.setVelocityX(dir * kb); if (e.kind === 'oni' && !o.ranged) e.setVelocityY(-120);
    e.anims.pause(); e.setFrame(2);
    if (this.hero.burn) this.addBurn(e, crit ? 2 : 1);   // Mark VII: Burn on every hit, +1 stack on crit
    this.popText(e.x, e.y - 26, (crit ? '⚡' : '') + dmg, crit ? '#ffe14a' : '#ffffff', crit ? 14 : 11);
    this.sparks(e.x, e.y - 8, this.hero.ui?.spark ?? (crit ? 0x7ff0ff : 0xffffff), crit ? 10 : 6);
    this.cameras.main.shake(o.ranged ? 40 : 60, crit ? 0.005 : o.ranged ? 0.0015 : 0.003);
    this.hitstop(crit ? (o.ranged ? 40 : 70) : this.hero.attack.hitstopMs ?? 45);
    if (e.hp <= 0) this.killEnemy(e);
  }
  // ---- ranged: repulsor bolts + Burn DoT ----
  fireBolt() {
    const h = this.hero, p = this.player, st = this.st, R = h.ranged, m = h.sprite.muzzle, f = st.facing;
    const x = p.x + f * m.x, y = p.y + m.y;
    const b = this.bolts.create(x, y, `${h.key}_bolt`, 0).setScale(0.5).setDepth(7).setFlipX(f < 0).play(`${h.key}:bolt`);
    // light aim assist: the palm sits at head height, so bolts bend toward the nearest enemy in a forward cone (±R.aimDeg)
    let ang = f > 0 ? 0 : Math.PI, best = 1e9;
    this.enemies.getChildren().forEach(e => {
      if (!e.active) return;
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
    this.popText(e.x + 14, e.y - 40, `BURN x${e.burn.stacks}`, '#ff9a3c', 8);
  }
  updateBurn(e, dt) {
    const u = e.burn; if (!u) return;
    u.t -= dt; u.tick -= dt;
    e.flame.setPosition(e.x + Math.sin(this.time.now / 90) * 2, e.y - e.displayHeight / 2 + 2).setScale(0.6 + 0.08 * u.stacks);
    if (Math.random() < dt * (4 + u.stacks * 3)) {   // embers
      const s = this.add.image(e.x + Phaser.Math.Between(-10, 10), e.y + Phaser.Math.Between(-12, 8), 'px').setTint(Math.random() < 0.5 ? 0xff8a1e : 0xffd23f).setDepth(6);
      this.tweens.add({ targets: s, y: s.y - 16 - Math.random() * 10, alpha: 0, duration: 420, onComplete: () => s.destroy() });
    }
    if (u.tick <= 0) {
      u.tick += u.B.tickMs / 1000;
      const d = Math.max(1, Math.round(u.atk * u.B.pctAtkPerTick * u.stacks));
      e.hp -= d; e.setTintFill(0xff8a3c); this.time.delayedCall(60, () => e.active && e.clearTint());
      this.popText(e.x + Phaser.Math.Between(-8, 8), e.y - 18, '' + d, '#ff8a3c', 9);
      if (e.hp <= 0) { this.killEnemy(e); return; }
    }
    if (u.t <= 0) this.clearBurn(e);
  }
  clearBurn(e) { if (e.flame) e.flame.destroy(); e.burn = null; e.flame = null; }
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
    this.clearBurn(e);
    this.sparks(e.x, e.y - 8, 0xe055b0, 16);
    e.hpBar.destroy(); e.disableBody(true, false);
    this.tweens.add({ targets: e, alpha: 0, scaleY: 0.2, duration: 220, onComplete: () => e.destroy() });
  }
  touchEnemy(e) {
    const st = this.st; if (st.invuln > 0 || st.dead || st.special || !e.active || e.stun > 0) return;
    st.hp -= e.atk; st.invuln = 1.0; st.hurtT = 0.32; st.attacking = false; this.player.setFlipX(st.facing < 0);
    const d = this.player.x < e.x ? -1 : 1;
    this.player.setVelocity(d * 200, this.hero.flight ? -60 : -220);
    this.player.anims.play(this.A('hurt'), true);
    this.cameras.main.shake(90, 0.008); this.cameras.main.flash(80, 120, 20, 40);
    this.popText(this.player.x, this.player.y - 160, '-' + e.atk, '#ff6a8a', 12);
    if (st.hp <= 0) this.die();
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
    this.updateEnemies(dt);
    if (st.special) { if (this.dashFx) this.speedFx(dt, true); return; }
    if (p.y > VH + 60 && !st.dead) { st.hp = 0; this.die(); }
    if (st.dead) { p.setVelocityX(p.body.velocity.x * 0.9); return; }

    st.invuln = Math.max(0, st.invuln - dt); st.hurtT = Math.max(0, st.hurtT - dt); st.swapCd = Math.max(0, st.swapCd - dt);
    p.setAlpha(st.invuln > 0 && st.hurtT <= 0 ? (Math.floor(time / 60) % 2 ? 0.35 : 1) : 1);
    const onGround = p.body.blocked.down || p.body.touching.down;
    st.coyote = onGround ? 0.09 : Math.max(0, (st.coyote || 0) - dt); // late-jump grace after leaving a ledge
    const left = K.LEFT.isDown || K.A.isDown, right = K.RIGHT.isDown || K.D.isDown;
    this.buf.jump = Math.max(0, this.buf.jump - dt); this.buf.atk = Math.max(0, this.buf.atk - dt);
    const jumpPressed = this.buf.jump > 0, atkPressed = this.buf.atk > 0;
    const running = K.SHIFT.isDown;

    if (!st.won && Math.abs(p.x - this.goal.x) < 20 && (onGround || (h.flight && Math.abs(p.y - GROUND_Y) < 90))) { st.won = true; this.msg.setText('RIFT SEALED\nstage clear — press R'); }
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
      p.anims.play(this.A(st.raisedT > 0 ? 'shoot' : 'attack'), true);
    }
    p.setFlipX(st.facing < 0);
    const vx = p.body.velocity.x, vy = p.body.velocity.y, flying = Math.abs(vx) > 70 && !st.attacking && st.raisedT <= 0 && !st.lowering;
    const tilt = Phaser.Math.Clamp(vy / F.speed, -1, 1) * F.maxTiltDeg * st.facing * (flying ? 1 : 0.5);
    p.setAngle(Phaser.Math.Linear(p.angle, tilt, Math.min(1, dt * 8)));
    this.thrusterFx(dt, flying);
    if (st.attacking || st.raisedT > 0) return;
    if (!st.lowering && p.anims.currentAnim && (p.anims.currentAnim.key === this.A('attack') || p.anims.currentAnim.key === this.A('shoot'))) {
      st.lowering = true; p.anims.play(this.A('lower'), true); return;
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

  updateEnemies(dt) {
    const p = this.player;
    this.bolts.getChildren().slice().forEach(b => {
      if (!b.dying && (Math.hypot(b.x - b.startX, b.y - b.startY) > b.hero.ranged.rangePx || b.x < 0 || b.x > WORLD_W)) {   // fade out at max range
        b.dying = true; b.body.enable = false; this.tweens.add({ targets: b, alpha: 0, scaleX: 0.2, duration: 90, onComplete: () => b.destroy() });
      }
    });
    this.enemies.getChildren().forEach(e => {
      if (!e.active || !e.body) return;
      e.stun = Math.max(0, e.stun - dt);
      this.updateBurn(e, dt); if (!e.active || !e.body) return;
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
      if (e.y > VH + 80) { this.clearBurn(e); e.hpBar.destroy(); e.destroy(); return; }
      const g = e.hpBar; g.clear();
      if (e.hp < e.maxHp) { const w = 24, x = e.x - 12, y = e.y - e.displayHeight / 2 - 6; g.fillStyle(0x140812).fillRect(x - 1, y - 1, w + 2, 4); g.fillStyle(0xff3a6e).fillRect(x, y, w * e.hp / e.maxHp, 2); }
    });
  }
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
