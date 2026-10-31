// Data-driven character loader.
// heroes.json  = raw stat export of Heroes Idle characters.js (tools/export_characters.js)
// roster.json  = which heroes are playable + their sprite/body/move data
// asagi_hd_anim.json (per hero) = frame size, feet anchor, one sheet per animation (fps or per-frame durations)
window.CharacterLoader = {
  async load(name) {
    const j = (u) => fetch(u, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); });
    const [roster, db] = await Promise.all([j('data/roster.json'), j('data/heroes.json')]);
    const want = name || roster.default;
    const entry = roster.heroes.find(h => h.name.toLowerCase() === want.toLowerCase()) || roster.heroes[0];
    const stats = db.heroes.find(h => h.Name === entry.name);
    if (!stats) throw new Error('hero not in heroes.json: ' + entry.name);
    const meta = await j(entry.sprite.meta);
    const crit = Math.min(1, (stats.CritChance || 0) + (entry.passiveCritBonus || 0));
    return {
      name: entry.name, key: entry.key, portrait: entry.portrait,
      faction: stats.Faction, universe: stats.Universe, rarity: stats.Rarity,
      flavor: stats['Flavor Text'], passive: stats.Passive, leader: stats.Leader,
      stats: { atk: stats.Attack, hp: stats.Health, crit, critDmg: stats.CritDmg || 1.5, baseDmgPct: stats.BaseDmgPct || 1 },
      sprite: { dir: entry.sprite.meta.replace(/[^/]*$/, ''), scale: entry.sprite.scale || 1, body: entry.sprite.body, meta },
      move: entry.move, attack: entry.attack,
    };
  }
};
