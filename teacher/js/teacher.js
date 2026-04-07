'use strict';

/* ══════════════════════════════════════════════════════
   CONSTANTS
══════════════════════════════════════════════════════ */

const INIT_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/* ══════════════════════════════════════════════════════
   STATE
   Node: { move, san, fen, comment, hint, correct, parent, variations[] }
   Root node: move=null, fen=startFen, parent=null
══════════════════════════════════════════════════════ */

const S = {
    lesson: null,   // { name, student, startFen, rootNode }
    cur: null,      // current node (null = at starting position)
    chess: null,    // chess.js instance
    selSq: null,    // selected square string or null
    flipped: false,
    pendMv: null    // { from, to } awaiting promotion choice
};

function mkRoot(fen) {
    return { move: null, san: null, fen, comment: '', hint: '', correct: null, parent: null, variations: [] };
}
function mkNode(parent, uci, san, fen) {
    return { move: uci, san, fen, comment: '', hint: '', correct: null, parent, variations: [] };
}

/* ══════════════════════════════════════════════════════
  DRAG PIECES
══════════════════════════════════════════════════════ */

const Drag = {
    active: false,
    pending: null,   // { sq, imgEl, startX, startY } — чекаємо чи це drag
    fromSq: null,
    ghost: null,
    sqSize: 0,

    THRESHOLD: 6,    // пікселів — менше = клік, більше = drag

    _hoveredSq: null,

    _highlightHover(sq) {
        // Знімаємо підсвітку з попередньої клітинки
        if (Drag._hoveredSq && Drag._hoveredSq !== Drag.fromSq) {
            const prev = document.querySelector(`[data-sq="${Drag._hoveredSq}"]`);
            if (prev) prev.style.background = '';
        }

        Drag._hoveredSq = sq;

        // Підсвічуємо нову клітинку
        if (sq && sq !== Drag.fromSq) {
            const el = document.querySelector(`[data-sq="${sq}"]`);
            if (el) {
                const fi = 'abcdefgh'.indexOf(sq[0]);
                const ri = parseInt(sq[1]) - 1;
                const lite = (fi + ri) % 2 === 1;
                el.style.background = lite ? '#cdd26a' : '#aaa23a';
            }
        }
    },

    mousedown(sq, imgEl, e) {
        if (e.button !== 0) return;
        e.preventDefault();
        Drag.pending = { sq, imgEl, startX: e.clientX, startY: e.clientY };
    },

    move(e) {
        if (Drag.pending && !Drag.active) {
            const dx = e.clientX - Drag.pending.startX;
            const dy = e.clientY - Drag.pending.startY;
            if (Math.sqrt(dx * dx + dy * dy) >= Drag.THRESHOLD) {
                const { sq, imgEl } = Drag.pending;
                Drag.pending = null;
                Drag._start(sq, imgEl, e);
            }
            return;
        }

        if (!Drag.active || !Drag.ghost) return;

        Drag.ghost.style.left = e.clientX + 'px';
        Drag.ghost.style.top = e.clientY + 'px';

        const sq = Drag.sqFromPoint(e.clientX, e.clientY);
        Drag._highlightHover(sq);
    },

    end(e) {
        if (Drag.pending) {
            const { sq } = Drag.pending;
            Drag.pending = null;
            Board.click(sq);
            return;
        }

        if (!Drag.active) return;
        Drag.active = false;

        // Знімаємо hover-підсвітку
        Drag._highlightHover(null);
        Drag._hoveredSq = null;

        if (Drag.ghost) { Drag.ghost.remove(); Drag.ghost = null; }

        const toSq = Drag.sqFromPoint(e.clientX, e.clientY);
        const fromSq = Drag.fromSq;
        Drag.fromSq = null;
        S.selSq = null;

        if (toSq && toSq !== fromSq) {
            S.selSq = fromSq;
            Board.click(toSq);
        } else {
            Board.render();
        }
    },

    _start(sq, imgEl, e) {
        const wrap = document.getElementById('board-wrap');
        Drag.sqSize = wrap.getBoundingClientRect().width / 8;
        Drag.active = true;
        Drag.fromSq = sq;

        S.selSq = sq;
        Board.render();

        const g = document.createElement('img');
        g.src = imgEl.src;
        g.style.cssText = `
      position:fixed; pointer-events:none; z-index:999;
      width:${Drag.sqSize}px; height:${Drag.sqSize}px;
      transform:translate(-50%,-50%);
      opacity:.92; filter:drop-shadow(0 4px 8px rgba(0,0,0,.5));
    `;
        document.body.appendChild(g);
        Drag.ghost = g;

        // відразу ставимо ghost під курсор
        g.style.left = e.clientX + 'px';
        g.style.top = e.clientY + 'px';
    },

    sqFromPoint(x, y) {
        const board = document.getElementById('board');
        const rect = board.getBoundingClientRect();
        const col = Math.floor((x - rect.left) / (rect.width / 8));
        const row = Math.floor((y - rect.top) / (rect.height / 8));
        if (col < 0 || col > 7 || row < 0 || row > 7) return null;
        const files = 'abcdefgh';
        const fi = S.flipped ? 7 - col : col;
        const ri = S.flipped ? row : 7 - row;
        return files[fi] + (ri + 1);
    }
};

