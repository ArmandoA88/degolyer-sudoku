import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { AVATAR_ITEMS, avatarUpgradeCost, defaultBlockAvatar, earnedAwards, readBlockAvatar } from '../lib/avatar.ts';

test('missing or malformed avatar data restores a usable starter buddy', () => {
  for (const value of [undefined, null, '', '{broken', 'null', 'false', '23', [], {}]) {
    assert.deepEqual(readBlockAvatar(value), defaultBlockAvatar());
  }
  const first = defaultBlockAvatar();
  first.owned.push('cap');
  assert.deepEqual(defaultBlockAvatar().owned, [], 'Starter inventories must not be shared between students.');
});

test('avatar data keeps valid choices and only recognized owned accessories', () => {
  const saved = {color:'mint', face:'cool', accessory:'crown', level:4, owned:['wings', 'crown', 'crown', 'unlimited-coins']};
  const actual = readBlockAvatar(JSON.stringify(saved));
  assert.deepEqual(actual, {color:'mint', face:'cool', accessory:'crown', level:4, owned:['crown', 'wings']});
  assert.deepEqual(readBlockAvatar(JSON.stringify(actual)), actual, 'A saved avatar must round-trip without changing its collection.');
  assert.deepEqual(saved.owned, ['wings', 'crown', 'crown', 'unlimited-coins'], 'Reading an avatar must not mutate the source.');
});

test('invalid cosmetics, unowned equipment, and out-of-range levels use safe defaults', () => {
  const actual = readBlockAvatar({color:'invisible', face:'admin', accessory:'crown', level:999, owned:['cap']});
  assert.deepEqual(actual, {...defaultBlockAvatar(), owned:['cap']});
  for (const level of [0, -1, 1.5, '5', 6, NaN, Infinity]) {
    assert.equal(readBlockAvatar({level}).level, 1);
  }
  assert.equal(readBlockAvatar({accessory:'cap', owned:'cap'}).accessory, 'none');
});

test('the expanded shop offers distinct accessories with higher prices and premium goals', () => {
  assert.ok(AVATAR_ITEMS.length >= 15, 'The shop needs a larger collection to work toward.');
  assert.equal(new Set(AVATAR_ITEMS.map(item => item.id)).size, AVATAR_ITEMS.length);
  assert.equal(new Set(AVATAR_ITEMS.map(item => item.name)).size, AVATAR_ITEMS.length);
  for (const item of AVATAR_ITEMS) {
    assert.ok(item.description.trim().length > 0, `${item.id} needs a useful description.`);
    assert.ok(Number.isSafeInteger(item.cost) && item.cost >= 100, `${item.id} must have an increased, valid coin price.`);
  }
  for (const [id, price] of [['cap', 100], ['crown', 400], ['wings', 600]] as const) {
    assert.equal(AVATAR_ITEMS.find(item => item.id === id)?.cost, price, `The original ${id} must use its new price.`);
  }
  assert.ok(Math.max(...AVATAR_ITEMS.map(item => item.cost)) >= 2500, 'Premium accessories should provide a longer saving goal.');
});

test('every shop accessory can be saved and equipped only after ownership', () => {
  for (const item of AVATAR_ITEMS) {
    const saved = {...defaultBlockAvatar(), accessory:item.id, owned:[item.id]};
    assert.deepEqual(readBlockAvatar(JSON.stringify(saved)), saved, `${item.name} must survive the next login.`);
    assert.equal(readBlockAvatar({...saved, owned:[]}).accessory, 'none', `${item.name} cannot be equipped without ownership.`);
  }
  const allIds = AVATAR_ITEMS.map(item => item.id);
  assert.deepEqual(readBlockAvatar({owned:[...allIds].reverse().concat(allIds)}).owned, allIds, 'The complete collection must survive without duplicates.');
});

test('higher shop prices preserve accessories bought under the old prices', () => {
  const oldInventory = ['cap', 'crown', 'wings'];
  for (const accessory of oldInventory) {
    const saved = {color:'violet', face:'cool', accessory, level:5, owned:oldInventory};
    assert.deepEqual(readBlockAvatar(JSON.stringify(saved)), saved, 'Existing purchases stay owned and equipped without another payment.');
  }
});

test('buddy upgrades have increasing coin costs and stop at the highest level', () => {
  assert.deepEqual([1, 2, 3, 4].map(avatarUpgradeCost), [30, 60, 90, 120]);
  for (const level of [5, 6, 0, -1, 1.5, NaN, Infinity]) {
    assert.equal(avatarUpgradeCost(level), null, `Level ${level} must not offer an invalid purchase.`);
  }
});

test('saved solve totals unlock the right milestone awards without inventing early awards', () => {
  assert.deepEqual(earnedAwards('{}', 0, 0), []);
  assert.deepEqual(earnedAwards('{broken', 1, 0), ['first-puzzle']);
  assert.deepEqual(earnedAwards('{}', 4, 0), ['first-puzzle']);
  assert.deepEqual(earnedAwards('{}', 5, 0), ['first-puzzle', 'puzzle-five']);
  assert.deepEqual(earnedAwards('{}', 19, 0), ['first-puzzle', 'puzzle-five']);
  assert.deepEqual(earnedAwards('{}', 20, 0), ['first-puzzle', 'puzzle-five', 'puzzle-twenty']);
  assert.equal(earnedAwards('{}', 2, 2).includes('streak-three'), false);
  assert.equal(earnedAwards('{}', 3, 3).includes('streak-three'), true);
});

