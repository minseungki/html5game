import { CONFIG } from './config.js';

export const FRUITS = ['orange', 'pear'];

export function coinsFor(score, config = CONFIG) {
    return score * config.coinsPerPoint;
}

// 시간은 절대 시각(now)만 받아 계산한다. 프레임 누적을 쓰지 않아 탭이 숨겨져도 흐른다
export function createGame({ random = Math.random, config = CONFIG } = {}) {
    const leftFruit = random() < 0.5 ? 'orange' : 'pear';
    const rule = { left: leftFruit, right: leftFruit === 'orange' ? 'pear' : 'orange' };
    const nextFruit = () => FRUITS[random() < 0.5 ? 0 : 1];
    const queue = [];
    while (queue.length < config.queueLength) {
        queue.push(nextFruit());
    }
    let endAt = null;
    let lockedUntil = 0;
    let score = 0;

    return {
        rule,
        get queue() {
            return queue;
        },
        get score() {
            return score;
        },
        get lockedUntil() {
            return lockedUntil;
        },
        start(now) {
            endAt = now + config.gameDurationMs;
        },
        remainingMs(now) {
            if (endAt === null) {
                return config.gameDurationMs;
            }
            return Math.max(0, endAt - now);
        },
        isFinished(now) {
            return endAt !== null && now >= endAt;
        },
        // 'correct' | 'wrong' | 'ignored'
        input(side, now) {
            if (side !== 'left' && side !== 'right') {
                return 'ignored';
            }
            if (endAt === null || now >= endAt || now < lockedUntil) {
                return 'ignored';
            }
            const front = queue[0];
            if (rule[side] === front) {
                score += 1;
                queue.shift();
                queue.push(nextFruit());
                return 'correct';
            }
            lockedUntil = now + config.wrongLockMs;
            return 'wrong';
        },
    };
}