document.addEventListener('mousemove', e => Drag.move(e));
document.addEventListener('mouseup', e => Drag.end(e));

/* ══════════════════════════════════════════════════════
   LESSON SETUP
══════════════════════════════════════════════════════ */

function startLesson(name, student, startFen) {
    const lessonName = name || 'Новий урок';

    S.lesson = { name: lessonName, student, startFen, rootNode: mkRoot(startFen) };
    S.cur = null;
    S.chess = new Chess(startFen);
    S.selSq = null;
    S.flipped = (student === 'b');
    document.getElementById('app-title').textContent = lessonName;

    Board.render();
    Panel.update();
    Panel.updateJSON();
}

/* ══════════════════════════════════════════════════════
   BOARD
══════════════════════════════════════════════════════ */

const Board = {

    render() {
        const el = document.getElementById('board');
        el.innerHTML = '';
        const ch = S.chess;
        const sel = S.selSq;
        const fl = S.flipped;
        const files = 'abcdefgh';

        // Pre-compute valid destinations for selected square
        const dests = new Set();
        if (sel) ch.moves({ square: sel, verbose: true }).forEach(m => dests.add(m.to));

        // Last-move squares
        const lmFrom = S.cur?.move?.slice(0, 2) ?? null;
        const lmTo = S.cur?.move?.slice(2, 4) ?? null;

        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const fi = fl ? 7 - col : col;
                const ri = fl ? row : 7 - row;
                const sq = files[fi] + (ri + 1);
                const lite = (fi + ri) % 2 === 1;

                const div = document.createElement('div');
                div.className = 'sq ' + (lite ? 'lt' : 'dk');
                div.dataset.sq = sq;

                // Last-move tint
                if (sq === lmFrom || sq === lmTo) {
                    div.style.background = lite ? '#cdd26a' : '#aaa23a';
                }
                // Selection tint
                if (sq === sel) { div.style.background = '#7fc97f'; }

                // Coordinate labels
                if (col === 0) {
                    const r = document.createElement('span');
                    r.className = 'coord-r'; r.textContent = ri + 1;
                    div.appendChild(r);
                }
                if (row === 7) {
                    const f = document.createElement('span');
                    f.className = 'coord-f'; f.textContent = files[fi];
                    div.appendChild(f);
                }

                // Piece
                const piece = ch.get(sq);
                if (piece) {
                    const p = document.createElement('img');
                    p.className = 'piece';
                    p.src = `https://chessboardjs.com/img/chesspieces/wikipedia/${piece.color}${piece.type.toUpperCase()}.png`;
                    p.draggable = false;

                    p.addEventListener('mousedown', e => {
                        if (e.button !== 0) return;
                        if (piece.color !== ch.turn()) return;
                        e.preventDefault();
                        Drag.mousedown(sq, p, e);
                    });

                    div.appendChild(p);

                    if (dests.has(sq)) {
                        const ring = document.createElement('div');
                        ring.className = 'mv-ring'; div.appendChild(ring);
                    }
                } else if (dests.has(sq)) {
                    const dot = document.createElement('div');
                    dot.className = 'mv-dot'; div.appendChild(dot);
                }

                div.addEventListener('click', () => Board.click(sq));
                el.appendChild(div);
            }
        }
    },

    click(sq) {
        const ch = S.chess;
        const sel = S.selSq;

        // Nothing selected → try to select own piece
        if (!sel) {
            const p = ch.get(sq);
            if (p && p.color === ch.turn()) { S.selSq = sq; Board.render(); }
            return;
        }

        // Click same square → deselect
        if (sel === sq) { S.selSq = null; Board.render(); return; }

        // Try move
        const moves = ch.moves({ square: sel, verbose: true });
        const m = moves.find(x => x.to === sq);

        if (m) {
            S.selSq = null;
            if (m.flags.includes('p')) {
                S.pendMv = { from: sel, to: sq };
                UI.showPromo(ch.turn());
            } else {
                Board.doMove(sel, sq, null);
            }
            return;
        }

        // Re-select another own piece
        const p = ch.get(sq);
        S.selSq = (p && p.color === ch.turn()) ? sq : null;
        Board.render();
    },

    doMove(from, to, promo) {
        const ch = S.chess;
        const par = S.cur || S.lesson.rootNode;
        const uci = from + to + (promo || '');

        // Navigate to existing variation if it already exists
        const ex = par.variations.find(v => v.move === uci);
        if (ex) { Nav.to(ex); return; }

        const res = ch.move({ from, to, promotion: promo || undefined });
        if (!res) return;

        const node = mkNode(par, uci, res.san, ch.fen());
        par.variations.push(node);
        S.cur = node;
        Board.render();
        Panel.update();
        Panel.updateJSON();
    }
};

