import { CONFIG } from './config.js';

// 시간은 절대 시각(now)만 받아 계산한다. 정답 배열은 밖으로 내보내지 않는다
export function createSproutGame({ random = Math.random, config = CONFIG } = {}) {
    const cfg = config.sprout;
    let endAt = null;
    let round = 0;
    let score = 0;
    let revealUntil = 0;
    let lockedUntil = 0;
    let sprouts = [];
    let opened = [];

    function newRound(now) {
        round += 1;
        const count = Math.min(cfg.startSprouts + round - 1, cfg.maxSprouts);
        // Fisher-Yates
        const order = Array.from({ length: cfg.potCount }, (_, i) => i);
        for (let i = order.length - 1; i > 0; i--) {
            const j = Math.min(i, Math.floor(random() * (i + 1)));
            [order[i], order[j]] = [order[j], order[i]];
        }
        sprouts = Array.from({ length: cfg.potCount }, () => false);
        order.slice(0, count).forEach((i) => {
            sprouts[i] = true;
        });
        opened = Array.from({ length: cfg.potCount }, () => false);
        revealUntil = now + cfg.revealMs;
    }

    return {
        get score() {
            return score;
        },
        get round() {
            return round;
        },
        start(now) {
            endAt = now + cfg.durationMs;
            newRound(now);
        },
        remainingMs(now) {
            if (endAt === null) {
                return cfg.durationMs;
            }
            return Math.max(0, endAt - now);
        },
        isFinished(now) {
            return endAt !== null && now >= endAt;
        },
        // 'reveal' | 'locked' | 'find'
        phase(now) {
            if (now < revealUntil) {
                return 'reveal';
            }
            return now < lockedUntil ? 'locked' : 'find';
        },
        // 칸별 'hidden' | 'sprout' | 'stone'
        cells(now) {
            const revealing = endAt !== null && now < revealUntil;
            return sprouts.length === 0
                ? Array.from({ length: cfg.potCount }, () => 'hidden')
                : sprouts.map((isSprout, i) => {
                    if (!revealing && !opened[i]) {
                        return 'hidden';
                    }
                    return isSprout ? 'sprout' : 'stone';
                });
        },
        // 'sprout' | 'stone' | 'cleared' | 'ignored'
        pick(index, now) {
            if (endAt === null || now >= endAt || now < revealUntil || now < lockedUntil) {
                return 'ignored';
            }
            if (!Number.isInteger(index) || index < 0 || index >= cfg.potCount || opened[index]) {
                return 'ignored';
            }
            opened[index] = true;
            if (!sprouts[index]) {
                lockedUntil = now + cfg.lockMs;
                return 'stone';
            }
            score += 1;
            const left = sprouts.some((isSprout, i) => isSprout && !opened[i]);
            if (!left) {
                newRound(now);
                return 'cleared';
            }
            return 'sprout';
        },
    };
}
