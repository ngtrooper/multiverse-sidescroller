// Data-driven character loader.
// heroes.json  = stat export of Heroes Idle characters.js (tools/export_characters.js); the published build ships only the roster's rows
// roster.json  = which heroes are playable + their sprite/body/move data
// <hero>_hd_anim.json (per hero) = frame size, feet anchor, one sheet per animation (fps or per-frame durations)
window.CharacterLoader = {
  async loadParty(want) {
    const j = (u) => fetch(u, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); });
    const [roster, db] = await Promise.all([j('data/roster.json'), j('data/heroes.json')]);
    const party = await Promise.all(roster.heroes.map(async entry => {
      const stats = db.heroes.find(h => h.Name === entry.name);
      if (!stats) throw new Error('hero not in heroes.json: ' + entry.name);
      const meta = await j(entry.sprite.meta);
      const crit = Math.min(1, (stats.CritChance || 0) + (entry.passiveCritBonus || 0));
      return {
        name: entry.name, key: entry.key, portrait: entry.portrait,
        faction: stats.Faction, universe: stats.Universe, rarity: stats.Rarity,
        flavor: stats['Flavor Text'], passive: stats.Passive, leader: stats.Leader,
        stats: { atk: stats.Attack, hp: stats.Health, crit, critDmg: stats.CritDmg ?? 1.5, baseDmgPct: stats.BaseDmgPct || 1 },
        sprite: { dir: entry.sprite.meta.replace(/[^/]*$/, ''), scale: entry.sprite.scale || 1, body: entry.sprite.body, attackArtFacesLeft: !!entry.sprite.attackArtFacesLeft,
          muzzle: entry.sprite.muzzle, muzzleAlt: entry.sprite.muzzleAlt, jets: entry.sprite.jets, meta },
        move: entry.move, attack: entry.attack, fx: entry.fx, ui: entry.ui, momentum: entry.momentum,
        flight: entry.flight, ranged: entry.ranged, burn: entry.burn,
      };
    }));
    // ?hero= matches name or key, case/space-insensitive, then by substring (IronMan, ironman, Iron%20Man, flash ...)
    const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const w = norm(want || roster.default);
    let idx = party.findIndex(h => norm(h.name) === w || h.key === w);
    if (idx < 0) idx = party.findIndex(h => norm(h.name).includes(w));
    return { party, idx: Math.max(0, idx) };
  }
};
