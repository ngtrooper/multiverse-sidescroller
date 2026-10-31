// Rift Runners — test stage. Phaser 3 (vendored), arcade physics.
// World is laid out in 640x360 "world px"; the canvas is 2x (1280x720) and the camera zooms 2x, so the
// HD hero sprite (drawn at 0.5 scale) shows 1 texel = 1 screen px while the world tiles stay chunky 2x.
const VW = 640, VH = 360, GROUND_Y = 316, WORLD_W = 3600, ZOOM = 2;
// scrollFactor-0 objects are zoomed around the screen centre; this offset pins them to the top-left
const UIX = VW * (ZOOM - 1) / 2, UIY = VH * (ZOOM - 1) / 2;

class GameScene extends Phaser.Scene {
  constructor() { super('game'); }
  init(data) { this.hero = data.hero; }
  preload() {
    const h = this.hero, m = h.sprite.meta;
    for (const [name, a] of Object.entries(m.animations))
      this.load.spritesheet(`${h.key}_${name}`, h.sprite.dir + a.sheet, { frameWidth: m.frameWidth, frameHeight: m.frameHeight });
    this.load.image('portrait', h.portrait);
  }
  create() {
    const h = this.hero, m = h.sprite.meta;
    Tex.all(this, VW, VH);
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
    // ground with two gaps
    ground(0, 1100); ground(1180, 900); ground(2170, WORLD_W - 2170);
    const plat = (x, y, w) => {
      const p = this.add.tileSprite(x, y, w, 10, 'tile_plat').setOrigin(0);
      this.oneway.add(p); p.body.updateFromGameObject();
      p.body.checkCollision.down = p.body.checkCollision.left = p.body.checkCollision.right = false;
    };
    [[360, 250, 96], [520, 200, 80], [700, 240, 112], [1060, 236, 128], [1320, 220, 96], [1480, 170, 96], [1660, 230, 128],
     [1990, 240, 160], [2300, 220, 96], [2480, 180, 112], [2700, 236, 96], [2900, 200, 128]].forEach(a => plat(...a));

    // goal rift portal
    this.anims.create({ key: 'portal', frames: this.anims.generateFrameNumbers('portal', { start: 0, end: 3 }), frameRate: 8, repeat: -1 });
    this.goal = this.physics.add.staticSprite(WORLD_W - 120, GROUND_Y - 36, 'portal', 0).play('portal');

    // ---- player ----
    this.makeAnims();
    const ay = (m.anchor.footRow + 1) / m.frameHeight, ax = m.anchor.x;
    this.player = this.physics.add.sprite(120, GROUND_Y - 4, `${h.key}_idle`, 0).setOrigin(ax, ay).setDepth(5).setScale(h.sprite.scale || 1);
    const B = h.sprite.body; // texture px; arcade scales by the sprite scale
    this.player.body.setSize(B.width, B.height).setOffset(m.frameWidth * ax - B.width / 2, m.anchor.footRow + 1 - B.height);
    this.player.body.setMaxVelocity(400, 900);
    this.physics.add.collider(this.player, this.solids);
    this.physics.add.collider(this.player, this.oneway);
    this.st = { hp: h.stats.hp, maxHp: h.stats.hp, facing: 1, attacking: false, hitSet: null, invuln: 0, hurtT: 0, jumpT: 0, landT: 0, wasGround: true, dead: false, won: false };
    this.player.on('animationcomplete', (a) => { if (a.key === 'attack') { this.st.attacking = false; } });
    this.player.on('animationupdate', (a, f) => { if (a.key === 'attack') this.onAttackFrame(f.index - 1); });

    // ---- enemies ----
    this.enemies = this.physics.add.group({ allowGravity: true });
    this.anims.create({ key: 'oni_walk', frames: this.anims.generateFrameNumbers('oni', { frames: [0, 1] }), frameRate: 5, repeat: -1 });
    this.anims.create({ key: 'drone_fly', frames: this.anims.generateFrameNumbers('drone', { frames: [0, 1] }), frameRate: 10, repeat: -1 });
    [[620, 'oni'], [980, 'drone'], [1400, 'oni'], [1750, 'oni'], [1900, 'drone'], [2400, 'oni'], [2600, 'drone'], [3000, 'oni'], [3150, 'drone']]
      .forEach(([x, t]) => this.spawn(t, x));
    this.physics.add.collider(this.enemies, this.solids);
    this.physics.add.overlap(this.player, this.enemies, (p, e) => this.touchEnemy(e));

    // ---- camera / input / hud ----
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12, 0, 40).setDeadzone(60, 40);
    this.keys = this.input.keyboard.addKeys('LEFT,RIGHT,UP,DOWN,A,D,W,S,SPACE,J,Z,SHIFT,R');
    this.input.keyboard.addCapture('SPACE,UP,DOWN,LEFT,RIGHT');
    // input buffer: key events are latched so taps shorter than one frame are never lost
    this.buf = { jump: 0, atk: 0 };
    const kb = this.input.keyboard;
    ['SPACE', 'UP', 'W'].forEach(k => kb.on('keydown-' + k, () => this.buf.jump = 0.12));
    ['J', 'Z'].forEach(k => kb.on('keydown-' + k, () => this.buf.atk = 0.15));
    this.makeHud();
    this.fx = this.add.group();
  }

  makeAnims() {
    const h = this.hero, m = h.sprite.meta;
    const mk = (key, sheetName, a, fps) => {
      const tex = `${h.key}_${sheetName}`;
      let frames = this.anims.generateFrameNumbers(tex, { start: 0, end: a.frames - 1 });
      if (a.durationsMs) { // per-frame timing (Phaser adds frame.duration on top of 1000/frameRate)
        frames = frames.map((f, i) => ({ ...f, duration: a.durationsMs[i] - 1 })); fps = 1000;
      }
      this.anims.create({ key, frames, frameRate: fps, repeat: a.loop ? -1 : 0 });
    };
    for (const [name, a] of Object.entries(m.animations)) {
      let fps = a.fps;
      if (name === 'walk' && h.move.walkCyclePx) fps = h.move.walkSpeed * a.frames / h.move.walkCyclePx; // no foot sliding
      mk(name, name, a, fps);
    }
    // run reuses the walk cycle, played faster (locked to run speed)
    if (!m.animations.run) mk('run', 'walk', { ...m.animations.walk }, h.move.runSpeed * m.animations.walk.frames / (h.move.runCyclePx || h.move.walkCyclePx * 1.6));
  }

  spawn(type, x) {
    let e;
    if (type === 'oni') {
      e = this.enemies.create(x, GROUND_Y - 70, 'oni', 0).setScale(2.5).play('oni_walk');
      e.body.setSize(22, 36).setOffset(4, 2);
      Object.assign(e, { kind: 'oni', hp: 2400, maxHp: 2400, atk: 140, speed: 34, dir: -1, home: x, range: 120 });
    } else {
      e = this.enemies.create(x, 190, 'drone', 0).setScale(2.5).play('drone_fly');
      e.body.setAllowGravity(false); e.body.setSize(18, 16).setOffset(4, 3);
      Object.assign(e, { kind: 'drone', hp: 1400, maxHp: 1400, atk: 100, speed: 50, dir: -1, home: x, homeY: 190, range: 90, t: Math.random() * 6 });
    }
    e.setDepth(4); e.stun = 0; e.hpBar = this.add.graphics().setDepth(6);
  }

  makeHud() {
    const h = this.hero;
    this.hud = this.add.container(UIX, UIY).setScrollFactor(0).setDepth(20);
    const g = this.add.graphics();
    g.fillStyle(0x0b0a18, 0.85).fillRect(6, 6, 206, 50);
    g.lineStyle(1, 0x6a5c8e).strokeRect(6.5, 6.5, 206, 50);
    g.fillStyle(0x44d8ff).fillRect(8, 8, 44, 44);
    const por = this.add.image(10, 10, 'portrait').setOrigin(0);
    const name = this.add.text(58, 8, h.name.toUpperCase(), { fontFamily: 'monospace', fontSize: '10px', color: '#ffffff' });
    const sub = this.add.text(58, 20, `${h.faction} · ATK ${h.stats.atk} · CRIT ${(h.stats.crit * 100) | 0}%`, { fontFamily: 'monospace', fontSize: '8px', color: '#b8a8ff' });
    this.hpG = this.add.graphics();
    this.hpT = this.add.text(58, 42, '', { fontFamily: 'monospace', fontSize: '8px', color: '#ffffff' });
    this.msg = this.add.text(VW / 2, 120, '', { fontFamily: 'monospace', fontSize: '16px', color: '#ffffff', align: 'center', stroke: '#1a0f2a', strokeThickness: 4 }).setOrigin(0.5);
    this.hud.add([g, por, name, sub, this.hpG, this.hpT, this.msg]);
    this.hpShown = this.st.hp;
  }
  drawHud(dt) {
    const st = this.st, w = 128, x = 58, y = 32;
    this.hpShown += (st.hp - this.hpShown) * Math.min(1, dt * 4);
    const g = this.hpG; g.clear();
    g.fillStyle(0x1a1028).fillRect(x - 1, y - 1, w + 2, 10);
    g.fillStyle(0xffffff).fillRect(x, y, w * Math.max(0, this.hpShown) / st.maxHp, 8);         // trailing damage
    const f = Math.max(0, st.hp) / st.maxHp, col = f > 0.5 ? 0x58e070 : f > 0.25 ? 0xffd23f : 0xff3a6e;
    g.fillStyle(col).fillRect(x, y, w * f, 8);
    g.fillStyle(0xffffff, 0.35).fillRect(x, y, w * f, 2);
    this.hpT.setText(`HP ${Math.max(0, Math.ceil(st.hp))}/${st.maxHp}`);
  }

  // ---------------- combat ----------------
  onAttackFrame(i) {
    const active = this.hero.sprite.meta.animations.attack.activeFrames || [6, 7];
    if (!active.includes(i)) return;
    const p = this.player, A = this.hero.attack, st = this.st;
    const x0 = st.facing > 0 ? p.x - 6 : p.x - A.reach, rect = new Phaser.Geom.Rectangle(x0, p.y - A.height, A.reach + 6, A.height + 4);
    this.enemies.getChildren().forEach(e => {
      if (!e.active || st.hitSet.has(e)) return;
      if (Phaser.Geom.Intersects.RectangleToRectangle(rect, e.getBounds())) { st.hitSet.add(e); this.damageEnemy(e); }
    });
  }
  damageEnemy(e) {
    const s = this.hero.stats, crit = Math.random() < s.crit;
    const dmg = Math.round(s.atk * s.baseDmgPct * (crit ? s.critDmg : 1) * Phaser.Math.FloatBetween(0.9, 1.1));
    e.hp -= dmg; e.stun = 0.25;
    e.setVelocityX(this.st.facing * this.hero.attack.knockback); if (e.kind === 'oni') e.setVelocityY(-120);
    e.anims.pause(); e.setFrame(2);
    this.popText(e.x, e.y - 26, (crit ? '⚡' : '') + dmg, crit ? '#ffe14a' : '#ffffff', crit ? 14 : 11);
    this.sparks(e.x, e.y - 8, crit ? 0x7ff0ff : 0xffffff, crit ? 10 : 6);
    this.cameras.main.shake(60, crit ? 0.006 : 0.003);
    this.hitstop(crit ? 70 : 45);
    if (e.hp <= 0) this.killEnemy(e);
  }
  killEnemy(e) {
    this.sparks(e.x, e.y - 8, 0xe055b0, 16);
    e.hpBar.destroy(); e.disableBody(true, false);
    this.tweens.add({ targets: e, alpha: 0, scaleY: 0.2, duration: 220, onComplete: () => e.destroy() });
  }
  touchEnemy(e) {
    const st = this.st; if (st.invuln > 0 || st.dead || !e.active || e.stun > 0) return;
    st.hp -= e.atk; st.invuln = 1.0; st.hurtT = 0.32; st.attacking = false; this.player.setFlipX(st.facing < 0);
    const d = this.player.x < e.x ? -1 : 1;
    this.player.setVelocity(d * 200, -220);
    this.player.anims.play('hurt', true);
    this.cameras.main.shake(90, 0.008); this.cameras.main.flash(80, 120, 20, 40);
    this.popText(this.player.x, this.player.y - 160, '-' + e.atk, '#ff6a8a', 12);
    if (st.hp <= 0) this.die();
  }
  die() { const st = this.st; st.dead = true; this.player.setTint(0x9070a0); this.msg.setText('THE RIFT CLAIMED YOU\npress R'); this.player.anims.play('hurt'); }
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

  // ---------------- update ----------------
  update(time, deltaMs) {
    const dt = Math.min(deltaMs, 50) / 1000, p = this.player, st = this.st, K = this.keys, h = this.hero;
    const cam = this.cameras.main;
    this.par.forEach(l => l.s.tilePositionX = cam.scrollX * l.f);
    this.drawHud(dt);
    if (Phaser.Input.Keyboard.JustDown(K.R)) { this.scene.restart({ hero: h }); return; }
    if (p.y > VH + 60 && !st.dead) { st.hp = 0; this.die(); }
    this.updateEnemies(dt);
    if (st.dead) { p.setVelocityX(p.body.velocity.x * 0.9); return; }

    st.invuln = Math.max(0, st.invuln - dt); st.hurtT = Math.max(0, st.hurtT - dt);
    p.setAlpha(st.invuln > 0 && st.hurtT <= 0 ? (Math.floor(time / 60) % 2 ? 0.35 : 1) : 1);
    const onGround = p.body.blocked.down || p.body.touching.down;
    st.coyote = onGround ? 0.09 : Math.max(0, (st.coyote || 0) - dt); // late-jump grace after leaving a ledge
    const left = K.LEFT.isDown || K.A.isDown, right = K.RIGHT.isDown || K.D.isDown;
    this.buf.jump = Math.max(0, this.buf.jump - dt); this.buf.atk = Math.max(0, this.buf.atk - dt);
    const jumpPressed = this.buf.jump > 0, atkPressed = this.buf.atk > 0;
    const running = K.SHIFT.isDown;

    // goal
    if (!st.won && Math.abs(p.x - this.goal.x) < 20 && onGround) { st.won = true; this.msg.setText('RIFT SEALED\nstage clear — press R'); }

    if (st.hurtT > 0) { this.applyFriction(onGround, dt); return; }

    // attack
    if (atkPressed && !st.attacking) {
      this.buf.atk = 0; st.attacking = true; st.hitSet = new Set(); p.anims.play('attack', true); p.setFlipX(st.facing > 0);
      if (onGround) p.setVelocityX(st.facing * 30);
    }
    // horizontal movement
    let dir = (right ? 1 : 0) - (left ? 1 : 0);
    if (st.attacking && onGround) dir = 0;
    const speed = running ? h.move.runSpeed : h.move.walkSpeed;
    if (dir) {
      if (!st.attacking) st.facing = dir;
      const target = dir * speed, ctl = onGround ? 1 : h.move.airControl;
      p.setVelocityX(Phaser.Math.Linear(p.body.velocity.x, target, Math.min(1, dt * 14 * ctl)));
    } else this.applyFriction(onGround, dt);
    p.setFlipX(st.attacking ? st.facing > 0 : st.facing < 0); // attack art slashes toward image-left

    // jump: 1-frame crouch, then launch; variable height
    if (jumpPressed && st.coyote > 0 && st.jumpT <= 0 && !st.attacking) { st.jumpT = 0.06; st.coyote = 0; this.buf.jump = 0; }
    if (st.jumpT > 0) { st.jumpT -= dt; if (st.jumpT <= 0) p.setVelocityY(-h.move.jumpVelocity); }
    if (!onGround && p.body.velocity.y < -180 && st.jumpT <= 0 && !(K.SPACE.isDown || K.UP.isDown || K.W.isDown)) p.setVelocityY(-180);
    if (onGround && !st.wasGround) st.landT = 0.08;
    st.wasGround = onGround; st.landT = Math.max(0, st.landT - dt);

    // animation state
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
  playLoop(key, rate) {
    const p = this.player;
    if (p.anims.currentAnim?.key !== key || !p.anims.isPlaying) p.anims.play(key, true);
    p.anims.timeScale = Phaser.Math.Clamp(rate, 0.5, 1.5);
  }
  applyFriction(onGround, dt) { const p = this.player; p.setVelocityX(p.body.velocity.x * (onGround ? Math.max(0, 1 - dt * 14) : 1 - dt * 2)); }

  updateEnemies(dt) {
    const p = this.player;
    this.enemies.getChildren().forEach(e => {
      if (!e.active || !e.body) return;
      e.stun = Math.max(0, e.stun - dt);
      if (e.stun <= 0 && !e.anims.isPlaying) e.anims.resume?.() || e.play(e.kind === 'oni' ? 'oni_walk' : 'drone_fly');
      if (e.stun <= 0) {
        if (e.kind === 'oni') {
          const near = Math.abs(p.x - e.x) < 160 && Math.abs(p.y - e.y) < 80 && !this.st.dead;
          if (near) e.dir = p.x < e.x ? -1 : 1;
          else if (e.x < e.home - e.range) e.dir = 1; else if (e.x > e.home + e.range) e.dir = -1;
          if (e.body.blocked.left) e.dir = 1; if (e.body.blocked.right) e.dir = -1;
          e.setVelocityX(e.dir * e.speed * (near ? 1.6 : 1));
        } else {
          e.t += dt;
          const near = Math.abs(p.x - e.x) < 180 && !this.st.dead;
          const tx = near ? p.x : e.home + Math.sin(e.t * 0.8) * e.range, ty = near ? p.y - 60 + Math.sin(e.t * 3) * 18 : e.homeY + Math.sin(e.t * 2) * 10;
          e.setVelocity(Phaser.Math.Clamp((tx - e.x) * 2, -e.speed * 1.4, e.speed * 1.4), Phaser.Math.Clamp((ty - e.y) * 2, -60, 60));
          e.dir = e.body.velocity.x < 0 ? -1 : 1;
        }
      } else if (e.kind === 'drone') e.setVelocity(e.body.velocity.x * 0.9, e.body.velocity.y * 0.9);
      e.setFlipX(e.dir > 0);
      if (e.y > VH + 80) { e.hpBar.destroy(); e.destroy(); return; }
      const g = e.hpBar; g.clear();
      if (e.hp < e.maxHp) { const w = 24, x = e.x - 12, y = e.y - e.displayHeight / 2 - 6; g.fillStyle(0x140812).fillRect(x - 1, y - 1, w + 2, 4); g.fillStyle(0xff3a6e).fillRect(x, y, w * e.hp / e.maxHp, 2); }
    });
  }
}

(async () => {
  const q = new URLSearchParams(location.search);
  let hero;
  try { hero = await CharacterLoader.load(q.get('hero')); }
  catch (err) { document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f88;padding:16px">Failed to load hero data: ${err.message}\nServe this folder over http (python3 -m http.server), not file://</pre>`); throw err; }
  window.game = new Phaser.Game({
    type: Phaser.AUTO, parent: 'game', width: VW * ZOOM, height: VH * ZOOM, pixelArt: true, roundPixels: true, backgroundColor: '#0b0a18',
    physics: { default: 'arcade', arcade: { gravity: { y: 1100 }, debug: q.has('debug') } },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [],
  });
  window.game.scene.add('game', GameScene, true, { hero });
})();