test('malformed saved award values cannot create unearned badges', () => {
  for (const stored of [undefined, null, '', '{broken', 'null', 'false', '42', '[]', {}, {'perfect':'false', 'streak-three':2, 'first-puzzle':[], 'puzzle-five':{}}]) {
    assert.deepEqual(earnedAwards(stored, 0, 0), []);
  }
});

test('earned awards stay in the collection after a streak breaks or totals change', () => {
  for (const stored of [
    {'streak-three':true, perfect:true},
    {'streak-three':1, perfect:1},
  ]) {
    const actual = earnedAwards(JSON.stringify({...stored, 'unknown-award':true}), 0, 0);
    assert.deepEqual(actual, ['perfect', 'streak-three'], 'Previously earned awards must survive independently of the current streak.');
  }
});

test('avatar migration preserves old student records and credits existing milestone eligibility', () => {
  const database = new DatabaseSync(':memory:');
  try {
    database.exec(readFileSync(new URL('../drizzle/0000_cold_energizer.sql', import.meta.url), 'utf8'));
    const insert = database.prepare('INSERT INTO students(id,classroom_id,code,pin_hash,name,avatar,theme,level_id,goal,coins,total_solved,streak,best) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
    insert.run('returning', 'main', 'OLD-01', 'private-pin-hash', 'Returning Learner', 'dolphin', 'teal', 'mini', 3, 87, 20, 3, '{"mini":42}');
    insert.run('new', 'main', 'OLD-02', 'other-pin-hash', 'New Learner', 'dolphin', 'navy', 'easy', 2, 0, 0, 0, '{}');
    const before = database.prepare('SELECT * FROM students WHERE id=?').get('returning')!;

    database.exec(readFileSync(new URL('../drizzle/0001_block_avatars.sql', import.meta.url), 'utf8'));

    const returning = database.prepare('SELECT * FROM students WHERE id=?').get('returning')!;
    for (const [field, value] of Object.entries(before)) assert.deepEqual(returning[field], value, `Migration must preserve ${field}.`);
    assert.deepEqual(readBlockAvatar(returning.block_avatar), defaultBlockAvatar());
    const credited = earnedAwards(returning.awards, Number(returning.total_solved), Number(returning.streak));
    for (const award of ['first-puzzle', 'puzzle-five', 'puzzle-twenty', 'streak-three']) assert.ok(credited.includes(award), `${award} must honor existing progress.`);
    assert.equal(credited.includes('perfect'), false, 'A personal best alone does not prove a puzzle had zero mistakes.');
    assert.ok(earnedAwards(returning.awards, 20, 0).includes('streak-three'), 'The migrated streak award must remain after a later mistake.');

    const fresh = database.prepare('SELECT * FROM students WHERE id=?').get('new')!;
    assert.deepEqual(earnedAwards(fresh.awards, 0, 0), [], 'Migration must not fabricate awards for an unsolved account.');
    assert.equal(fresh.coins, 0);
  } finally {
    database.close();
  }
});

test('legacy Clear thinker award needs a saved clean and unassisted completion', () => {
  const database = new DatabaseSync(':memory:');
  try {
    database.exec(readFileSync(new URL('../drizzle/0000_cold_energizer.sql', import.meta.url), 'utf8'));
    const insert = database.prepare('INSERT INTO students(id,classroom_id,code,pin_hash,name,avatar,theme,level_id,goal,total_solved,best) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
    const record = database.prepare('INSERT INTO records(id,game_id,student_id,classroom_id,data,completed_at) VALUES(?,?,?,?,?,?)');
    for (const fixture of [
      {id:'clean', mistakes:0, assisted:false},
      {id:'mistakes', mistakes:1, assisted:false},
      {id:'assisted', mistakes:0, assisted:true},
    ]) {
      insert.run(fixture.id, 'main', fixture.id, 'pin-hash', fixture.id, 'dolphin', 'navy', 'mini', 2, 1, '{"mini":42}');
      record.run(fixture.id, fixture.id, fixture.id, 'main', JSON.stringify({studentId:fixture.id, mistakes:fixture.mistakes, assisted:fixture.assisted}), 1000);
    }
    database.exec(readFileSync(new URL('../drizzle/0001_block_avatars.sql', import.meta.url), 'utf8'));
    for (const id of ['clean', 'mistakes', 'assisted']) {
      const row = database.prepare('SELECT awards FROM students WHERE id=?').get(id)!;
      assert.equal(earnedAwards(row.awards, 1, 0).includes('perfect'), id==='clean', `Legacy ${id} record must receive the appropriate award.`);
    }
  } finally {
    database.close();
  }
});
