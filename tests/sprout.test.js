import test from 'node:test';
import assert from 'node:assert/strict';
import { createSproutGame } from '../src/sprout.js';
import { CONFIG } from '../src/config.js';

// 결정적인 난수열(mulberry32)
const rng = (seed) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const make = (seed = 1) => createSproutGame({ random: rng(seed) });
const R = CONFIG.sprout.revealMs;
// 공개 중 cells에서 정답 칸을 읽는다
const sproutsAt = (g, t) => g.cells(t).map((c, i) => (c === 'sprout' ? i : -1)).filter((i) => i >= 0);
const stonesAt = (g, t) => g.cells(t).map((c, i) => (c === 'stone' ? i : -1)).filter((i) => i >= 0);

test('판마다 새싹 5,6,7,8개이고 5판 이후에도 8개, 항상 16칸이다', () => {
    const g = make();
    g.start(0);
    let t = 0;
    const counts = [];
    for (let round = 1; round <= 7; round++) {
        assert.equal(g.round, round);
        const cells = g.cells(t);
        assert.equal(cells.length, 16);
        const sprouts = sproutsAt(g, t);
        counts.push(sprouts.length);
        assert.equal(sprouts.length + stonesAt(g, t).length, 16);
        t += R;
        sprouts.forEach((i, n) => {
            const res = g.pick(i, t);
            assert.equal(res, n === sprouts.length - 1 ? 'cleared' : 'sprout');
        });
    }
    assert.deepEqual(counts, [5, 6, 7, 8, 8, 8, 8]);
});

test('주입 난수에 따라 배치가 다르다', () => {
    const layouts = new Set();
    for (let seed = 1; seed <= 5; seed++) {
        const g = make(seed);
        g.start(0);
        layouts.add(sproutsAt(g, 0).join(','));
    }
    assert.ok(layouts.size > 1);
});

test('start 전 입력은 무시되고 cells는 모두 hidden이다', () => {
    const g = make();
    assert.equal(g.pick(0, 0), 'ignored');
    assert.equal(g.pick(0, 5000), 'ignored');
    assert.equal(g.score, 0);
    assert.deepEqual(g.cells(0), Array(16).fill('hidden'));
});

test('공개 1499ms까지 입력 무시, 1500ms부터 허용, 공개가 끝나면 cells는 모두 hidden이다', () => {
    const g = make();
    g.start(1000);
    assert.equal(g.phase(1000 + R - 1), 'reveal');
    assert.ok(g.cells(1000 + R - 1).every((c) => c !== 'hidden'));
    assert.equal(g.pick(0, 1000 + R - 1), 'ignored');
    assert.equal(g.score, 0);
    assert.equal(g.phase(1000 + R), 'find');
    assert.deepEqual(g.cells(1000 + R), Array(16).fill('hidden'));
    assert.notEqual(g.pick(0, 1000 + R), 'ignored');
});

test('새싹은 +1이고 열린 채 유지되며 같은 칸 재선택은 무시된다', () => {
    const g = make();
    g.start(0);
    const [first] = sproutsAt(g, 0);
    assert.equal(g.pick(first, R), 'sprout');
    assert.equal(g.score, 1);
    assert.equal(g.cells(R + 10)[first], 'sprout');
    assert.equal(g.pick(first, R + 20), 'ignored');
    assert.equal(g.score, 1);
});

test('돌은 점수를 유지하고 499ms 잠금, 500ms에 허용, 재선택은 재잠금 없이 무시된다', () => {
    const g = make();
    g.start(0);
    const [stone] = stonesAt(g, 0);
    const [sprout] = sproutsAt(g, 0);
    assert.equal(g.pick(stone, R), 'stone');
    assert.equal(g.score, 0);
    assert.equal(g.cells(R + 1)[stone], 'stone');
    assert.equal(g.phase(R + 499), 'locked');
    assert.equal(g.pick(sprout, R + 499), 'ignored');
    // 잠금 중 돌 재선택은 잠금 시간을 늘리지 않는다
    assert.equal(g.pick(stone, R + 100), 'ignored');
    assert.equal(g.phase(R + 500), 'find');
    assert.equal(g.pick(stone, R + 500), 'ignored');
    assert.equal(g.pick(sprout, R + 500), 'sprout');
    assert.equal(g.score, 1);
});

test('마지막 새싹에서 cleared가 되고 즉시 새 판이 공개되며 종료 시각은 그대로다', () => {
    const g = make();
    g.start(0);
    const sprouts = sproutsAt(g, 0);
    let res;
    sprouts.forEach((i) => {
        res = g.pick(i, 5000);
    });
    assert.equal(res, 'cleared');
    assert.equal(g.round, 2);
    assert.equal(g.score, 5);
    assert.equal(g.phase(5000), 'reveal');
    assert.ok(g.cells(5000).every((c) => c !== 'hidden'));
    assert.equal(sproutsAt(g, 5000).length, 6);
    assert.equal(g.remainingMs(5000), CONFIG.sprout.durationMs - 5000);
    assert.equal(g.pick(0, 5000 + R - 1), 'ignored');
    assert.equal(g.isFinished(CONFIG.sprout.durationMs - 1), false);
    assert.equal(g.isFinished(CONFIG.sprout.durationMs), true);
});

test('19999ms 허용, 20000ms 무시, 공개/잠금 중에도 20000ms에 종료, now를 건너뛰어도 종료', () => {
    const g = make();
    g.start(0);
    const [sprout, sprout2] = sproutsAt(g, 0);
    assert.equal(g.pick(sprout, 19999), 'sprout');
    assert.equal(g.pick(sprout2, 20000), 'ignored');
    assert.equal(g.score, 1);

    // 19000ms에 마지막 새싹을 골라 새 판 공개를 만든다
    const r = make(2);
    r.start(0);
    const first = sproutsAt(r, 0);
    first.forEach((i) => r.pick(i, 19000));
    assert.equal(r.round, 2);
    assert.equal(r.phase(19999), 'reveal');
    assert.equal(r.isFinished(19999), false);
    assert.equal(r.isFinished(20000), true);
    assert.equal(r.pick(0, 20000), 'ignored');
    assert.equal(r.score, 5);

    const locked = make(3);
    locked.start(0);
    const [stone] = stonesAt(locked, 0);
    assert.equal(locked.pick(stone, 19700), 'stone');
    assert.equal(locked.isFinished(20000), true);
    assert.equal(locked.remainingMs(20000), 0);

    const jump = make(4);
    jump.start(0);
    assert.equal(jump.isFinished(60000), true);
    assert.equal(jump.remainingMs(60000), 0);
});

test('잘못된 index는 무시되고 점수와 잠금이 변하지 않는다', () => {
    const g = make();
    g.start(0);
    for (const bad of [-1, 16, 1.5, '0', null, undefined, NaN, Infinity, {}]) {
        assert.equal(g.pick(bad, R), 'ignored');
    }
    assert.equal(g.score, 0);
    assert.equal(g.phase(R), 'find');
    assert.deepEqual(g.cells(R), Array(16).fill('hidden'));
});
