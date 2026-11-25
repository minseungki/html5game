import { CONFIG } from './config.js';
import { createGame, coinsFor } from './game.js';
import { createSproutGame } from './sprout.js';
import { createPots } from './pots.js';
import { createFlow } from './flow.js';
import { createAdService, resolveMockMode } from './ads.js';
import { createView, paintIcon, paintHero } from './view.js';

const FRUIT_NAMES = { orange: '귤', pear: '배' };
// 게임별 이름과 규칙 문구. textContent로만 출력한다
const GAMES = {
    fruit: {
        name: '과일 갈림길',
        rule: '귤과 배가 벨트를 타고 내려와요. 10초 안에 알맞은 바구니로 보내 보세요. 맞히면 1점이에요.',
    },
    sprout: {
        name: '새싹 찾기',
        rule: '화분 16개 중 새싹이 있는 곳을 1.5초 동안 보여 줘요. 가려지면 기억해서 20초 안에 찾아보세요. 새싹을 찾으면 1점, 돌을 고르면 잠시 멈춰요.',
    },
};
const HINTS = { reveal: '외우는 중', find: '찾기', locked: '잠시 멈춤' };
const PICK_MESSAGES = { sprout: '새싹', stone: '돌', cleared: '새싹, 새 판 시작' };
// 광고 실패 사유별 고정 문구. 원본 오류는 노출하지 않는다
const FAIL_MESSAGES = {
    timeout: '광고를 불러오는 시간이 너무 오래 걸렸어요.',
    'no-fill': '지금은 보여 드릴 광고가 없어요.',
    unsupported: '이 환경에서는 광고를 지원하지 않아요.',
    script: '광고를 불러오지 못했어요. 네트워크를 확인해 주세요.',
    closed: '광고를 끝까지 보지 않아 게임을 열 수 없어요.',
    'visible-failed': '광고를 표시하지 못했어요.',
    'api-error': '광고를 시작하지 못했어요.',
};
const FAIL_DEFAULT = '광고를 보지 못했어요.';

const $ = (id) => document.getElementById(id);
const screens = {
    home: $('screen-home'),
    landing: $('screen-landing'),
    ad: $('screen-ad'),
    failed: $('screen-failed'),
    countdown: $('screen-countdown'),
    game: $('screen-game'),
    sprout: $('screen-sprout'),
    result: $('screen-result'),
};
const STATE_SCREEN = {
    home: 'home',
    landing: 'landing',
    adLoading: 'ad',
    adShowing: 'ad',
    ready: 'ad',
    adFailed: 'failed',
    countdown: 'countdown',
    playing: 'game',
    result: 'result',
};
const FOCUS_TARGET = {
    home: 'home-title',
    landing: 'landing-title',
    ad: 'ad-title',
    failed: 'failed-title',
    countdown: 'countdown-title',
    game: 'game-title',
    sprout: 'sprout-title',
    result: 'result-title',
};

const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const flow = createFlow();
const view = createView($('game-canvas'), { reducedMotion: reducedQuery.matches });
const ads = createAdService({
    win: window,
    mockMode: resolveMockMode({ hostname: location.hostname, search: location.search }),
});
const now = () => performance.now();

let game = null;
let rafId = 0;
let endTimer = 0;
let countTimer = 0;
let revealTimer = 0;
let revealEnd = 0;

const pots = createPots({
    root: $('pots'),
    doc: document,
    paint: paintIcon,
    onPick: handleSproutPick,
});

