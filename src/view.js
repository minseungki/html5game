const FLY_MS = 260;
const SHIFT_MS = 180;
const SHAKE_MS = 300;
const COLOR_NAMES = ['ink', 'orange', 'pear', 'belt', 'basket', 'panel', 'muted'];

export function readColors(el) {
    const style = getComputedStyle(el);
    const colors = {};
    COLOR_NAMES.forEach((name) => {
        colors[name] = style.getPropertyValue('--' + name).trim();
    });
    return colors;
}

// 귤은 둥근 실루엣, 배는 위가 좁은 실루엣. 좌우 버튼 그림도 이 함수를 쓴다
export function drawFruit(ctx, type, x, y, r, colors) {
    ctx.lineWidth = Math.max(2, r * 0.09);
    ctx.strokeStyle = colors.ink;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (type === 'orange') {
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = colors.orange;
    } else {
        ctx.moveTo(x, y - r);
        ctx.bezierCurveTo(x + 0.45 * r, y - r, x + 0.5 * r, y - 0.2 * r, x + 0.75 * r, y + 0.2 * r);
        ctx.bezierCurveTo(x + r, y + 0.75 * r, x + 0.5 * r, y + r, x, y + r);
        ctx.bezierCurveTo(x - 0.5 * r, y + r, x - r, y + 0.75 * r, x - 0.75 * r, y + 0.2 * r);
        ctx.bezierCurveTo(x - 0.5 * r, y - 0.2 * r, x - 0.45 * r, y - r, x, y - r);
        ctx.fillStyle = colors.pear;
    }
    ctx.fill();
    ctx.stroke();
    // 꼭지
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r * 0.12, y - r * 1.25);
    ctx.stroke();
}

// 새싹은 줄기와 두 잎, 돌은 각진 다각형. 색 외에 모양으로도 구분한다
function drawSprout(ctx, x, y, r, colors) {
    ctx.lineWidth = Math.max(2, r * 0.09);
    ctx.strokeStyle = colors.ink;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y + r);
    ctx.lineTo(x, y - r * 0.1);
    ctx.stroke();
    ctx.fillStyle = colors.pear;
    [-1, 1].forEach((dir) => {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + dir * r * 0.3, y - r * 0.95, x + dir * r, y - r * 0.6);
        ctx.quadraticCurveTo(x + dir * r * 0.95, y + r * 0.1, x, y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    });
}

function drawStone(ctx, x, y, r, colors) {
    ctx.lineWidth = Math.max(2, r * 0.09);
    ctx.strokeStyle = colors.ink;
    ctx.lineJoin = 'round';
    ctx.fillStyle = colors.muted;
    ctx.beginPath();
    ctx.moveTo(x - r, y + r * 0.6);
    ctx.lineTo(x - r * 0.7, y - r * 0.2);
    ctx.lineTo(x - r * 0.1, y - r * 0.8);
    ctx.lineTo(x + r * 0.6, y - r * 0.5);
    ctx.lineTo(x + r, y + r * 0.2);
    ctx.lineTo(x + r * 0.7, y + r * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
}

function drawPiece(ctx, type, x, y, r, colors) {
    if (type === 'sprout') {
        drawSprout(ctx, x, y, r, colors);
    } else if (type === 'stone') {
        drawStone(ctx, x, y, r, colors);
    } else {
        drawFruit(ctx, type, x, y, r, colors);
    }
}

export function paintIcon(canvas, type) {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const size = canvas.clientWidth || 40;
    canvas.width = Math.round(size * ratio);
    canvas.height = Math.round(size * ratio);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, size, size);
    drawPiece(ctx, type, size / 2, size / 2 + size * 0.05, size * 0.36, readColors(canvas));
}

export function paintHero(canvas, gameId = 'fruit') {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 200;
    const h = canvas.clientHeight || 100;
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const colors = readColors(canvas);
    const r = Math.min(h * 0.38, w * 0.2);
    const [left, right] = gameId === 'sprout' ? ['sprout', 'stone'] : ['orange', 'pear'];
    drawPiece(ctx, left, w * 0.3, h * 0.55, r, colors);
    drawPiece(ctx, right, w * 0.7, h * 0.55, r, colors);
}

