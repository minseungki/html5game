// 화면 상태 전이만 정의한다. ready는 GRANTED로만 도달한다
const GAME_IDS = ['fruit', 'sprout'];
const TRANSITIONS = {
    home: { SELECT: 'landing' },
    landing: { REQUEST_AD: 'adLoading', HOME: 'home' },
    adLoading: { VISIBLE: 'adShowing', GRANTED: 'ready', FAILED: 'adFailed' },
    adShowing: { GRANTED: 'ready', FAILED: 'adFailed' },
    adFailed: { REQUEST_AD: 'adLoading', HOME: 'home' },
    ready: { START: 'countdown' },
    countdown: { COUNTDOWN_DONE: 'playing' },
    playing: { FINISH: 'result' },
    result: { REQUEST_AD: 'adLoading', HOME: 'home' },
};

export function createFlow() {
    let state = 'home';
    let reason = null;
    let playId = null;
    let gameId = null;

    return {
        get state() {
            return state;
        },
        get reason() {
            return reason;
        },
        get gameId() {
            return gameId;
        },
        // { ok, state, reward? } 반환. 허용되지 않은 전이는 ok=false
        dispatch(type, payload = {}) {
            const next = (TRANSITIONS[state] || {})[type];
            if (!next) {
                return { ok: false, state };
            }
            // 게임은 SELECT로만 정해진다. 잘못된 값이면 상태를 바꾸지 않는다
            if (type === 'SELECT' && !GAME_IDS.includes(payload.gameId)) {
                return { ok: false, state };
            }
            state = next;
            if (type === 'SELECT') {
                gameId = payload.gameId;
            }
            if (type === 'HOME') {
                gameId = null;
            }
            if (type === 'FAILED') {
                reason = payload.reason || 'unknown';
            }
            if (type === 'START') {
                playId = payload.playId;
            }
            if (type === 'FINISH') {
                return { ok: true, state, reward: { playId, gameId, score: payload.score, coins: payload.coins } };
            }
            return { ok: true, state };
        },
    };
}
