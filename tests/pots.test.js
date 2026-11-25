import test from 'node:test';
import assert from 'node:assert/strict';
import { createPots } from '../src/pots.js';

// DOM 없이 쓰는 최소한의 가짜 문서
function makeDoc() {
    const created = [];
    const make = (tag) => {
        const el = {
            tag,
            className: '',
            attrs: {},
            children: [],
            listeners: {},
            get firstChild() {
                return this.children[0] || null;
            },
            setAttribute(k, v) {
                this.attrs[k] = String(v);
            },
            getAttribute(k) {
                return k in this.attrs ? this.attrs[k] : null;
            },
            removeAttribute(k) {
                delete this.attrs[k];
            },
            appendChild(c) {
                this.children.push(c);
                return c;
            },
            removeChild(c) {
                this.children.splice(this.children.indexOf(c), 1);
                return c;
            },
            addEventListener(type, fn) {
                (this.listeners[type] ||= []).push(fn);
            },
        };
        created.push(el);
        return el;
    };
    return { createElement: make, created };
}

function setup() {
    const doc = makeDoc();
    const root = doc.createElement('div');
    const picks = [];
    const painted = [];
    const pots = createPots({
        root,
        doc,
        paint: (canvas, kind) => painted.push(kind),
        onPick: (i) => picks.push(i),
    });
    return { doc, root, pots, picks, painted };
}

const hidden = () => Array(16).fill('hidden');
const snapshot = (el) => {
    const own = {};
    Object.keys(el).forEach((k) => {
        if (k !== 'listeners' && k !== 'children' && typeof el[k] !== 'function') {
            own[k] = el[k];
        }
    });
    return JSON.stringify([own, el.children.length]);
};
const listenerCount = (root) => root.children.reduce((n, b) => n + Object.values(b.listeners).flat().length, 0);

test('버튼 16개가 번호 라벨로 만들어진다', () => {
    const { root } = setup();
    assert.equal(root.children.length, 16);
    root.children.forEach((b, i) => {
        assert.equal(b.tag, 'button');
        assert.equal(b.getAttribute('aria-label'), `${i + 1}번 화분, 닫힘`);
        assert.equal(b.children.length, 0);
    });
});

test('공개 후 가리면 모든 칸이 번호 외에는 같은 속성, 자식, class가 된다', () => {
    const { root, pots } = setup();
    const kinds = hidden().map((_, i) => (i % 3 === 0 ? 'sprout' : 'stone'));
    const before = root.children.map(snapshot);
    pots.render(kinds, true);
    root.children.forEach((b, i) => {
        assert.equal(b.children.length, 1);
        assert.ok(b.className.includes('is-open'));
        assert.equal(b.getAttribute('aria-disabled'), null);
        assert.equal(b.getAttribute('aria-label'), `${i + 1}번 화분, ${kinds[i] === 'sprout' ? '새싹' : '돌'}`);
    });
    pots.render(hidden(), false);
    const after = root.children.map(snapshot);
    assert.deepEqual(after, before);
    const normalized = root.children.map((b, i) => JSON.stringify([b.className, b.children.length, b.getAttribute('aria-label').replace(`${i + 1}번`, 'N번'), b.getAttribute('aria-disabled')]));
    assert.equal(new Set(normalized).size, 1);
    root.children.forEach((b) => {
        assert.deepEqual(Object.keys(b.attrs).sort(), ['aria-label', 'type'].filter((k) => k in b.attrs));
    });
});

test('찾기 단계에서 열린 칸만 aria-disabled이고 닫힌 칸은 아니다', () => {
    const { root, pots } = setup();
    const kinds = hidden();
    kinds[2] = 'sprout';
    kinds[5] = 'stone';
    pots.render(kinds, false);
    root.children.forEach((b, i) => {
        assert.equal(b.getAttribute('aria-disabled'), i === 2 || i === 5 ? 'true' : null);
    });
});

test('달라진 칸만 다시 그리고 repaint는 보이는 그림만 다시 그린다', () => {
    const { pots, painted } = setup();
    const kinds = hidden();
    kinds[1] = 'sprout';
    pots.render(kinds, false);
    pots.render(kinds, false);
    assert.equal(painted.length, 1);
    pots.repaint();
    assert.equal(painted.length, 2);
});

test('pointerdown 1회와 뒤따른 click(detail 1)은 1회, click(detail 0)은 1회 처리된다', () => {
    const { root, picks } = setup();
    const btn = root.children[3];
    btn.listeners.pointerdown[0]({ button: 0 });
    btn.listeners.click[0]({ detail: 1 });
    assert.deepEqual(picks, [3]);
    btn.listeners.click[0]({ detail: 0 });
    assert.deepEqual(picks, [3, 3]);
    btn.listeners.pointerdown[0]({ button: 2 });
    assert.deepEqual(picks, [3, 3]);
});

test('keydown repeat는 기본 동작을 막고, 반복 render에도 리스너 수는 그대로다', () => {
    const { root, pots } = setup();
    const count = listenerCount(root);
    let prevented = 0;
    root.children[0].listeners.keydown[0]({ repeat: true, preventDefault: () => prevented++ });
    root.children[0].listeners.keydown[0]({ repeat: false, preventDefault: () => prevented++ });
    assert.equal(prevented, 1);
    for (let n = 0; n < 20; n++) {
        const kinds = hidden();
        kinds[n % 16] = 'stone';
        pots.render(kinds, n % 2 === 0);
        pots.render(hidden(), false);
    }
    assert.equal(listenerCount(root), count);
    assert.equal(root.children.length, 16);
});