/* ══════════════════════════════════════════════════════
   NAVIGATION
══════════════════════════════════════════════════════ */

const Nav = {
    to(node) {
        S.cur = node;
        S.chess.load(node.fen);
        S.selSq = null;
        Board.render(); Panel.update(); Panel.updateJSON();
    },

    toStart() {
        S.cur = null;
        S.chess.load(S.lesson.startFen);
        S.selSq = null;
        Board.render(); Panel.update(); Panel.updateJSON();
    },

    back() {
        if (!S.cur) return;
        const par = S.cur.parent;
        const isRoot = !par || par === S.lesson.rootNode;
        S.cur = isRoot ? null : par;
        S.chess.load(isRoot ? S.lesson.startFen : par.fen);
        S.selSq = null;
        Board.render(); Panel.update(); Panel.updateJSON();
    },

    del() {
        if (!S.cur) return;
        if (!confirm('Видалити цей крок і всі продовження після нього?')) return;
        const par = S.cur.parent;
        const idx = par.variations.indexOf(S.cur);
        if (idx >= 0) par.variations.splice(idx, 1);
        const isRoot = !par || par === S.lesson.rootNode;
        S.cur = isRoot ? null : par;
        S.chess.load(isRoot ? S.lesson.startFen : par.fen);
        S.selSq = null;
        Board.render(); Panel.update(); Panel.updateJSON();
    }
};

/* ══════════════════════════════════════════════════════
   PANEL
══════════════════════════════════════════════════════ */

