import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlow } from '../src/flow.js';

const select = (f, gameId = 'fruit') => f.dispatch('SELECT', { gameId });
const toReady = (f, gameId = 'fruit') => {
    select(f, gameId);
    f.dispatch('REQUEST_AD');
    f.dispatch('VISIBLE');
    f.dispatch('GRANTED');
};
const toState = {
    home: () => createFlow(),
    landing: () => {
        const f = createFlow();
        select(f);
        return f;
    },
    adLoading: () => {
        const f = toState.landing();
        f.dispatch('REQUEST_AD');
        return f;
    },
    adShowing: () => {
        const f = toState.adLoading();
        f.dispatch('VISIBLE');
        return f;
    },
    adFailed: () => {
        const f = toState.adLoading();
        f.dispatch('FAILED', { reason: 'x' });
        return f;
    },
    ready: () => {
        const f = toState.adShowing();
        f.dispatch('GRANTED');
        return f;
    },
    countdown: () => {
        const f = toState.ready();
        f.dispatch('START', { playId: 'p' });
        return f;
    },
    playing: () => {
        const f = toState.countdown();
        f.dispatch('COUNTDOWN_DONE');
        return f;
    },
    result: () => {
        const f = toState.playing();
        f.dispatch('FINISH', { score: 1, coins: 1 });
        return f;
    },
};

test('초기 상태는 home이고 잘못된 gameId SELECT는 거부되며 광고 없이 START는 거부된다', () => {
    const f = createFlow();
    assert.equal(f.state, 'home');
    assert.equal(f.gameId, null);
    for (const gameId of [undefined, null, '', 'Fruit', 'fruit ', 'other', 1, {}]) {
        assert.equal(f.dispatch('SELECT', gameId === undefined ? {} : { gameId }).ok, false);
        assert.equal(f.state, 'home');
        assert.equal(f.gameId, null);
    }
    assert.equal(f.dispatch('SELECT').ok, false);
    assert.equal(f.dispatch('START', { playId: 'x' }).ok, false);
    assert.equal(f.state, 'home');
    select(f);
    assert.equal(f.state, 'landing');
    assert.equal(f.dispatch('START', { playId: 'x' }).ok, false);
    assert.equal(f.state, 'landing');
});

test('GRANTED 외의 이벤트로는 어느 상태에서도 ready가 되지 않는다', () => {
    const events = ['VISIBLE', 'FAILED', 'REQUEST_AD', 'COUNTDOWN_DONE', 'FINISH', 'START', 'HOME'];
    const paths = [[], ['REQUEST_AD'], ['REQUEST_AD', 'VISIBLE'], ['REQUEST_AD', 'FAILED']];
    for (const gameId of ['fruit', 'sprout']) {
        for (const path of paths) {
            for (const ev of events) {
                const f = createFlow();
                select(f, gameId);
                path.forEach((p) => f.dispatch(p));
                f.dispatch(ev, { reason: 'x' });
                assert.notEqual(f.state, 'ready', `${gameId} ${path.join(',')} + ${ev}`);
            }
        }
        const f = createFlow();
        select(f, gameId);
        assert.equal(f.dispatch('GRANTED').ok, false);
        assert.equal(f.state, 'landing');
    }
    // home에서 늦게 온 GRANTED도 거부된다
    const f = createFlow();
    assert.equal(f.dispatch('GRANTED').ok, false);
    assert.equal(f.state, 'home');
    const g = toState.landing();
    g.dispatch('HOME');
    assert.equal(g.dispatch('GRANTED').ok, false);
    assert.equal(g.state, 'home');
});

test('HOME은 landing, adFailed, result에서만 허용되고 gameId를 비운다', () => {
    for (const name of ['landing', 'adFailed', 'result']) {
        const f = toState[name]();
        assert.equal(f.dispatch('HOME').ok, true, name);
        assert.equal(f.state, 'home');
        assert.equal(f.gameId, null);
    }
    for (const name of ['home', 'adLoading', 'adShowing', 'ready', 'countdown', 'playing']) {
        const f = toState[name]();
        const before = f.state;
        assert.equal(f.dispatch('HOME').ok, false, name);
        assert.equal(f.state, before);
    }
});

test('SELECT는 home에서만 허용되고 선택 후 gameId는 바뀌지 않는다', () => {
    for (const name of ['landing', 'adLoading', 'adShowing', 'adFailed', 'ready', 'countdown', 'playing', 'result']) {
        const f = toState[name]();
        assert.equal(f.dispatch('SELECT', { gameId: 'sprout' }).ok, false, name);
        assert.equal(f.gameId, 'fruit', name);
    }
});

test('광고 이용권 1장은 1판만 열고 result에서 START는 거부된다(20회 반복)', () => {
    const f = createFlow();
    for (let i = 0; i < 20; i++) {
        const gameId = i % 2 === 0 ? 'fruit' : 'sprout';
        toReady(f, gameId);
        assert.equal(f.state, 'ready');
        assert.equal(f.dispatch('START', { playId: 'p' + i }).ok, true);
        f.dispatch('COUNTDOWN_DONE');
        const res = f.dispatch('FINISH', { score: i, coins: i });
        assert.equal(res.ok, true);
        assert.deepEqual(res.reward, { playId: 'p' + i, gameId, score: i, coins: i });
        assert.equal(f.state, 'result');
        assert.equal(f.dispatch('START', { playId: 'again' }).ok, false);
        assert.equal(f.state, 'result');
        assert.equal(f.dispatch('HOME').ok, true);
    }
});

test('같은 게임을 result에서 바로 20회 반복해도 gameId가 유지된다', () => {
    const f = createFlow();
    select(f, 'sprout');
    for (let i = 0; i < 20; i++) {
        f.dispatch('REQUEST_AD');
        f.dispatch('GRANTED');
        assert.equal(f.dispatch('START', { playId: 'q' + i }).ok, true);
        f.dispatch('COUNTDOWN_DONE');
        const res = f.dispatch('FINISH', { score: 1, coins: 1 });
        assert.equal(res.reward.gameId, 'sprout');
        assert.equal(f.state, 'result');
    }
});

test('중복 FINISH에도 보상은 한 번만, 광고 요청 연타는 한 번만 처리된다', () => {
    const f = createFlow();
    toReady(f);
    f.dispatch('START', { playId: 'abc' });
    f.dispatch('COUNTDOWN_DONE');
    const first = f.dispatch('FINISH', { score: 4, coins: 4 });
    const second = f.dispatch('FINISH', { score: 4, coins: 4 });
    assert.deepEqual(first.reward, { playId: 'abc', gameId: 'fruit', score: 4, coins: 4 });
    assert.equal(second.ok, false);
    assert.equal(second.reward, undefined);
    assert.equal(f.dispatch('REQUEST_AD').ok, true);
    assert.equal(f.dispatch('REQUEST_AD').ok, false);
    assert.equal(f.state, 'adLoading');
});
