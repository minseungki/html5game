import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, coinsFor } from '../src/game.js';
import { CONFIG } from '../src/config.js';

const seq = (values) => {
    let i = 0;
    return () => values[i++ % values.length];
};

// 첫 값이 기준을 정하고 이후 값이 과일 대기열을 만든다
const makeGame = (values) => createGame({ random: seq(values) });

test('좌우 기준이 주입 난수에 따라 두 가지로 나오고 한 판 동안 바뀌지 않는다', () => {
    const a = makeGame([0.1, 0.1]);
    const b = makeGame([0.9, 0.1]);
    assert.deepEqual(a.rule, { left: 'orange', right: 'pear' });
    assert.deepEqual(b.rule, { left: 'pear', right: 'orange' });
    a.start(0);
    for (let t = 0; t < 9000; t += 600) {
        a.input('left', t);
        a.input('right', t + 300);
    }
    assert.deepEqual(a.rule, { left: 'orange', right: 'pear' });
});

test('정답이면 +1이고 맨 앞이 넘어가며 대기열 길이는 유지된다', () => {
    const g = makeGame([0.1, 0.1, 0.9, 0.1, 0.9, 0.1]);
    g.start(0);
    const second = g.queue[1];
    const len = g.queue.length;
    assert.equal(g.input('left', 100), 'correct');
    assert.equal(g.score, 1);
    assert.equal(g.queue[0], second);
    assert.equal(g.queue.length, len);
});

test('오답이면 점수와 맨 앞 유지, 499ms까지 입력 무시, 500ms에 다시 입력 가능', () => {
    const g = makeGame([0.1, 0.1, 0.1, 0.1, 0.1]);
    g.start(0);
    const front = g.queue[0];
    assert.equal(g.input('right', 1000), 'wrong');
    assert.equal(g.score, 0);
    assert.equal(g.queue[0], front);
    assert.equal(g.input('left', 1499), 'ignored');
    assert.equal(g.input('left', 1500), 'correct');
});

test('시작 전 입력 무시, 9999ms 정답은 인정, 10000ms 입력은 무시', () => {
    const g = makeGame([0.1, 0.1, 0.1, 0.1, 0.1]);
    assert.equal(g.input('left', 0), 'ignored');
    g.start(0);
    assert.equal(g.input('left', 9999), 'correct');
    assert.equal(g.input('left', 10000), 'ignored');
    assert.equal(g.score, 1);
});

test('잠금 중 종료돼도 10초에 끝난다', () => {
    const g = makeGame([0.1, 0.1, 0.1, 0.1, 0.1]);
    g.start(0);
    assert.equal(g.input('right', 9800), 'wrong');
    assert.equal(g.isFinished(9999), false);
    assert.equal(g.isFinished(10000), true);
    assert.equal(g.remainingMs(10000), 0);
});

test('중간 호출 없이 now만 건너뛰어도 남은 시간이 0이고 종료로 판정된다', () => {
    const g = makeGame([0.1]);
    g.start(1000);
    assert.equal(g.remainingMs(1000), CONFIG.gameDurationMs);
    assert.equal(g.remainingMs(60000), 0);
    assert.equal(g.isFinished(60000), true);
});

test('코인 = 점수 x 설정값, 0점은 0코인', () => {
    assert.equal(coinsFor(7), 7 * CONFIG.coinsPerPoint);
    assert.equal(coinsFor(0), 0);
    assert.equal(coinsFor(3, { coinsPerPoint: 5 }), 15);
});