const Panel = {

    update() {
        const ch = S.chess;
        const node = S.cur;
        const student = S.lesson.student;

        // Turn indicator
        const turn = ch.turn();
        const isStudentTurn = turn === student;
        document.getElementById('turn-info').textContent =
            `Хід: ${turn === 'w' ? '♔ Білі' : '♚ Чорні'} · ${isStudentTurn ? '🎓 Студент' : '🤖 Суперник'}`;

        // FEN / PGN
        document.getElementById('fen-out').value = ch.fen();
        document.getElementById('pgn-out').value = Panel.buildPgn();

        const ccCard = document.getElementById('correct-card');
        const hintCard = document.getElementById('hint-card');
        const commentIn = document.getElementById('comment-in');
        const hintIn = document.getElementById('hint-in');

        if (!node) {
            ccCard.style.display = 'none';
            hintCard.style.display = isStudentTurn ? '' : 'none';
            hintIn.value = S.lesson.rootNode.hint ?? '';
            commentIn.value = S.lesson.rootNode.comment ?? '';
        } else {
            // Who made the move that got us here?
            // After the move, ch.turn() is the NEXT player → mover = opposite
            const mover = (turn === 'w') ? 'b' : 'w';
            if (mover === student) {
                ccCard.style.display = '';
                hintCard.style.display = 'none';
                Panel.updateCorrectBox(node.correct);
            } else {
                ccCard.style.display = 'none';
                hintCard.style.display = '';
                hintIn.value = node.hint ?? '';
            }
            commentIn.value = node.comment ?? '';
        }

        // Variations chips (children of current position)
        const par = node || S.lesson.rootNode;
        const chips = document.getElementById('var-row');
        chips.innerHTML = '';

        // очищаємо старі стрілки варіантів і перемальовуємо
        Arrows.varList = [];

        if (!par.variations.length) {
            chips.innerHTML = '<span class="no-vars">Немає варіантів</span>';
        } else {
            // кольори для перших 4 варіантів, далі — жовтий
            const COLORS = ['g', 'b', 'r', ''];
            par.variations.forEach((v, i) => {
                const color = COLORS[i] ?? '';

                // чіп
                const c = document.createElement('span');
                c.className = 'var-chip';
                c.textContent = v.san || v.move;
                c.title = v.move;
                c.style.borderLeftColor = ({ '': '#f6a623', g: '#2ecc71', r: '#e74c3c', b: '#3498db' })[color];
                c.style.borderLeftWidth = '3px';
                c.style.borderLeftStyle = 'solid';
                c.onmouseenter = () => { Arrows.varList = [{ from: v.move.slice(0, 2), to: v.move.slice(2, 4), color }]; Arrows.render(); };
                c.onmouseleave = () => { Arrows.varList = par.variations.map((vv, ii) => ({ from: vv.move.slice(0, 2), to: vv.move.slice(2, 4), color: COLORS[ii] ?? '' })); Arrows.render(); };
                c.onclick = () => Nav.to(v);
                chips.appendChild(c);

                // стрілка
                Arrows.varList.push({ from: v.move.slice(0, 2), to: v.move.slice(2, 4), color });
            });
        }

        Arrows.render();
    },

    updateCorrectBox(state) {
        const b = document.getElementById('correct-box');
        if (state === true) { b.className = 'correct-box st'; b.textContent = '✓'; }
        else if (state === false) { b.className = 'correct-box sf'; b.textContent = '✗'; }
        else { b.className = 'correct-box sn'; b.textContent = '○'; }
    },

    buildPgn() {
        const startFen = S.lesson.startFen;
        const isStandard = startFen === INIT_FEN;

        // заголовок
        let header = `[Event "${S.lesson.name}"]\n`;
        if (!isStandard) header += `[FEN "${startFen}"]\n[SetUp "1"]\n\n`;
        header += '\n';

        // Коментар до стартової позиції
        if (S.lesson.rootNode.comment) header += `{ ${S.lesson.rootNode.comment} } `;

        // рекурсивна функція обходу дерева
        function renderNode(node, moveNum, isBlack) {
            if (!node.variations.length) return '';

            let out = '';
            const main = node.variations[0];
            const rest = node.variations.slice(1);

            // номер ходу
            if (!isBlack) out += `${moveNum}. `;
            else if (rest.length) out += `${moveNum}... `;

            out += main.san;

            // коментар головного ходу
            if (main.comment) out += ` { ${main.comment} }`;

            // бічні варіанти
            for (const alt of rest) {
                let varStr = isBlack ? `${moveNum}... ` : `${moveNum}. `;
                varStr += alt.san;
                if (alt.comment) varStr += ` { ${alt.comment} }`;
                const cont = renderNode(alt, isBlack ? moveNum + 1 : moveNum, !isBlack);
                if (cont) varStr += ' ' + cont;
                out += ` (${varStr})`;
            }

            out += ' ';

            // продовжуємо головну лінію
            const nextNum = isBlack ? moveNum + 1 : moveNum;
            const nextBlack = !isBlack;
            out += renderNode(main, nextNum, nextBlack);

            return out.trim();
        }

        // визначаємо з якого кольору починається позиція
        const tmp = new Chess(startFen);
        const firstBlack = tmp.turn() === 'b';
        const startNum = parseInt(startFen.split(' ')[5]) || 1;

        const body = renderNode(S.lesson.rootNode, startNum, firstBlack);
        return (header + body).trim();
    },

    updateJSON() {
        function exp(node) {
            const o = { move: node.move };
            if (node.comment) o.comment = node.comment;
            if (node.hint) o.hint = node.hint;
            if (node.correct !== null) o.correct = node.correct;
            if (node.variations.length) o.variations = node.variations.map(exp);
            return o;
        }

        const l = S.lesson;
        const out = { name: l.name, student: l.student, start_pos: l.startFen };

        if (l.rootNode.comment) out.comment = l.rootNode.comment;
        if (l.rootNode.hint) out.hint = l.rootNode.hint;

        const vars = l.rootNode.variations;
        if (vars.length === 1) out.root = exp(vars[0]);
        else if (vars.length > 1) out.root = vars.map(exp);

        document.getElementById('json-out').value = JSON.stringify(out, null, 2);
    }
};

/* ══════════════════════════════════════════════════════
   ACTIONS
══════════════════════════════════════════════════════ */

