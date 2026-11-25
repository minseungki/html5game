import { CONFIG } from './config.js';

const MOCK_MODES = ['mock', 'mock-close', 'mock-nofill'];
const MOCK_HOSTS = ['localhost', '127.0.0.1'];
const MOCK_STEP_MS = 300;

// 모의 광고는 hostname이 정확히 localhost/127.0.0.1일 때만 켠다
export function resolveMockMode({ hostname, search }) {
    if (!MOCK_HOSTS.includes(hostname)) {
        return null;
    }
    const value = new URLSearchParams(search || '').get('ad');
    return MOCK_MODES.includes(value) ? value : null;
}

export function createScriptLoader(doc) {
    return (url) => new Promise((resolve, reject) => {
        const el = doc.createElement('script');
        el.async = true;
        el.crossOrigin = 'anonymous';
        el.src = url;
        el.onload = () => resolve();
        el.onerror = () => {
            el.remove();
            reject(new Error('script'));
        };
        doc.head.appendChild(el);
    });
}

const EVENTS = [
    'slotRenderEnded',
    'rewardedSlotReady',
    'rewardedSlotGranted',
    'rewardedSlotVideoCompleted',
    'rewardedSlotClosed',
];

export function createAdService({
    win,
    loadScript = createScriptLoader(win && win.document),
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (id) => clearTimeout(id),
    mockMode = null,
    config = CONFIG,
} = {}) {
    let current = null;
    let scriptPromise = null;
    let enabled = false;
    const registered = new Set();

    function ensureScript() {
        if (!scriptPromise) {
            // 실패하면 캐시를 버려 다시 시도가 실제로 재로드되게 한다
            scriptPromise = loadScript(config.gptUrl).catch((error) => {
                scriptPromise = null;
                throw error;
            });
        }
        return scriptPromise;
    }

    function addTimer(att, fn, ms) {
        const id = setTimer(() => {
            att.timers.delete(id);
            fn();
        }, ms);
        att.timers.add(id);
        return id;
    }

    function clearTimers(att) {
        att.timers.forEach((id) => clearTimer(id));
        att.timers.clear();
    }

    function destroy(att) {
        if (!att.slot || att.destroyed) {
            return;
        }
        att.destroyed = true;
        if (att.mock) {
            return;
        }
        try {
            win.googletag.destroySlots([att.slot]);
        } catch (error) {
            // 정리 실패는 다음 요청을 막지 않는다
        }
    }

    function fail(att, reason) {
        if (att.settled) {
            return;
        }
        att.settled = true;
        clearTimers(att);
        destroy(att);
        if (current === att) {
            current = null;
        }
        att.handlers.onFailed(reason);
    }

    function grant(att) {
        att.settled = true;
        att.granted = true;
        clearTimers(att);
        // 시청 중에는 슬롯을 파괴하지 않고 Closed에서 정리한다. 이미 닫혔다면 지금 정리
        if (att.closed) {
            destroy(att);
            if (current === att) {
                current = null;
            }
        }
        att.handlers.onGranted();
        if (att.closed) {
            notifyClosed(att);
        }
    }

    // 보상 확정 뒤 광고가 닫혔을 때 1회만 알린다
    function notifyClosed(att) {
        if (att.closeNotified) {
            return;
        }
        att.closeNotified = true;
        if (att.handlers.onClosed) {
            att.handlers.onClosed();
        }
    }

    function handleEvent(name, event) {
        const att = current;
        if (!att || att.slot !== event.slot) {
            return;
        }
        if (name === 'slotRenderEnded') {
            if (event.isEmpty && !att.settled && !att.visible) {
                fail(att, 'no-fill');
            }
        } else if (name === 'rewardedSlotReady') {
            if (att.settled || att.ready) {
                return;
            }
            att.ready = true;
            let ok = false;
            try {
                ok = event.makeRewardedVisible() === true;
            } catch (error) {
                ok = false;
            }
            if (!ok) {
                fail(att, 'visible-failed');
                return;
            }
            att.visible = true;
            // 15초 제한은 표시 성공까지만. 시청 중에는 해제한다
            if (att.requestTimer !== null) {
                clearTimer(att.requestTimer);
                att.timers.delete(att.requestTimer);
                att.requestTimer = null;
            }
            att.handlers.onVisible();
        } else if (name === 'rewardedSlotGranted') {
            if (att.settled) {
                return;
            }
            grant(att);
        } else if (name === 'rewardedSlotClosed') {
            if (att.granted) {
                destroy(att);
                if (current === att) {
                    current = null;
                }
                notifyClosed(att);
            } else if (!att.settled && !att.closed) {
                att.closed = true;
                addTimer(att, () => fail(att, 'closed'), config.closedGraceMs);
            }
        }
        // rewardedSlotVideoCompleted는 보상 조건이 아니므로 무시한다
    }

    function ensureListeners(g) {
        const pubads = g.pubads();
        EVENTS.forEach((name) => {
            if (!registered.has(name)) {
                pubads.addEventListener(name, (event) => handleEvent(name, event));
                registered.add(name);
            }
        });
        if (!enabled) {
            g.enableServices();
            enabled = true;
        }
    }

    function defineAndDisplay(att) {
        if (att.settled) {
            return;
        }
        try {
            const g = win.googletag;
            const slot = g.defineOutOfPageSlot(config.adUnitPath, g.enums.OutOfPageFormat.REWARDED);
            if (!slot) {
                fail(att, 'unsupported');
                return;
            }
            att.slot = slot;
            slot.addService(g.pubads());
            ensureListeners(g);
            g.display(slot);
        } catch (error) {
            fail(att, 'api-error');
        }
    }

    function runMock(att) {
        att.mock = true;
        att.slot = { mock: true };
        const emit = (name, extra = {}) => handleEvent(name, { slot: att.slot, ...extra });
        addTimer(att, () => {
            if (mockMode === 'mock-nofill') {
                emit('slotRenderEnded', { isEmpty: true });
                return;
            }
            emit('rewardedSlotReady', { makeRewardedVisible: () => true });
            if (att.settled || !att.visible) {
                return;
            }
            addTimer(att, () => {
                if (mockMode === 'mock') {
                    emit('rewardedSlotGranted');
                    // Granted 뒤 닫힘 이벤트로 정리 경로까지 같이 탄다
                    addTimer(att, () => emit('rewardedSlotClosed'), MOCK_STEP_MS);
                } else {
                    emit('rewardedSlotClosed');
                }
            }, MOCK_STEP_MS);
        }, MOCK_STEP_MS);
    }

    return {
        // 요청을 받으면 true, 진행 중이라 거부하면 false
        request(handlers) {
            if (current && !current.settled) {
                return false;
            }
            // Granted 뒤 Closed가 오지 않은 슬롯은 다음 요청 전에 파괴한다
            if (current) {
                destroy(current);
                current = null;
            }
            const att = {
                handlers,
                slot: null,
                timers: new Set(),
                requestTimer: null,
                settled: false,
                ready: false,
                visible: false,
                granted: false,
                closed: false,
                closeNotified: false,
                destroyed: false,
                mock: false,
            };
            current = att;
            att.requestTimer = addTimer(att, () => fail(att, 'timeout'), config.adRequestTimeoutMs);
            if (mockMode) {
                runMock(att);
                return true;
            }
            win.googletag = win.googletag || {};
            win.googletag.cmd = win.googletag.cmd || [];
            ensureScript().then(
                () => {
                    if (att.settled) {
                        return;
                    }
                    win.googletag.cmd.push(() => defineAndDisplay(att));
                },
                () => fail(att, 'script'),
            );
            return true;
        },
    };
}
