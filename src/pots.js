const COUNT = 16;
const BASE_CLASS = 'pot';
const LABELS = { sprout: '새싹', stone: '돌' };

// 버튼 16개를 한 번만 만들어 재사용한다. 가려진 칸에는 정답 단서를 남기지 않는다
export function createPots({ root, doc, paint, onPick }) {
    const cells = [];
    const shown = Array.from({ length: COUNT }, () => 'hidden');
    const disabled = Array.from({ length: COUNT }, () => false);

    function label(i, kind) {
        return kind === 'hidden' ? `${i + 1}번 화분, 닫힘` : `${i + 1}번 화분, ${LABELS[kind]}`;
    }

    function clearCanvas(btn) {
        while (btn.firstChild) {
            btn.removeChild(btn.firstChild);
        }
    }

    for (let i = 0; i < COUNT; i++) {
        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.className = BASE_CLASS;
        btn.setAttribute('aria-label', label(i, 'hidden'));
        btn.addEventListener('pointerdown', (event) => {
            if (event.button === 0) {
                onPick(i);
            }
        });
        // 키보드·보조기기 click(detail 0)만 처리해 터치 이중 입력을 막는다
        btn.addEventListener('click', (event) => {
            if (event.detail === 0) {
                onPick(i);
            }
        });
        btn.addEventListener('keydown', (event) => {
            if (event.repeat) {
                event.preventDefault();
            }
        });
        root.appendChild(btn);
        cells.push(btn);
    }

    function draw(i) {
        const btn = cells[i];
        const canvas = doc.createElement('canvas');
        canvas.setAttribute('aria-hidden', 'true');
        btn.appendChild(canvas);
        paint(canvas, shown[i]);
    }

    return {
        // kinds: 칸별 'hidden' | 'sprout' | 'stone'. 달라진 칸만 갱신한다
        // 열린 칸은 찾기 단계에서 aria-disabled로 알린다(disabled는 초점을 잃는다). 공개 중에는 16칸이 같다
        render(kinds, revealing = false) {
            for (let i = 0; i < COUNT; i++) {
                const kind = kinds[i];
                const btn = cells[i];
                if (kind !== shown[i]) {
                    shown[i] = kind;
                    clearCanvas(btn);
                    btn.className = kind === 'hidden' ? BASE_CLASS : `${BASE_CLASS} is-open`;
                    btn.setAttribute('aria-label', label(i, kind));
                    if (kind !== 'hidden') {
                        draw(i);
                    }
                }
                const off = !revealing && kind !== 'hidden';
                if (off !== disabled[i]) {
                    disabled[i] = off;
                    if (off) {
                        btn.setAttribute('aria-disabled', 'true');
                    } else {
                        btn.removeAttribute('aria-disabled');
                    }
                }
            }
        },
        // 화면 크기나 테마가 바뀌면 보이는 그림만 다시 그린다
        repaint() {
            for (let i = 0; i < COUNT; i++) {
                const canvas = cells[i].firstChild;
                if (canvas) {
                    paint(canvas, shown[i]);
                }
            }
        },
    };
}