const Actions = {

    cycleCorrect() {
        if (!S.cur) return;
        const s = S.cur.correct;
        S.cur.correct = (s === null) ? true : (s === true) ? false : null;
        Panel.updateCorrectBox(S.cur.correct);
        Panel.updateJSON();
    },

    createLesson() {
        const name = document.getElementById('nl-name').value.trim();
        const student = document.querySelector('input[name="nl-color"]:checked').value;
        const raw = document.getElementById('nl-import').value.trim();
        const errEl = document.getElementById('nl-err');
        errEl.style.display = 'none';

        // Порожньо — стандартна позиція
        if (!raw) {
            UI.closeModal('new-modal');
            startLesson(name, student, INIT_FEN);
            return;
        }

        // Спроба FEN
        const fenTest = new Chess();
        // Якщо FEN має 4 поля (без лічильників) - додаємо 0 1. Якщо вже повний - залишаємо як є.
        const fenNormalized = raw.trim().split(/\s+/).length === 4
            ? raw.trim() + ' 0 1'
            : raw.trim();
        if (fenTest.load(fenNormalized)) {
            UI.closeModal('new-modal');
            startLesson(name, student, fenNormalized);
            return;
        }

        // Спроба JSON
        if (raw.startsWith('{')) {
            try {
                const data = JSON.parse(raw);
                if (!data.start_pos) throw new Error('Відсутнє поле start_pos');
                if (!data.student) throw new Error('Відсутнє поле student');
                UI.closeModal('new-modal');
                Import.fromJSON(data);
                return;
            } catch (e) {
                errEl.textContent = 'Невірний JSON: ' + e.message;
                errEl.style.display = '';
                return;
            }
        }

        // Спроба PGN
        const result = Import.fromPGN(raw);
        if (!result.ok) {
            errEl.textContent = result.error;
            errEl.style.display = '';
            return;
        }

        // Перед застосуванням оновлюємо назву і студента
        UI.closeModal('new-modal');
        result.apply(name, student);
    },

};

/* ══════════════════════════════════════════════════════
   IMPORT HELPERS
══════════════════════════════════════════════════════ */

const Import = {

    fromJSON(data) {
        const root = mkRoot(data.start_pos);

        function buildNode(d, par) {
            const tmp = new Chess(par.fen);
            const res = tmp.move({
                from: d.move.slice(0, 2),
                to: d.move.slice(2, 4),
                promotion: d.move.length > 4 ? d.move[4] : undefined
            });
            const fen = res ? tmp.fen() : par.fen;
            const nd = mkNode(par, d.move, res ? res.san : d.move, fen);
            nd.comment = d.comment || '';
            nd.hint = d.hint || '';
            nd.correct = (d.correct !== undefined) ? d.correct : null;
            if (d.variations) d.variations.forEach(v => nd.variations.push(buildNode(v, nd)));
            return nd;
        }

        if (data.root) {
            const roots = Array.isArray(data.root) ? data.root : [data.root];
            roots.forEach(r => root.variations.push(buildNode(r, root)));
        }

        if (data.comment) root.comment = data.comment;
        if (data.hint) root.hint = data.hint;

        S.lesson = { name: data.name || 'Урок', student: data.student, startFen: data.start_pos, rootNode: root };
        S.cur = null;
        S.chess = new Chess(data.start_pos);
        S.selSq = null;
        S.flipped = (data.student === 'b');
        document.getElementById('app-title').textContent = S.lesson.name;

        Board.render();
        Panel.update();
        Panel.updateJSON();
    },

    fromPGN(raw) {
        const eventMatch = raw.match(/\[Event\s+"([^"]+)"\]/);
        const parsedName = eventMatch ? eventMatch[1] : null;

        const fenMatch = raw.match(/\[FEN\s+"([^"]+)"\]/);
        const startFen = fenMatch ? fenMatch[1] : INIT_FEN;

        // Валідуємо FEN якщо є
        if (fenMatch) {
            const t = new Chess();
            if (!t.load(startFen)) {
                return { ok: false, error: 'Невірний FEN у заголовку PGN.' };
            }
        }

        const body = raw.replace(/\[.*?\]\s*/g, '').trim();
        const root = mkRoot(startFen);

        function tokenize(str) {
            const tokens = [];
            let i = 0;
            while (i < str.length) {
                if (/\s/.test(str[i])) { i++; continue; }

                if (str[i] === '{') {
                    let j = i + 1;
                    while (j < str.length && str[j] !== '}') j++;
                    tokens.push(str.slice(i, j + 1));
                    i = j + 1;
                    continue;
                }

                if (str[i] === '(' || str[i] === ')') {
                    tokens.push(str[i]); i++; continue;
                }

                let j = i;
                while (j < str.length && !/[\s(){}]/.test(str[j])) j++;
                if (j > i) tokens.push(str.slice(i, j));
                i = j;
            }
            return tokens;
        }

        function parseVariation(tokens, idx, par) {
            const tmp = new Chess(par.fen);
            let curNode = par;

            while (idx < tokens.length) {
                const tok = tokens[idx];

                if (tok === ')') return idx;

                if (tok === '(') {
                    idx = parseVariation(tokens, idx + 1, curNode.parent || par);
                    idx++; // пропускаємо ')'
                    continue;
                }

                // Коментар { ... }
                if (tok.startsWith('{')) {
                    const comment = tok.slice(1, -1).trim();
                    if (curNode !== par) curNode.comment = comment;
                    idx++;
                    continue;
                }

                // Пропускаємо номери ходів, анотації, результат
                if (
                    /^\d+\.+$/.test(tok) ||
                    tok.startsWith('$') ||
                    ['*', '1-0', '0-1', '1/2-1/2'].includes(tok)
                ) {
                    idx++;
                    continue;
                }

                // Спробуємо як хід SAN
                const res = tmp.move(tok);
                if (res) {
                    const uci = res.from + res.to + (res.promotion || '');
                    let node = curNode.variations.find(v => v.move === uci);
                    if (!node) {
                        node = mkNode(curNode, uci, res.san, tmp.fen());
                        curNode.variations.push(node);
                    }
                    curNode = node;
                }

                idx++;
            }

            return idx;
        }

        const tokens = tokenize(body);

        // Стартовий коментар — перший токен до будь-якого ходу
        let startIdx = 0;
        if (tokens.length > 0 && tokens[0].startsWith('{')) {
            root.comment = tokens[0].slice(1, -1).trim();
            startIdx = 1;
        }

        parseVariation(tokens, startIdx, root);

        const hasContent = fenMatch || root.variations.length > 0;
        if (!hasContent) {
            return { ok: false, error: 'Формат не розпізнано. Підтримуються: FEN, PGN, JSON.' };
        }

        return {
            ok: true,
            apply(name, student) {
                const lessonName = name || parsedName || 'Новий урок';
                console.log('name: ', name);
                console.log('lessonName: ', lessonName);

                S.lesson = { name: lessonName, student, startFen, rootNode: root };

                S.cur = null;
                S.chess = new Chess(startFen);
                S.selSq = null;
                S.flipped = (student === 'b');
                S.lesson.name = lessonName;
                S.lesson.student = student;

                document.getElementById('app-title').textContent = lessonName;

                Board.render();
                Panel.update();
                Panel.updateJSON();
            }
        };
    },

};

