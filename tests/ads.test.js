import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdService, resolveMockMode } from '../src/ads.js';
import { CONFIG } from '../src/config.js';

function fakeTimers() {
    let now = 0;
    let seq = 0;
    const active = new Map();
    return {
        setTimer(fn, ms) {
            const id = ++seq;
            active.set(id, { fn, at: now + ms });
            return id;
        },
        clearTimer(id) {
            active.delete(id);
        },
        advance(ms) {
            const target = now + ms;
            for (;;) {
                const due = [...active.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
                if (!due) {
                    break;
                }
                active.delete(due[0]);
                now = due[1].at;
                due[1].fn();
            }
            now = target;
        },
        get count() {
            return active.size;
        },
    };
}

// cmd는 기본 즉시 실행. manual이면 test가 flush한다
function fakeGpt({ manual = false, nullSlot = false, throwOnDefine = false } = {}) {
    const listeners = {};
    const calls = { define: [], addService: 0, display: 0, enable: 0, destroyed: [], addListener: {} };
    const queue = [];
    const slots = [];
    const g = {
        calls,
        slots,
        enums: { OutOfPageFormat: { REWARDED: 'REWARDED' } },
        cmd: {
            push(fn) {
                if (manual) {
                    queue.push(fn);
                } else {
                    fn();
                }
            },
        },
        defineOutOfPageSlot(unit, format) {
            calls.define.push([unit, format]);
            if (throwOnDefine) {
                throw new Error('boom');
            }
            if (nullSlot) {
                return null;
            }
            const slot = { addService: () => { calls.addService++; } };
            slots.push(slot);
            return slot;
        },
        pubads: () => ({
            addEventListener(name, fn) {
                calls.addListener[name] = (calls.addListener[name] || 0) + 1;
                listeners[name] = fn;
            },
        }),
        enableServices: () => { calls.enable++; },
        display: () => { calls.display++; },
        destroySlots: (list) => { calls.destroyed.push(...list); },
        emit(name, event) {
            listeners[name](event);
        },
        flush() {
            queue.splice(0).forEach((fn) => fn());
        },
    };
    return g;
}

function setup(opts = {}) {
    const timers = fakeTimers();
    const g = opts.gpt || fakeGpt();
    const win = { googletag: g };
    let loads = 0;
    const inner = opts.loadScript || (async () => {});
    const service = createAdService({
        win,
        loadScript: async (url) => {
            loads++;
            return inner(url);
        },
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
        mockMode: opts.mockMode || null,
    });
    const log = { visible: 0, granted: 0, closed: 0, failed: [] };
    const handlers = {
        onVisible: () => { log.visible++; },
        onGranted: () => { log.granted++; },
        onClosed: () => { log.closed++; },
        onFailed: (r) => { log.failed.push(r); },
    };
    return { service, g, timers, log, handlers, get loads() { return loads; } };
}

const tick = () => new Promise((r) => setImmediate(r));
const ready = (g, slot, visible = true) => g.emit('rewardedSlotReady', { slot, makeRewardedVisible: () => visible });

test('올바른 유닛과 REWARDED로 define, addService, display가 각 1회, ready에서 makeRewardedVisible 호출, 버튼 전에는 로더 미호출', async () => {
    const s = setup();
    assert.equal(s.loads, 0);
    assert.equal(s.service.request(s.handlers), true);
    await tick();
    assert.deepEqual(s.g.calls.define, [[CONFIG.adUnitPath, 'REWARDED']]);
    assert.equal(s.g.calls.addService, 1);
    assert.equal(s.g.calls.display, 1);
    assert.equal(s.loads, 1);
    let called = 0;
    s.g.emit('rewardedSlotReady', { slot: s.g.slots[0], makeRewardedVisible: () => { called++; return true; } });
    assert.equal(called, 1);
    assert.equal(s.log.visible, 1);
});

test('Granted 시 보상 1회, Granted 후 Closed에서도 유지되고 destroySlots, 중복 Granted도 1회', async () => {
    const s = setup();
    s.service.request(s.handlers);
    await tick();
    const slot = s.g.slots[0];
    ready(s.g, slot);
    s.g.emit('rewardedSlotGranted', { slot });
    s.g.emit('rewardedSlotGranted', { slot });
    assert.equal(s.log.granted, 1);
    assert.equal(s.g.calls.destroyed.length, 0);
    s.g.emit('rewardedSlotClosed', { slot });
    assert.equal(s.log.granted, 1);
    assert.deepEqual(s.g.calls.destroyed, [slot]);
    assert.deepEqual(s.log.failed, []);
    assert.equal(s.timers.count, 0);
});

test('Closed 먼저면 1초 안 Granted는 보상, 경과 후 미지급 1회와 destroySlots, 늦은 Granted는 무시', async () => {
    const a = setup();
    a.service.request(a.handlers);
    await tick();
    ready(a.g, a.g.slots[0]);
    a.g.emit('rewardedSlotClosed', { slot: a.g.slots[0] });
    a.timers.advance(CONFIG.closedGraceMs - 1);
    a.g.emit('rewardedSlotGranted', { slot: a.g.slots[0] });
    assert.equal(a.log.granted, 1);
    assert.equal(a.g.calls.destroyed.length, 1);
    assert.equal(a.timers.count, 0);

    const b = setup();
    b.service.request(b.handlers);
    await tick();
    const slot = b.g.slots[0];
    ready(b.g, slot);
    b.g.emit('rewardedSlotClosed', { slot });
    b.timers.advance(CONFIG.closedGraceMs);
    assert.deepEqual(b.log.failed, ['closed']);
    assert.deepEqual(b.g.calls.destroyed, [slot]);
    b.g.emit('rewardedSlotGranted', { slot });
    assert.equal(b.log.granted, 0);
    assert.equal(b.log.failed.length, 1);
});

test('VideoCompleted만, 또는 VideoCompleted와 Closed만으로는 보상되지 않는다', async () => {
    const s = setup();
    s.service.request(s.handlers);
    await tick();
    const slot = s.g.slots[0];
    ready(s.g, slot);
    s.g.emit('rewardedSlotVideoCompleted', { slot });
    assert.equal(s.log.granted, 0);
    s.g.emit('rewardedSlotClosed', { slot });
    s.timers.advance(CONFIG.closedGraceMs);
    assert.equal(s.log.granted, 0);
    assert.deepEqual(s.log.failed, ['closed']);
});

test('null 슬롯, isEmpty, 스크립트 실패, 15초 초과, makeRewardedVisible false 및 예외는 각각 실패 1회와 정리', async () => {
    // null 슬롯
    let s = setup({ gpt: fakeGpt({ nullSlot: true }) });
    s.service.request(s.handlers);
    await tick();
    assert.deepEqual(s.log.failed, ['unsupported']);
    assert.equal(s.timers.count, 0);

    // define 예외
    s = setup({ gpt: fakeGpt({ throwOnDefine: true }) });
    s.service.request(s.handlers);
    await tick();
    assert.deepEqual(s.log.failed, ['api-error']);

    // isEmpty
    s = setup();
    s.service.request(s.handlers);
    await tick();
    s.g.emit('slotRenderEnded', { slot: s.g.slots[0], isEmpty: true });
    assert.deepEqual(s.log.failed, ['no-fill']);
    assert.equal(s.g.calls.destroyed.length, 1);
    assert.equal(s.timers.count, 0);

    // 스크립트 실패
    s = setup({ loadScript: async () => { throw new Error('x'); } });
    s.service.request(s.handlers);
    await tick();
    assert.deepEqual(s.log.failed, ['script']);
    assert.equal(s.timers.count, 0);

    // 시간 초과
    s = setup();
    s.service.request(s.handlers);
    await tick();
    s.timers.advance(CONFIG.adRequestTimeoutMs);
    assert.deepEqual(s.log.failed, ['timeout']);
    assert.equal(s.g.calls.destroyed.length, 1);
    assert.equal(s.timers.count, 0);

    // makeRewardedVisible false / 예외
    for (const fn of [() => false, () => { throw new Error('x'); }]) {
        s = setup();
        s.service.request(s.handlers);
        await tick();
        const slot = s.g.slots[0];
        s.g.emit('rewardedSlotReady', { slot, makeRewardedVisible: fn });
        assert.deepEqual(s.log.failed, ['visible-failed']);
        assert.equal(s.g.calls.destroyed.length, 1);
        assert.equal(s.log.visible, 0);
    }
});

test('광고가 보인 뒤에는 15초가 지나도 시간 초과가 나지 않는다', async () => {
    const s = setup();
    s.service.request(s.handlers);
    await tick();
    ready(s.g, s.g.slots[0]);
    s.timers.advance(CONFIG.adRequestTimeoutMs * 4);
    assert.deepEqual(s.log.failed, []);
    s.g.emit('rewardedSlotGranted', { slot: s.g.slots[0] });
    assert.equal(s.log.granted, 1);
});

test('시간 초과 후 늦은 cmd 콜백은 슬롯을 만들지 않고, 스크립트 실패 후 재시도는 다시 로드한다', async () => {
    const gpt = fakeGpt({ manual: true });
    const s = setup({ gpt });
    s.service.request(s.handlers);
    await tick();
    s.timers.advance(CONFIG.adRequestTimeoutMs);
    gpt.flush();
    assert.equal(gpt.calls.define.length, 0);
    assert.deepEqual(s.log.failed, ['timeout']);

    let attempts = 0;
    const r = setup({ loadScript: async () => { attempts++; if (attempts === 1) { throw new Error('x'); } } });
    r.service.request(r.handlers);
    await tick();
    assert.deepEqual(r.log.failed, ['script']);
    r.service.request(r.handlers);
    await tick();
    // 외부 loadScript가 2번 호출되어야 한다(setup의 loads는 래퍼 호출 수)
    assert.equal(attempts, 2);
    assert.equal(r.g.calls.define.length, 1);
});

test('다른 slot과 이전 시도 slot의 이벤트는 무시되고, 진행 중 두 번째 요청은 거부된다', async () => {
    const s = setup();
    assert.equal(s.service.request(s.handlers), true);
    assert.equal(s.service.request(s.handlers), false);
    await tick();
    const first = s.g.slots[0];
    s.g.emit('rewardedSlotGranted', { slot: { other: true } });
    assert.equal(s.log.granted, 0);
    s.g.emit('slotRenderEnded', { slot: first, isEmpty: true });
    assert.deepEqual(s.log.failed, ['no-fill']);

    assert.equal(s.service.request(s.handlers), true);
    await tick();
    s.g.emit('rewardedSlotGranted', { slot: first });
    assert.equal(s.log.granted, 0);
    s.g.emit('rewardedSlotGranted', { slot: s.g.slots[1] });
    assert.equal(s.log.granted, 1);
});

test('20회 반복 후 리스너 종류별 1회, enableServices 1회, 슬롯 모두 파괴, 타이머 0', async () => {
    const s = setup();
    for (let i = 0; i < 20; i++) {
        assert.equal(s.service.request(s.handlers), true);
        await tick();
        const slot = s.g.slots[i];
        ready(s.g, slot);
        s.g.emit('rewardedSlotGranted', { slot });
        // 홀수 회차는 Closed 없이 두어 다음 요청 전 파괴를 확인한다
        if (i % 2 === 0) {
            s.g.emit('rewardedSlotClosed', { slot });
        }
    }
    s.g.emit('rewardedSlotClosed', { slot: s.g.slots[19] });
    assert.equal(s.log.granted, 20);
    Object.values(s.g.calls.addListener).forEach((n) => assert.equal(n, 1));
    assert.equal(s.g.calls.enable, 1);
    assert.equal(s.g.slots.length, 20);
    assert.equal(s.g.calls.destroyed.length, 20);
    assert.equal(new Set(s.g.calls.destroyed).size, 20);
    assert.equal(s.timers.count, 0);
});

test('localhost와 127.0.0.1에서만 모의 모드가 켜지고 그 외는 null', () => {
    assert.equal(resolveMockMode({ hostname: 'localhost', search: '?ad=mock' }), 'mock');
    assert.equal(resolveMockMode({ hostname: '127.0.0.1', search: '?ad=mock-close' }), 'mock-close');
    assert.equal(resolveMockMode({ hostname: 'localhost', search: '?ad=mock-nofill' }), 'mock-nofill');
    for (const hostname of ['example.com', 'localhost.evil.com', '', undefined, 'evil-localhost']) {
        assert.equal(resolveMockMode({ hostname, search: '?ad=mock' }), null);
    }
    assert.equal(resolveMockMode({ hostname: 'localhost', search: '?ad=other' }), null);
    assert.equal(resolveMockMode({ hostname: 'localhost', search: '' }), null);
});

test('mock은 보상, mock-close는 보상 없는 실패, mock-nofill은 no-fill 실패', () => {
    const run = (mockMode) => {
        const s = setup({ mockMode });
        s.service.request(s.handlers);
        s.timers.advance(5000);
        return s;
    };
    let s = run('mock');
    assert.equal(s.log.granted, 1);
    assert.equal(s.log.visible, 1);
    assert.deepEqual(s.log.failed, []);
    assert.equal(s.timers.count, 0);
    s = run('mock-close');
    assert.equal(s.log.granted, 0);
    assert.deepEqual(s.log.failed, ['closed']);
    assert.equal(s.timers.count, 0);
    s = run('mock-nofill');
    assert.equal(s.log.granted, 0);
    assert.deepEqual(s.log.failed, ['no-fill']);
    assert.equal(s.timers.count, 0);
    assert.equal(s.loads, 0);
});

test('onClosed는 Granted 뒤 Closed에서만 1회 호출된다(순서별)', async () => {
    // Granted만: 호출 없음, 이후 Closed: 1회, 중복 Closed: 여전히 1회
    let s = setup();
    s.service.request(s.handlers);
    await tick();
    let slot = s.g.slots[0];
    ready(s.g, slot);
    s.g.emit('rewardedSlotGranted', { slot });
    assert.equal(s.log.closed, 0);
    s.g.emit('rewardedSlotClosed', { slot });
    s.g.emit('rewardedSlotClosed', { slot });
    assert.equal(s.log.closed, 1);

    // Closed 먼저, 유예 안 Granted: onGranted 다음에 onClosed 1회
    s = setup();
    const order = [];
    const h = {
        ...s.handlers,
        onGranted: () => order.push('granted'),
        onClosed: () => order.push('closed'),
    };
    s.service.request(h);
    await tick();
    slot = s.g.slots[0];
    ready(s.g, slot);
    s.g.emit('rewardedSlotClosed', { slot });
    assert.deepEqual(order, []);
    s.g.emit('rewardedSlotGranted', { slot });
    assert.deepEqual(order, ['granted', 'closed']);

    // Closed만(보상 없음): onClosed 호출 없음
    s = setup();
    s.service.request(s.handlers);
    await tick();
    slot = s.g.slots[0];
    ready(s.g, slot);
    s.g.emit('rewardedSlotClosed', { slot });
    s.timers.advance(CONFIG.closedGraceMs);
    assert.equal(s.log.closed, 0);
    assert.deepEqual(s.log.failed, ['closed']);
});

test('mock 보상 광고는 Granted 뒤 onClosed를 1회 호출한다', () => {
    const s = setup({ mockMode: 'mock' });
    s.service.request(s.handlers);
    s.timers.advance(5000);
    assert.equal(s.log.granted, 1);
    assert.equal(s.log.closed, 1);
    const c = setup({ mockMode: 'mock-close' });
    c.service.request(c.handlers);
    c.timers.advance(5000);
    assert.equal(c.log.closed, 0);
});