// roundRect 미지원 웹뷰에서도 그려지도록 arcTo로 만든다
function roundedRectPath(ctx, x, y, w, h, radius) {
    const r = Math.min(radius, w / 2, h / 2);
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

export function createView(canvas, { reducedMotion: initialReduced = false } = {}) {
    let reducedMotion = initialReduced;
    const ctx = canvas.getContext('2d');
    let w = 0;
    let h = 0;
    let colors = readColors(canvas);
    let flying = [];
    let shiftAt = -Infinity;
    let shakeAt = -Infinity;

    function layout() {
        const r = Math.min(w * 0.11, 32);
        const basketW = Math.min(w * 0.3, 120);
        const basketH = Math.min(h * 0.2, 70);
        const basketTop = h - basketH - 4;
        const beltBottom = basketTop - 14;
        return { r, basketW, basketH, basketTop, beltBottom, spacing: r * 2.5, frontY: beltBottom - r - 8 };
    }

    function resize() {
        const rect = canvas.getBoundingClientRect();
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        w = rect.width;
        h = rect.height;
        canvas.width = Math.round(w * ratio);
        canvas.height = Math.round(h * ratio);
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        colors = readColors(canvas);
    }

    function basketCenter(side, l) {
        const x = side === 'left' ? 4 + l.basketW / 2 : w - 4 - l.basketW / 2;
        return { x, y: l.basketTop + l.basketH / 2 };
    }

    return {
        resize,
        setReducedMotion(value) {
            reducedMotion = Boolean(value);
        },
        refreshColors() {
            colors = readColors(canvas);
        },
        fly(fruit, side, now) {
            shiftAt = reducedMotion ? -Infinity : now;
            if (!reducedMotion) {
                flying.push({ fruit, side, start: now });
            }
        },
        shake(now) {
            shakeAt = reducedMotion ? -Infinity : now;
        },
        // snap: { queue, rule, lockedUntil }
        render(snap, now) {
            const l = layout();
            ctx.clearRect(0, 0, w, h);
            // 벨트
            const beltW = l.r * 2 + 36;
            const beltX = w / 2 - beltW / 2;
            ctx.fillStyle = colors.belt;
            ctx.fillRect(beltX, 0, beltW, l.beltBottom);
            ctx.strokeStyle = colors.ink;
            ctx.globalAlpha = 0.25;
            ctx.lineWidth = 2;
            const phase = reducedMotion ? 0 : (now / 40) % 28;
            for (let y = l.beltBottom - phase; y > 0; y -= 28) {
                ctx.beginPath();
                ctx.moveTo(beltX, y);
                ctx.lineTo(beltX + beltW, y);
                ctx.stroke();
            }
            ctx.globalAlpha = 1;
            // 바구니와 기준 과일
            const locked = now < snap.lockedUntil;
            ['left', 'right'].forEach((side) => {
                const c = basketCenter(side, l);
                ctx.globalAlpha = locked ? 0.5 : 1;
                ctx.fillStyle = colors.basket;
                ctx.strokeStyle = colors.ink;
                ctx.lineWidth = 2;
                ctx.beginPath();
                roundedRectPath(ctx, c.x - l.basketW / 2, l.basketTop, l.basketW, l.basketH, 18);
                ctx.fill();
                ctx.stroke();
                drawFruit(ctx, snap.rule[side], c.x, c.y, Math.min(l.basketH * 0.3, 20), colors);
                ctx.globalAlpha = 1;
            });
            // 대기열: 위에서 내려오고 앞 과일이 빠지면 한 칸 내려온다
            const t = Math.min(1, (now - shiftAt) / SHIFT_MS);
            const eased = 1 - Math.pow(1 - t, 3);
            const offset = (1 - eased) * l.spacing;
            for (let i = snap.queue.length - 1; i >= 0; i--) {
                let x = w / 2;
                const y = l.frontY - i * l.spacing - offset;
                if (i === 0 && now - shakeAt < SHAKE_MS) {
                    x += Math.sin((now - shakeAt) * 0.06) * 6 * (1 - (now - shakeAt) / SHAKE_MS);
                }
                ctx.globalAlpha = i === 0 && locked ? 0.5 : Math.max(0.35, 1 - i * 0.2);
                drawFruit(ctx, snap.queue[i], x, y, l.r, colors);
                if (i === 0 && locked) {
                    // 잠금은 색이 아닌 X 표시로도 알린다
                    ctx.globalAlpha = 1;
                    ctx.strokeStyle = colors.ink;
                    ctx.lineWidth = 4;
                    ctx.beginPath();
                    ctx.moveTo(x - l.r * 0.6, y - l.r * 0.6);
                    ctx.lineTo(x + l.r * 0.6, y + l.r * 0.6);
                    ctx.moveTo(x + l.r * 0.6, y - l.r * 0.6);
                    ctx.lineTo(x - l.r * 0.6, y + l.r * 0.6);
                    ctx.stroke();
                }
            }
            ctx.globalAlpha = 1;
            // 바구니로 날아가는 과일
            flying = flying.filter((f) => now - f.start < FLY_MS);
            flying.forEach((f) => {
                const p = (now - f.start) / FLY_MS;
                const e = 1 - Math.pow(1 - p, 2);
                const to = basketCenter(f.side, l);
                const x = w / 2 + (to.x - w / 2) * e;
                const y = l.frontY + (to.y - l.frontY) * e - Math.sin(p * Math.PI) * l.r;
                ctx.globalAlpha = 1 - p * 0.4;
                drawFruit(ctx, f.fruit, x, y, l.r * (1 - p * 0.4), colors);
            });
            ctx.globalAlpha = 1;
        },
    };
}