function makePlayId() {
    if (crypto.randomUUID) {
        return crypto.randomUUID();
    }
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function stopTimers() {
    cancelAnimationFrame(rafId);
    clearTimeout(endTimer);
    clearTimeout(countTimer);
    clearTimeout(revealTimer);
    rafId = 0;
    revealTimer = 0;
    endTimer = 0;
    countTimer = 0;
}

function go(type, payload) {
    const res = flow.dispatch(type, payload);
    if (res.ok) {
        enter(res);
    }
    return res;
}

// playing만 선택한 게임에 따라 화면이 갈린다
function screenOf(state) {
    if (state === 'playing') {
        return flow.gameId === 'sprout' ? 'sprout' : 'game';
    }
    return STATE_SCREEN[state];
}

function showScreen(state) {
    const name = screenOf(state);
    Object.keys(screens).forEach((key) => {
        screens[key].hidden = key !== name;
    });
    if (state === 'adShowing' || state === 'ready') {
        // 광고가 화면을 덮고 있을 수 있으므로 초점을 옮기지 않는다. ready의 초점은 광고 닫힘 때 옮긴다
        return;
    }
    $(FOCUS_TARGET[name]).focus({ preventScroll: true });
}

function enter(res) {
    const state = flow.state;
    stopTimers();
    $('btn-start').hidden = state !== 'ready';
    if (state === 'landing') {
        const info = GAMES[flow.gameId];
        $('landing-title').textContent = info.name;
        $('landing-text').textContent = info.rule;
    } else if (state === 'adLoading') {
        $('ad-title').textContent = '광고를 불러오는 중';
        $('ad-text').textContent = '잠시만 기다려 주세요.';
    } else if (state === 'adShowing') {
        $('ad-title').textContent = '광고 시청 중';
        $('ad-text').textContent = '광고를 끝까지 보면 게임을 시작할 수 있어요.';
    } else if (state === 'ready') {
        $('ad-title').textContent = '광고 시청 완료';
        $('ad-text').textContent = '준비되면 게임을 시작하세요.';
    } else if (state === 'adFailed') {
        $('failed-text').textContent = FAIL_MESSAGES[flow.reason] || FAIL_DEFAULT;
    } else if (state === 'countdown') {
        prepareRound();
    }
    // 결과 값은 초점 이동 전에 채워 제목 설명이 최신 값을 읽게 한다
    if (state === 'result') {
        $('result-game').textContent = GAMES[res.reward.gameId].name;
        $('result-score').textContent = String(res.reward.score);
        $('result-coins').textContent = String(res.reward.coins);
    }
    showScreen(state);
    // 화면이 보인 뒤에 크기를 재고 그리거나 값을 갱신한다
    if (state === 'home') {
        paintHome();
    } else if (state === 'landing') {
        paintHero($('hero-canvas'), flow.gameId);
    } else if (state === 'countdown') {
        if (flow.gameId === 'sprout') {
            paintIcon($('count-icon-left'), 'sprout');
            paintIcon($('count-icon-right'), 'stone');
        } else {
            paintIcon($('count-icon-left'), game.rule.left);
            paintIcon($('count-icon-right'), game.rule.right);
        }
        startCountdown();
    } else if (state === 'playing') {
        startGame();
    } else if (state === 'result') {
        window.dispatchEvent(new CustomEvent('game:reward', { detail: res.reward }));
    }
}

function requestAd() {
    const res = go('REQUEST_AD');
    if (!res.ok) {
        return;
    }
    ads.request({
        onVisible: () => go('VISIBLE'),
        onGranted: () => go('GRANTED'),
        onClosed: () => {
            if (flow.state === 'ready') {
                $('btn-start').focus({ preventScroll: true });
            }
        },
        onFailed: (reason) => go('FAILED', { reason }),
    });
}

// 판 기준은 카운트다운 시작 때 정해 미리 보여 주고, 시간은 playing 진입 때 시작한다
function prepareRound() {
    if (flow.gameId === 'sprout') {
        // 배치는 start에서 만들고, 카운트다운에는 화분을 모두 닫아 둔다
        game = createSproutGame();
        pots.render(game.cells(now()));
        $('count-rule-left').textContent = '새싹을 찾아요';
        $('count-rule-right').textContent = '돌은 피해요';
        return;
    }
    game = createGame();
    view.setReducedMotion(reducedQuery.matches);
    const left = FRUIT_NAMES[game.rule.left];
    const right = FRUIT_NAMES[game.rule.right];
    $('count-rule-left').textContent = `왼쪽: ${left}`;
    $('count-rule-right').textContent = `오른쪽: ${right}`;
    $('rule-text').textContent = `${left} ← → ${right}`;
    $('btn-left').setAttribute('aria-label', `왼쪽 (${left})`);
    $('btn-right').setAttribute('aria-label', `오른쪽 (${right})`);
}

function startCountdown() {
    let n = CONFIG.countdownSeconds;
    $('count-num').textContent = String(n);
    const tick = () => {
        n -= 1;
        if (n <= 0) {
            go('COUNTDOWN_DONE');
            return;
        }
        $('count-num').textContent = String(n);
        countTimer = setTimeout(tick, 1000);
    };
    countTimer = setTimeout(tick, 1000);
}

function startGame() {
    if (flow.gameId === 'sprout') {
        startSprout();
        return;
    }
    // 게임 화면만 보이는 상태에서 크기를 잡는다
    view.resize();
    view.refreshColors();
    paintIcon($('icon-left'), game.rule.left);
    paintIcon($('icon-right'), game.rule.right);
    game.start(now());
    updateHud();
    endTimer = setTimeout(checkEnd, game.remainingMs(now()));
    rafId = requestAnimationFrame(frame);
}

function setText(el, value) {
    if (el.textContent !== value) {
        el.textContent = value;
    }
}

function renderSprout(t) {
    setText($('sprout-time'), (game.remainingMs(t) / 1000).toFixed(1));
    setText($('sprout-score'), String(game.score));
    const phase = game.phase(t);
    setText($('sprout-hint'), HINTS[phase]);
    pots.render(game.cells(t), phase === 'reveal');
}

// 공개 종료는 rAF가 멈춰도 놓치지 않도록 절대 시각으로 한 번 더 확인한다
function scheduleReveal(t) {
    revealEnd = t + CONFIG.sprout.revealMs;
    clearTimeout(revealTimer);
    revealTimer = setTimeout(onReveal, CONFIG.sprout.revealMs);
}

function onReveal() {
    if (flow.state !== 'playing' || flow.gameId !== 'sprout') {
        return;
    }
    const t = now();
    if (t < revealEnd) {
        revealTimer = setTimeout(onReveal, revealEnd - t + 1);
        return;
    }
    renderSprout(t);
}

function startSprout() {
    setText($('sprout-status'), '');
    const t = now();
    game.start(t);
    scheduleReveal(t);
    renderSprout(t);
    endTimer = setTimeout(checkEnd, game.remainingMs(t));
    rafId = requestAnimationFrame(frame);
}

function handleSproutPick(index) {
    if (flow.state !== 'playing' || flow.gameId !== 'sprout') {
        return;
    }
    const t = now();
    // 이미 끝난 공개 그림이 남은 채 입력되지 않게 먼저 갱신한다
    renderSprout(t);
    const result = game.pick(index, t);
    if (result === 'ignored') {
        return;
    }
    if (result === 'cleared') {
        scheduleReveal(t);
    }
    renderSprout(t);
    $('sprout-status').textContent = `${index + 1}번 화분, ${PICK_MESSAGES[result]}`;
}

function updateHud() {
    $('hud-time').textContent = (game.remainingMs(now()) / 1000).toFixed(1);
    $('hud-score').textContent = String(game.score);
}

function checkEnd() {
    if (flow.state !== 'playing') {
        return;
    }
    if (game.isFinished(now())) {
        finish();
    } else {
        endTimer = setTimeout(checkEnd, game.remainingMs(now()) + 1);
    }
}

function frame() {
    if (flow.state !== 'playing') {
        return;
    }
    if (game.isFinished(now())) {
        finish();
        return;
    }
    if (flow.gameId === 'sprout') {
        renderSprout(now());
    } else {
        updateHud();
        view.render(game, now());
    }
    rafId = requestAnimationFrame(frame);
}

function finish() {
    const score = game.score;
    go('FINISH', { score, coins: coinsFor(score) });
}

function handleInput(side) {
    if (flow.state !== 'playing' || flow.gameId !== 'fruit') {
        return;
    }
    const t = now();
    const front = game.queue[0];
    const result = game.input(side, t);
    if (result === 'correct') {
        view.fly(front, side, t);
    } else if (result === 'wrong') {
        view.shake(t);
    }
}

['left', 'right'].forEach((side) => {
    const btn = $('btn-' + side);
    btn.addEventListener('pointerdown', () => handleInput(side));
    // 키보드·보조기기 click(detail 0)만 처리해 터치 이중 입력을 막는다
    // 누르고 있는 Enter의 반복 입력은 막는다
    btn.addEventListener('keydown', (event) => {
        if (event.repeat && flow.state === 'playing') {
            event.preventDefault();
        }
    });
    btn.addEventListener('click', (event) => {
        if (event.detail === 0) {
            handleInput(side);
        }
    });
});

window.addEventListener('keydown', (event) => {
    if (event.repeat || flow.state !== 'playing' || flow.gameId !== 'fruit') {
        return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        handleInput(event.key === 'ArrowLeft' ? 'left' : 'right');
    }
});

window.addEventListener('resize', () => {
    if (flow.state !== 'playing') {
        return;
    }
    if (flow.gameId === 'sprout') {
        pots.repaint();
    } else {
        view.resize();
    }
});

function paintHome() {
    paintHero($('home-icon-fruit'), 'fruit');
    paintIcon($('home-icon-sprout'), 'sprout');
}

$('btn-game-fruit').addEventListener('click', () => go('SELECT', { gameId: 'fruit' }));
$('btn-game-sprout').addEventListener('click', () => go('SELECT', { gameId: 'sprout' }));
['landing', 'failed', 'result'].forEach((name) => {
    $('btn-' + name + '-home').addEventListener('click', () => go('HOME'));
});
$('btn-ad-start').addEventListener('click', requestAd);
$('btn-retry').addEventListener('click', requestAd);
$('btn-again').addEventListener('click', requestAd);
$('btn-start').addEventListener('click', () => go('START', { playId: makePlayId() }));

paintHome();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!screens.home.hidden) {
        paintHome();
    }
    if (!screens.landing.hidden) {
        paintHero($('hero-canvas'), flow.gameId);
    }
    if (flow.state === 'playing' && flow.gameId === 'sprout') {
        pots.repaint();
    }
});