/* ══════════════════════════════════════════════════════
   UI
══════════════════════════════════════════════════════ */

const UI = {
    openModal(id) { document.getElementById(id).classList.add('open'); },
    closeModal(id) { document.getElementById(id).classList.remove('open'); },

    showNewLesson() {
        document.getElementById('nl-name').value = '';
        document.getElementById('nl-import').value = '';
        document.getElementById('nl-err').style.display = 'none';
        document.querySelector('input[name="nl-color"][value="w"]').checked = true;
        UI.openModal('new-modal');
        setTimeout(() => document.getElementById('nl-name').focus(), 50);
    },

    showPromo(color) {
        const pieces = ['q', 'r', 'b', 'n'];
        const row = document.getElementById('promo-row');
        row.innerHTML = '';
        for (const p of pieces) {
            const img = document.createElement('img');
            img.src = `https://chessboardjs.com/img/chesspieces/wikipedia/${color}${p.toUpperCase()}.png`;
            img.style.cssText = 'width:64px;height:64px;cursor:pointer;padding:6px;border-radius:6px;border:2px solid transparent;transition:border-color .12s;';
            img.onmouseover = () => img.style.borderColor = 'var(--gold)';
            img.onmouseout = () => img.style.borderColor = 'transparent';
            img.onclick = () => {
                UI.closeModal('promo-modal');
                if (S.pendMv) { Board.doMove(S.pendMv.from, S.pendMv.to, p); S.pendMv = null; }
            };
            row.appendChild(img);
        }
        UI.openModal('promo-modal');
    },

    copy(fieldId, btn) {
        const val = document.getElementById(fieldId).value;
        if (!val) return;
        navigator.clipboard.writeText(val).then(() => {
            btn.classList.add('copied');
            btn.innerHTML = '<i class="fa-solid fa-check"></i>';
            setTimeout(() => {
                btn.classList.remove('copied');
                btn.innerHTML = '<i class="fa-regular fa-copy"></i>';
            }, 1500);
        });
    },

    editTitle() {
        const el = document.getElementById('app-title');
        el.classList.add('editing');
        el.contentEditable = 'true';
        el.focus();
        // виділити весь текст
        const range = document.createRange();
        range.selectNodeContents(el);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);

        const finish = () => {
            el.contentEditable = 'false';
            el.classList.remove('editing');
            const name = el.textContent.trim() || 'Новий урок';
            el.textContent = name;
            if (S.lesson) {
                S.lesson.name = name;
                document.getElementById('pgn-out').value = Panel.buildPgn();
                Panel.updateJSON();
            }
        };

        el.onblur = finish;
        el.onkeydown = e => {
            if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
            if (e.key === 'Escape') { el.textContent = S.lesson?.name || 'Новий урок'; el.blur(); }
        };
    },//

    save() {
        const val = document.getElementById('json-out').value;
        if (!val) return;
        const safeName = (S.lesson?.name || 'lesson')
            .replace(/[^\wа-яёА-ЯЁіІїЇєЄ\s-]/g, '')
            .trim()
            .replace(/\s+/g, '_');
        const blob = new Blob([val], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${safeName}.json`;
        a.click();
        URL.revokeObjectURL(url);
    },//

    load() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,.pgn';
        input.onchange = e => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = ev => {
                const raw = ev.target.result;
                if (file.name.endsWith('.json')) {
                    try {
                        const data = JSON.parse(raw);
                        if (!data.start_pos) throw new Error('Відсутнє поле start_pos');
                        if (!data.student) throw new Error('Відсутнє поле student');
                        Import.fromJSON(data);
                    } catch (e) {
                        alert('Невірний JSON: ' + e.message);
                    }
                } else {
                    const result = Import.fromPGN(raw);
                    if (!result.ok) { alert(result.error); return; }
                    result.apply(null, S.lesson.student);
                }
            };
            reader.readAsText(file);
        };
        input.click();
    },//
};

/* ══════════════════════════════════════════════════════
   ARROWS & HIGHLIGHTS
══════════════════════════════════════════════════════ */

const Arrows = {
    list: [],       // { from, to, color }
    varList: [],
    hilights: {},   // sq → color

    colorFromEvent(e) {
        if (e.shiftKey) return 'g';   // зелений
        if (e.ctrlKey) return 'r';    // червоний
        if (e.altKey) return 'b';     // синій
        return '';                    // жовтий (default)
    },

    sqFromPoint(x, y) {
        const wrap = document.getElementById('board-wrap');
        const rect = wrap.getBoundingClientRect();
        const sq = Arrows._sq;
        const col = Math.floor((x - rect.left) / sq);
        const row = Math.floor((y - rect.top) / sq);
        if (col < 0 || col > 7 || row < 0 || row > 7) return null;
        const files = 'abcdefgh';
        const fi = S.flipped ? 7 - col : col;
        const ri = S.flipped ? row : 7 - row;
        return files[fi] + (ri + 1);
    },

    get _sq() {
        return document.getElementById('board-wrap').getBoundingClientRect().width / 8;
    },

    sqCenter(sq) {
        const files = 'abcdefgh';
        const fi = files.indexOf(sq[0]);
        const ri = parseInt(sq[1]) - 1;
        const col = S.flipped ? 7 - fi : fi;
        const row = S.flipped ? ri : 7 - ri;

        const wrap = document.getElementById('board-wrap');
        const board = document.getElementById('board');
        const wRect = wrap.getBoundingClientRect();
        const bRect = board.getBoundingClientRect();

        // масштаб: реальні пікселі → координати SVG viewBox (480×480)
        const scaleX = 480 / wRect.width;
        const scaleY = 480 / wRect.height;

        // зміщення board відносно wrap у координатах viewBox
        const offX = (bRect.left - wRect.left) * scaleX;
        const offY = (bRect.top - wRect.top) * scaleY;

        // розмір клітинки у координатах viewBox
        const cellW = bRect.width / 8 * scaleX;
        const cellH = bRect.height / 8 * scaleY;

        return {
            x: 0 + col * cellW + cellW / 2,
            y: 0 + row * cellH + cellH / 2
        };
    },

    render() {
        const svg = document.getElementById('arrow-svg');
        // Remove old arrows
        [...svg.querySelectorAll('line, polygon, rect.arr-hl')].forEach(e => e.remove());

        const size = 480 / 8;

        // Square highlights
        for (const [sq, color] of Object.entries(Arrows.hilights)) {
            const fi = 'abcdefgh'.indexOf(sq[0]);
            const ri = parseInt(sq[1]) - 1;
            const col = S.flipped ? 7 - fi : fi;
            const row = S.flipped ? ri : 7 - ri;
            const colors = { '': '#f6a623', g: '#2ecc71', r: '#e74c3c', b: '#3498db' };

            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('class', 'arr-hl');
            rect.setAttribute('x', col * size);
            rect.setAttribute('y', row * size);
            rect.setAttribute('width', size);
            rect.setAttribute('height', size);
            rect.setAttribute('fill', colors[color] || colors['']);
            rect.setAttribute('opacity', '0.45');
            rect.setAttribute('pointer-events', 'none');

            svg.appendChild(rect);
        }

        // малюємо стрілки варіантів
        const allArrows = [...(Arrows.varList || []), ...Arrows.list];

        // Сортуємо: спочатку найдовші (малюються першими = знизу)
        allArrows.sort((a, b) => {
            const dist = ({ from, to }) => {
                const fx = 'abcdefgh'.indexOf(from[0]), fy = parseInt(from[1]) - 1;
                const tx = 'abcdefgh'.indexOf(to[0]), ty = parseInt(to[1]) - 1;
                return Math.sqrt((tx - fx) ** 2 + (ty - fy) ** 2);
            };
            return dist(b) - dist(a);
        });

        for (const { from, to, color } of allArrows) {
            const a = Arrows.sqCenter(from);
            const b = Arrows.sqCenter(to);

            const dx = b.x - a.x, dy = b.y - a.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            const ux = dx / len, uy = dy / len;  // вздовж
            const nx = -uy, ny = ux;           // перпендикуляр

            const bodyW = 9;   // половина ширини тіла
            const headW = 18;  // половина ширини наконечника
            const headL = 22;  // довжина наконечника
            const tail = 6;   // відступ від старту

            // Ключові точки вздовж осі
            const sx = a.x + ux * tail;   // початок тіла
            const sy = a.y + uy * tail;
            const hx = b.x - ux * headL;  // основа наконечника
            const hy = b.y - uy * headL;

            // 7 точок стрілки (як шеврон)
            const pts = [
                [sx + nx * bodyW, sy + ny * bodyW],  // 1 ліво-старт
                [hx + nx * bodyW, hy + ny * bodyW],  // 2 ліво-основа
                [hx + nx * headW, hy + ny * headW],  // 3 ліво-крило
                [b.x, b.y],  // 4 вістря
                [hx - nx * headW, hy - ny * headW],  // 5 право-крило
                [hx - nx * bodyW, hy - ny * bodyW],  // 6 право-основа
                [sx - nx * bodyW, sy - ny * bodyW],  // 7 право-старт
            ].map(([x, y]) => `${x},${y}`).join(' ');

            const colors = { '': '#f6a623', g: '#2ecc71', r: '#e74c3c', b: '#3498db' };
            const col = colors[color] ?? colors[''];

            const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            arrow.setAttribute('points', pts);
            arrow.setAttribute('fill', col);
            arrow.setAttribute('opacity', '0.78');

            arrow.setAttribute('cursor', 'pointer');
            arrow.style.pointerEvents = 'auto';
            arrow.addEventListener('click', () => {
                const node = (S.cur || S.lesson.rootNode).variations.find(
                    v => v.move.slice(0, 2) === from && v.move.slice(2, 4) === to
                );
                if (node) Nav.to(node);
            });

            svg.appendChild(arrow);
        }
    },

    toggle(from, to, color) {
        const key = from + to + color;
        const idx = Arrows.list.findIndex(a => a.from === from && a.to === to && a.color === color);
        if (idx >= 0) Arrows.list.splice(idx, 1);
        else Arrows.list.push({ from, to, color });
        Arrows.render();
    },

    toggleHilight(sq, color) {
        if (Arrows.hilights[sq] === color) delete Arrows.hilights[sq];
        else Arrows.hilights[sq] = color;
        Arrows.render();
    },

    clear() {
        Arrows.list = [];
        Arrows.hilights = {};
        Arrows.render();
    }
};


/* ══════════════════════════════════════════════════════
   LIVE FIELD LISTENERS
══════════════════════════════════════════════════════ */

document.getElementById('comment-in').addEventListener('input', function () {
    const node = S.cur || S.lesson.rootNode;
    node.comment = this.value.trim();
    document.getElementById('pgn-out').value = Panel.buildPgn();
    Panel.updateJSON();
});
document.getElementById('hint-in').addEventListener('input', function () {
    const node = S.cur || S.lesson.rootNode;
    node.hint = this.value.trim();
    document.getElementById('pgn-out').value = Panel.buildPgn();
    Panel.updateJSON();
});

/* ══════════════════════════════════════════════════════
   KEYBOARD SHORTCUTS
══════════════════════════════════════════════════════ */

document.addEventListener('keydown', e => {
    if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
    if (e.target.isContentEditable) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); Nav.back(); }
    if (e.key === 'Home') { e.preventDefault(); Nav.toStart(); }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); Nav.del(); }
});

/* ══════════════════════════════════════════════════════
   CLOSE MODAL ON OVERLAY CLICK
══════════════════════════════════════════════════════ */

document.querySelectorAll('.overlay').forEach(el => {
    el.addEventListener('click', e => { if (e.target === el) UI.closeModal(el.id); });
});

/* ══════════════════════════════════════════════════════
   BOOTSTRAP
══════════════════════════════════════════════════════ */

startLesson('Новий урок', 'w', INIT_FEN);
