'use strict';

/* ══════════════════════════════════════════════════════
   CONSTANTS
══════════════════════════════════════════════════════ */

const INIT_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/* ══════════════════════════════════════════════════════
   LOGGER
══════════════════════════════════════════════════════ */

const Logger = {
    debug: true,

    /** console log: HH:mm:ss.SSS args */
    log(...args) { if (this.debug) console.log(new Date().toISOString().slice(11, 23), ...args); }
};

/* ══════════════════════════════════════════════════════
   STATE
══════════════════════════════════════════════════════ */

/** Поточний стан гри */
// const GameState = Object.freeze({
//     /** Базовий стан */
//     IDLE: 'idle',
//     /** Очікування дій від користувача: натиснути кнопку "Продовжити" */
//     AWAITING_CONTINUE: 'awaiting_continue',
//     /** Студент зробив хибний хід */
//     BAD_MOVE: 'bad_move',
//     /** Студент зробив хід, який не було передбачено */
//     UNEXPECTED_MOVE: 'unexpected_move',
// });
const Flags = Object.freeze({
    NONE: 0,
    GOOD_MOVE: 1,
    BAD_MOVE: 0b10,
    AWAITING_CONTINUE: 0b100,
    UNEXPECTED_MOVE: 0b1000,
});

const S = {
    /** Завантажений урок { name, student, startFen, rootNode } */
    lesson: null,

    /** Поточний вузол дерева. null = стартова позиція */
    _cur: null,

    /** Екземпляр chess.js — поточна позиція на дошці */
    chess: null,

    /** Вибрана клітинка (наприклад 'e2'). null = нічого не вибрано */
    selSq: null,

    /** true = дошка перевернута (студент грає чорними) */
    flipped: false,

    /** Хід що очікує вибору фігури для просунення пішака { from, to } */
    pendMv: null,

    /** Останній зроблений хід у форматі UCI ('e2e4') — для підсвітки */
    _lastMove: null,

    /** true = підказка вже була використана на поточному ході */
    hintUsed: false,

    /** Загальна статистика сесії { attempts, success } */
    stats: {
        attempts: 0,
        success: 0,
        hints: 0,
        mistakes: 0
    },

    /** Статистика по варіантах { [varKey]: { attempts, mistakes, success } } */
    varStats: {
        mistakes: null
    },

    // flags: {
    //     _value: Flags.NONE,
    //     reset() { this._value = Flags.NONE },
    //     set value()
    // },
    // S.flags = F | B
    // S.flags.reset()
    flags: {
        _value: Flags.NONE,
        get value() { return this._value; },
        set(flag) { this._value |= flag; },
        unset(flag) { this._value &= ~flag; },
        reset() { this._value = Flags.NONE; },
        has(flag) { return !!(this._value & flag); },
    },

    /* Getters & Setters */

    get rootNode() { return this.lesson?.rootNode ?? null; },

    get isLessonLoaded() { return !!this.rootNode?.variations?.length; },

    get cur() { return this._cur; },
    set cur(node) { Logger.log('S.cur = ', node); this._lastMove = node?.move ?? null; this._cur = node; },

    get lastMove() { return this._lastMove; },

    get currentNode() { return (this.cur || this.rootNode) ?? null; },

    /** Чи має послідовність продовження */
    get hasNext() { return !!this.currentNode?.variations?.length; },

    get isStudentTurn() { return this.chess?.turn() === this.lesson?.student; },
};

const Utils = {
    mkNode(parent, uci, san, fen) {
        return { move: uci, san, fen, comment: '', hint: '', correct: null, parent, variations: [] };
    },

    /**
     * Дошку заблоковано від дій студента якщо одне з:
     * - урок не було завантажено
     * - зараз не хід студента
     * - послідовність завершено
     */
    get isBlocked() {
        const isLessonNotImported = !S.lesson?.rootNode?.variations?.length;
        if (isLessonNotImported) return true;

        const isNotStudentTurn = S.chess?.turn() !== S.lesson?.student;
        if (isNotStudentTurn) return true;

        const sequenceFinished = !S.currentNode?.variations?.length;
        if (sequenceFinished) return true;

        return false;
    }
}

/* ══════════════════════════════════════════════════════
   IMPORT
══════════════════════════════════════════════════════ */

const Import = {

    _mkRoot(fen) { return Utils.mkNode(null, null, null, fen); },

    _buildNode(d, par) {
        const tmp = new Chess(par.fen);
        const res = tmp.move({
            from: d.move.slice(0, 2),
            to: d.move.slice(2, 4),
            promotion: d.move.length > 4 ? d.move[4] : undefined
        });

        const fen = res ? tmp.fen() : par.fen;
        const nd = Utils.mkNode(par, d.move, res ? res.san : d.move, fen);

        nd.comment = d.comment || '';
        nd.hint = d.hint || '';
        nd.correct = (d.correct !== undefined) ? d.correct : null;
        if (d.variations) d.variations.forEach(v => nd.variations.push(this._buildNode(v, nd)));

        return nd;
    },

    validateTree(node, isStudentMove) {
        const errors = [];

        node.variations.forEach(child => {
            const tmp = new Chess(node.fen);
            const res = tmp.move({
                from: child.move.slice(0, 2),
                to: child.move.slice(2, 4),
                promotion: child.move[4] || undefined
            });

            if (!res) {
                errors.push(`Недійсний хід: ${child.move} в позиції ${node.fen}`);
                return;
            }

            if (isStudentMove && child.correct === null) {
                // Хід студента не помічений як гарний чи поганий
                // можна попередити, але не помилка
            }

            // Рекурсивно перевіряємо далі
            errors.push(...validateTree(child, !isStudentMove));
        });

        return errors;
    },

    fromJSON(data) {
        Logger.log('Import.fromJSON()');

        const root = Import._mkRoot(data.start_pos);

        if (data.root) {
            const roots = Array.isArray(data.root) ? data.root : [data.root];
            roots.forEach(r => root.variations.push(Import._buildNode(r, root)));
        }

        if (data.comment) root.comment = data.comment;
        if (data.hint) root.hint = data.hint;

        const lessonName = data.name || 'Урок';

        document.getElementById('app-title').textContent = lessonName;

        S.lesson = {
            name: lessonName,
            student: data.student,
            startFen: data.start_pos,
            rootNode: root
        };
        S.flipped = (data.student === 'b');
    }
};

/* ══════════════════════════════════════════════════════
   BOARD
══════════════════════════════════════════════════════ */

const Board = {

    render() {
        Logger.log('Board.render()');

        const el = document.getElementById('board');
        el.innerHTML = '';

        const ch = S.chess;
        const sel = S.selSq;
        const fl = S.flipped;
        const files = 'abcdefgh';

        const dests = new Set();
        if (sel) ch.moves({ square: sel, verbose: true }).forEach(m => dests.add(m.to));

        // підсвітка останнього ходу
        const lmFrom = S.lastMove?.slice(0, 2) ?? null;
        const lmTo = S.lastMove?.slice(2, 4) ?? null;

        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const fi = fl ? 7 - col : col;
                const ri = fl ? row : 7 - row;
                const sq = files[fi] + (ri + 1);
                const lite = (fi + ri) % 2 === 1;

                const div = document.createElement('div');
                div.className = 'sq';
                div.dataset.sq = sq;

                if (lite) div.classList.add('lt');
                else div.classList.add('dk');

                // відмітити клітинки зробленого ходу
                if (sq == lmFrom) div.classList.add('lm-from');
                if (sq == lmTo) div.classList.add('lm-to');

                // відмітити вибране поле
                if (sq === sel) div.classList.add('sel');

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

                const piece = ch.get(sq);
                if (piece) {
                    const p = document.createElement('img');
                    p.className = 'piece';
                    p.src = `https://chessboardjs.com/img/chesspieces/wikipedia/${piece.color}${piece.type.toUpperCase()}.png`;
                    p.draggable = false;

                    // Тільки студент може ходити
                    if (piece.color === S.lesson?.student && piece.color === ch.turn()) {
                        p.style.pointerEvents = 'auto';
                        p.addEventListener('mousedown', e => {
                            if (e.button !== 0) return;
                            e.preventDefault();
                            Drag.mousedown(sq, p, e);
                        });
                    } else {
                        p.style.pointerEvents = 'none';
                    }

                    div.appendChild(p);

                    if (dests.has(sq)) {
                        const ring = document.createElement('div');
                        ring.className = 'mv-ring';
                        div.appendChild(ring);
                    }
                } else if (dests.has(sq)) {
                    const dot = document.createElement('div');
                    dot.className = 'mv-dot';
                    div.appendChild(dot);
                }

                div.addEventListener('click', () => Board.click(sq));
                el.appendChild(div);
            }
        }
    },

    /**
     * Викликається по кліку по полю і коли Drag завершено (користувач відпустив фігуру)
     */
    click(sq) {
        Logger.log('Board.click()');

        // урок не завантажено
        // if (!S.lesson?.rootNode?.variations?.length) return;
        if (Utils.isBlocked) return;

        const ch = S.chess;

        // Хід тільки якщо зараз черга студента
        // if (ch.turn() !== S.lesson?.student) return;

        // if (!Game.currentNode?.variations?.length) return; // завершено

        const sel = S.selSq;
        if (!sel) {
            const p = ch.get(sq);
            if (p && p.color === ch.turn()) { S.selSq = sq; Board.render(); }
            return;
        }

        if (sel === sq) { S.selSq = null; Board.render(); return; }

        const moves = ch.moves({ square: sel, verbose: true });
        const m = moves.find(x => x.to === sq);

        if (m) {
            S.selSq = null;
            if (m.flags.includes('p')) {
                S.pendMv = { from: sel, to: sq };
                UI.showPromo(ch.turn());
            } else {
                Board.handleStudentMove(sel, sq, null);
            }
            return;
        }

        const p = ch.get(sq);
        S.selSq = (p && p.color === ch.turn()) ? sq : null;

        Board.render();
    },

    /**
     * Студент виконав хід
     */
    handleStudentMove(from, to, promo) {
        Logger.log('Board.handleStudentMove()');

        const ch = S.chess;
        const res = ch.move({ from, to, promotion: promo || undefined });
        if (!res) return; // неможливий хід

        S.flags.reset();

        S.stats.attempts ||= 1;

        // Шукаємо хід в дереві
        const par = S.cur || S.lesson.rootNode;
        const uci = from + to + (promo ?? '');
        const node = par.variations.find(v => v.move === uci);

        if (node) {
            S.cur = node;
            Game.onStudentMove(node);
        } else { // непередбачений хід
            // створюємо ноду-заглушку, для того, щоб коректно відпрацювала функція відміни ходу
            S.cur = Utils.mkNode(par, uci, res.san, ch.fen());
            Game.onStudentUnexpectedMove();
        }

        Board.render();
        Panel.update();
    }
};

/* ══════════════════════════════════════════════════════
   DRAG - Перетягування фігур
══════════════════════════════════════════════════════ */

const Drag = {
    active: false,
    pending: null,
    fromSq: null,
    ghost: null,
    THRESHOLD: 6,
    _hoveredSq: null,

    _highlightHover(sq) {
        if (Drag._hoveredSq && Drag._hoveredSq !== Drag.fromSq) {
            const prev = document.querySelector(`[data-sq="${Drag._hoveredSq}"]`);
            if (prev) prev.style.background = '';
        }
        Drag._hoveredSq = sq;
        if (sq && sq !== Drag.fromSq) {
            const el = document.querySelector(`[data-sq="${sq}"]`);
            if (el) {
                const fi = 'abcdefgh'.indexOf(sq[0]);
                const ri = parseInt(sq[1]) - 1;
                el.style.background = (fi + ri) % 2 === 1 ? '#cdd26a' : '#aaa23a';
            }
        }
    },

    mousedown(sq, imgEl, e) {
        if (e.button !== 0) return;

        // урок не завантажено
        // if (!S.lesson?.rootNode?.variations?.length) return;
        if (Utils.isBlocked) return;

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
        Drag._highlightHover(Drag.sqFromPoint(e.clientX, e.clientY));
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
        Drag.active = true;
        Drag.fromSq = sq;
        S.selSq = sq;
        Board.render();
        const size = wrap.getBoundingClientRect().width / 8;
        const g = document.createElement('img');
        g.src = imgEl.src;
        g.style.cssText = `position:fixed;pointer-events:none;z-index:999;
      width:${size}px;height:${size}px;transform:translate(-50%,-50%);
      opacity:.92;filter:drop-shadow(0 4px 8px rgba(0,0,0,.5));`;
        document.body.appendChild(g);
        Drag.ghost = g;
        g.style.left = e.clientX + 'px';
        g.style.top = e.clientY + 'px';
    },

    sqFromPoint(x, y) {
        const board = document.getElementById('board');
        const rect = board.getBoundingClientRect();
        const col = Math.floor((x - rect.left) / (rect.width / 8));
        const row = Math.floor((y - rect.top) / (rect.height / 8));
        if (col < 0 || col > 7 || row < 0 || row > 7) return null;
        const fi = S.flipped ? 7 - col : col;
        const ri = S.flipped ? row : 7 - row;
        return 'abcdefgh'[fi] + (ri + 1);
    },

    init() {
        document.addEventListener('mousemove', e => Drag.move(e));
        document.addEventListener('mouseup', e => Drag.end(e));
    }
};

Drag.init();

/* ══════════════════════════════════════════════════════
   GAME — логіка тренування
══════════════════════════════════════════════════════ */

const Game = {

    /**
     * Спочатку
     */
    restart() {
        Logger.log('Game.restart()');

        const lesson = S.lesson;
        if (!lesson) return;

        S.cur = null;
        S.chess = new Chess(lesson.startFen);
        S.selSq = null;

        S.stats.attempts++;
        S.varStats.mistakes = S.stats.mistakes;
        S.flags.reset();

        const startMessage = lesson.rootNode.comment || '';
        Panel.setMessage(startMessage);

        Panel.hideHint();

        // Якщо першим йде хід опонента і присутнє стартове повідомлення,
        // то студент повинен прочитати стартове повідомлення і
        // настиснути [Продовжити].
        // Інакше - просто виконати хід опонента.

        if (!S.hasNext) {
            Panel.setMessage("Урок не містить ходів опонента.\nПеревірте файл уроку.", "error");
        } else {
            const isOpponentTurn = !S.isStudentTurn;
            if (isOpponentTurn) {
                if (startMessage) S.flags.set(Flags.AWAITING_CONTINUE);
                else setTimeout(() => Game.opponentMove(), 400);
            }
        }

        Board.render();
        Panel.update();
    },

    resetStats() {
        if (!confirm('Скинути всю статистику?')) return;
        S.stats = { attempts: 0, success: 0, hints: 0, mistakes: 0 };
        S.varStats = {};
        Panel.updateStats();
    },

    /**
     * Завантажити файл з вправами
     */
    load() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = e => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = ev => {
                let data = null;
                try {
                    data = JSON.parse(ev.target.result);
                } catch (err) {
                    Panel.setMessage(`⚠ Неможливо завантажити файл '${file.name}'.\nНевалідний JSON.\n\n${err.message}`, 'error');
                    return;
                }
                console.log(data);
                try {
                    // todo: невалідний JSON
                    // а тут вже читабельні помилки:

                    if (!data.start_pos) throw new Error('Відсутнє поле start_pos');
                    if (!data.student) throw new Error('Відсутнє поле student');

                    S.varStats = {};
                    S.stats = { attempts: 0, success: 0, hints: 0, mistakes: 0 };

                    Import.fromJSON(data);
                    Game.restart();
                } catch (err) {
                    Panel.setMessage(`⚠ Помилка завантаження файлу.\n${err.message}`, 'error');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    },

    /**
     * Коли студент робить хід, передбачений послідовністю
     */
    onStudentMove(node) {
        Logger.log('Game.onStudentMove()');

        const hasNext = S.hasNext;
        const hasComment = !!node.comment?.trim();
        const isGoodMove = node.correct === true;
        const isBadMove = node.correct === false;

        //Toolbar.hideActions();

        if (!isBadMove) {
            S.hintUsed = false;
            Panel.hideHint();
        }

        if (isGoodMove) {
            // message = '✓ Правильний хід.';
            S.flags.set(Flags.GOOD_MOVE);
        } else if (isBadMove) {
            S.stats.mistakes++;
            // message = '✗ Цей хід вважається поганим.';
            S.flags.set(Flags.BAD_MOVE);
        } else if (hasNext && !hasComment) {
            setTimeout(() => Game.opponentMove(), 500);
            return;
        }

        if (!isBadMove && !hasNext) {
            this.sequenceFinished(node);
            return;
        }

        if (hasComment || isBadMove || isGoodMove) {
            const parts = [node.comment, this.getMoveResultText(node)].filter(s => s?.trim());
            const message = parts.join('\n\n');
            Panel.setMessage(message, isBadMove ? 'error' : isGoodMove ? 'success' : 'neutral');

            if (hasNext) S.flags.set(Flags.AWAITING_CONTINUE);
        }


        // Toolbar.showActions(showContinue, showUndo);
        // if (hasNext) Toolbar.setContinueVisible();


        // if (isBadMove) {
        //     S.stats.attempts++;
        //     VarStats.addMistake(node);
        //     VarStats.addAttempt(node);
        //     Panel.updateStats();


        //     // Коментар вчителя
        //     const msg = (node.comment ? node.comment + '\n' : '') + '⚠️ Цей хід вважається поганим.';
        //     Panel.setMessage(msg, 'error');

        //     // Якщо є продовження - показуємо кнопку "Продовжити"

        //     Panel.showActions(hasNext);

        //     return;
        // }

        // Panel.setMessage(node.comment || '', 'neutral');

        // // Кінець варіанту
        // if (!node.variations.length) {
        //     S.stats.attempts++;
        //     S.stats.success++;

        //     VarStats.addAttempt(node);
        //     VarStats.addSuccess(node);
        //     Panel.updateStats();


        //    
        //     Panel.setMessage((node.comment ? node.comment + '\n' : '') + '✓ Чудово! Варіант пройдено.', 'success');

        //     // Показати тільки кнопку "Спочатку"
        //     Panel.showActions(false, false);

        //     return;
        // }

        // setTimeout(() => Game.opponentMove(), 500);
    },

    /**
     * Хід студента, який не було передбачено
     */
    onStudentUnexpectedMove() {
        Logger.log('Game.onStudentUnexpectedMove()');

        // У нас нема повідомлення від вчителя, тому показуємо стандартну помилку
        Panel.setMessage('✗ Цей хід не було передбачено. Спробуйте ще раз.', 'error');

        // Збільшуємо лічильник спроб та лічильник помилок для поточної позиції
        S.stats.mistakes++;
        VarStats.addMistake(S.cur || S.lesson.rootNode.variations[0]);
        Panel.updateStats();

        S.flags.set(Flags.UNEXPECTED_MOVE);
        Toolbar.update();

        // Toolbar.setUndoVisible();
        // Toolbar.setHintVisible(false);

        // setTimeout(() => {
        //     S.chess.undo();
        //     S.lastMove = null;
        //     S.cur = S.cur?.parent ?? null;
        //     Board.render();
        //     Panel.update();
        // }, 800);
    },

    /**
     * Автоматичний хід опонента.
     * 
     * Випадково обирається один з варіантів продовження на основі вагів, 
     * які формуються по результатам тренувань.
     * 
     * @param {*} [move=null] Конкретний хід
     */
    opponentMove(move = null) {
        Logger.log('Game.opponentMove()');

        let pick = move;
        if (!pick) {
            const par = S.currentNode;
            const variations = par.variations;
            if (!variations) return;  // очікується, що завжди буде > 0, але захист на всяк випадок

            const candidates = par.variations.filter(v => v.correct !== false);
            const pool = candidates.length ? candidates : variations;
            pick = VarStats.pickVariation(pool);
        }

        const res = S.chess.move({
            from: pick.move.slice(0, 2),
            to: pick.move.slice(2, 4),
            promotion: pick.move[4] || undefined
        });
        // неможливий хід
        if (!res) {
            Panel.setMessage(`⚠ Помилка.\nНеможливо виконати хід опонента: '${pick.move}'.\nПеревірте файл уроку.`, 'error');
            // console.log('неможливий хід опонента', pick.move);

            // const Toast = {
            //     show(msg, type = 'error') {
            //       const el = document.createElement('div');
            //       el.className = `toast toast-${type}`;
            //       el.textContent = msg;
            //       document.body.appendChild(el);
            //       setTimeout(() => el.remove(), 3000);
            //     }
            //   };

            //   Toast.show(`Неможливо виконати хід опонента: '${pick.move}'. Перевірте файл уроку.`);
            // //   Toast.show('Урок завантажено', 'error');

            return;
        }

        S.cur = pick;

        // Toolbar.setBackVisible(true);

        // послідовність завершено після ходу опонента
        const sequenceFinished = !pick.variations.length;
        if (sequenceFinished) {
            this.sequenceFinished(pick);
        } else {
            Panel.setMessage(S.currentNode.comment ?? '');
        }

        Board.render();
        Panel.update();
    },

    sequenceFinished(node) {
        if (S.varStats.mistakes === S.stats.mistakes) {
            S.varStats.mistakes = null;
            S.stats.success++;
            // todo: виводити кількість помилок та підказок для поточної гри
        }

        VarStats.addAttempt(node);
        VarStats.addSuccess(node);

        // const finishMsg = '✓ Послідовність завершено.';
        // let message = node.comment ?? '';
        // if (message) message += '\n\n';
        // message += finishMsg;

        // if (node.comment) message += `\n\n${node.comment}`;

        const finishText = '✓ Послідовність завершено.';
        const parts = [node.comment, this.getMoveResultText(node), finishText].filter(s => s?.trim());
        Panel.setMessage(parts.join('\n\n'), 'success');
    },

    getMoveResultText(node) {
        if (node.correct === false) return '✗ Цей хід вважається поганим.';
        if (node.correct === true) return '✓ Правильний хід.';
        return '';
    },

    /**
     * Гра на паузі з будь-яких причин, далі має ходити опонент.
     * Студент натис [Продовжити].
     * @see #act-continue
     */
    continueOpponentMove() {
        Logger.log('Game.continueOpponentMove()');
        // Toolbar.hideActions();
        // Toolbar.beforeOpponentMove();
        // Toolbar.setContinueVisible(false);
        Panel.hideHint();
        S.flags.reset();
        Toolbar.update();
        setTimeout(() => Game.opponentMove(), 400);
    },

    /**
     * Студент зробив помилковий хід.
     * Студент натиснув [Відмінити] хід.
     * @see #act-undo
     */
    undoMove() {
        Logger.log('Game.undoMove()');
        //Toolbar.hideActions();

        S.chess.undo();
        S.cur = S.cur?.parent ?? null;
        S.flags.reset();

        const node = S.currentNode;
        Panel.setMessage(node.comment ?? '');

        Board.render();
        Panel.update();
    },

    /**
     * Повторити хід опонента:
     * - тільки під час ходу студента
     * - зберегти поточний стан
     * - відмінити останній хід
     * - по таймауту відтворити збережений стан
     */
    back() {
        Logger.log('Game.back()');

        if (!S.isStudentTurn) return;

        const move = S.cur;
        this.undoMove();
        setTimeout(() => Game.opponentMove(move), 600);
    }
};

/* ══════════════════════════════════════════════════════
   STATS - Функції для роботи зі статистикою варіантів
══════════════════════════════════════════════════════ */

const VarStats = {

    // Ключ варіанту — SAN першого ходу від кореня
    keyFor(node) {
        // Піднімаємось до першого рівня від rootNode
        let n = node;
        while (n.parent && n.parent !== S.lesson.rootNode && n.parent.parent) {
            n = n.parent;
        }
        return n.san || n.move;
    },

    get(key) {
        if (!S.varStats[key]) S.varStats[key] = { attempts: 0, mistakes: 0, success: 0 };
        return S.varStats[key];
    },

    addAttempt(node) {
        VarStats.get(VarStats.keyFor(node)).attempts++;
    },

    addMistake(node) {
        VarStats.get(VarStats.keyFor(node)).mistakes++;
    },

    addSuccess(node) {
        VarStats.get(VarStats.keyFor(node)).success++;
    },

    // Вибір варіанту з вагою на провалені
    pickVariation(variations) {
        if (!variations.length) return null;
        if (variations.length === 1) return variations[0];

        // Рахуємо вагу: більше помилок = більша вага
        const weights = variations.map(v => {
            const key = v.san || v.move;
            const stats = S.varStats[key];
            const mistakes = stats?.mistakes || 0;
            return 1 + mistakes * 2;  // базова вага 1 + бонус за помилки
        });

        const total = weights.reduce((a, b) => a + b, 0);
        let rand = Math.random() * total;
        for (let i = 0; i < variations.length; i++) {
            rand -= weights[i];
            if (rand <= 0) return variations[i];
        }
        return variations[variations.length - 1];
    }
};

/* ══════════════════════════════════════════════════════
   PANEL
══════════════════════════════════════════════════════ */

const Panel = {

    /**
     * Вивести FEN-строку в поле.
     * @param {string} value FEN
     */
    set fen(value) { document.getElementById('fen-out').value = value; },

    get resetStatsBtn() { return document.getElementById('reset-stats-btn'); },

    /**
     * Вивести інформацію чий зараз хід.
     * @param {string} textContent
     */
    set turnInfo(textContent) { document.getElementById('turn-info').textContent = textContent; },

    /**
     * Виводить FEN.
     * Виводить інформацію чий хід.
     * Оновлює таблицю статистики.
     */
    update() {
        Logger.log('Panel.update()');

        const ch = S.chess;

        // FEN
        this.fen = ch.fen();

        if (!S.lesson) return;

        const turn = ch.turn();
        const isStudentTurn = S.isStudentTurn;

        // Чий хід
        this.turnInfo = `Хід: ${turn === 'w' ? '♔ Білі' : '♚ Чорні'} · ${isStudentTurn ? '🎓 Ваш хід' : '🤖 Суперник'}`;

        // const node = S.currentNode;
        // const hasNext = node.variations.length > 0;
        // const hasNext = S.hasNext;

        // Toolbar.setRestartVisible(!!S.lesson);
        // if (hasNext) Toolbar.setHintVisible(isStudentTurn && hasNext);
        // Toolbar.setBackVisible(isStudentTurn);

        Toolbar.update();
        this.resetStatsBtn.style.display = '';
        Panel.updateStats();
    },

    /**
     * Відобразити текст коментаря вчителя з відповідним стилем.
     * 
     * @param {string} text Текст коментаря
     * @param {string} state Стиль поля: {'success', 'error', other}
     */
    setMessage(text, state = 'neutral') {
        Logger.log('Panel.setMessage();', `text = ${text};`, `state = ${state};`);

        const commentOut = document.getElementById('comment-out');

        commentOut.value = text;

        // Підсвітка рамки залежно від стану
        // commentOut.style.borderColor =
        //     state === 'success' ? 'var(--green)' :
        //         state === 'error' ? 'var(--red)' : '';

        commentOut.className = 'text-out';

        if (state == 'error') commentOut.classList.add('message-error');
        else if (state == 'success') commentOut.classList.add('message-success');
    },

    // /**
    //  * Показати кнопки тулбару
    //  * 
    //  * @param {bool} showRestart Спочатку
    //  * @param {bool} showResetStats Очистити статистику
    //  * @param {bool} showHint Підказка {default=false}
    //  */
    // showToolbar(showRestart, showResetStats, showHint = false) {
    //     Logger.log('Panel.showToolbar();', `showRestart = ${showRestart};`, `showResetStats = ${showResetStats};`, `showHint = ${showHint};`);
    //     document.getElementById('restart-btn').style.display = showRestart ? '' : 'none';
    //     document.getElementById('reset-stats-btn').style.display = showResetStats ? '' : 'none';
    //     document.getElementById('hint-btn').style.display = showHint ? '' : 'none';
    // },

    /**
     * Показати чи сховати панель підказки
     * 
     * @param {boolean} isVisible Режим відображення
     */
    // hintSetVisible(isVisible = true) {
    //     const hasHintText = document.getElementById('hint-out').value !== '';
    //     Logger.log('hintSetVisible', isVisible, hasHintText);
    //     document.getElementById('hint-card').style.display = isVisible && hasHintText ? '' : 'none';
    // },

    /**
     * Показати текст підказки
     * @param {string} text Текст підказки
     */
    showHint(text) {
        Logger.log('Panel.showHint()', text !== '');
        if (!text) return;
        document.getElementById('hint-out').value = text;
        document.getElementById('hint-card').style.display = '';
    },

    /**
     * Сховати блок підказки
     */
    hideHint() {
        Logger.log('Panel.hideHint()');
        HintArrows.clear();
        document.getElementById('hint-card').style.display = 'none';
        document.getElementById('hint-out').value = '';
    },

    updateStats() {
        Logger.log('Panel.updateStats()');

        const { attempts, success, hints, mistakes } = S.stats;
        // const mistakes = attempts - success;

        document.getElementById('sc-attempts').textContent = attempts;
        document.getElementById('sc-success').textContent = success;
        document.getElementById('sc-hints').textContent = hints;
        document.getElementById('sc-mistakes').textContent = mistakes;

        document.getElementById('sc-pct').textContent =
            attempts > 0 ? Math.round(success / attempts * 100) + '%' : '—';

        // Таблиця варіантів — рядок на кожен варіант першого рівня
        const tbody = document.getElementById('stats-body');
        tbody.innerHTML = '';

        const roots = S.lesson?.rootNode?.variations ?? [];
        roots.forEach((v, i) => {
            const key = v.san || v.move;
            const st = S.varStats[key] || { attempts: 0, mistakes: 0, success: 0 };
            const tr = document.createElement('tr');
            tr.innerHTML = `
            <td>${i + 1}</td>
            <td class="num">${st.attempts}</td>
            <td class="num ${st.mistakes ? 'err' : ''}">${st.mistakes}</td>
            <td class="num ${st.success ? 'succ' : ''}">${st.success}</td>
          `;
            tbody.appendChild(tr);
        });
    },
};

/* ══════════════════════════════════════════════════════
   TOOLBAR
══════════════════════════════════════════════════════ */

const Toolbar = {

    get restartBtn() { return document.getElementById('restart-btn'); },
    get continueBtn() { return document.getElementById('act-continue'); },
    get undoBtn() { return document.getElementById('act-undo'); },
    get hintBtn() { return document.getElementById('hint-btn'); },

    /**
     * Повторити хід опонента
     */
    get backBtn() { return document.getElementById('act-back'); },

    setVisible(btn, visible = true) {
        btn.style.display = visible ? '' : 'none';
    },

    /**
     * Показати/сховати кнопку Спочатку
     * @param {boolean} [visible=true]
     */
    setRestartVisible(visible = true) {
        this.setVisible(this.restartBtn, visible);
    },

    /**
     * Показати/сховати кнопку Продовжити
     * @param {boolean} [visible=true]
     */
    setContinueVisible(visible = true) {
        this.setVisible(this.continueBtn, visible);
    },

    /**
     * Показати/сховати кнопку Повернутися
     * @param {boolean} [visible=true]
     */
    setUndoVisible(visible = true) {
        this.setVisible(this.undoBtn, visible);
    },

    /**
     * Показати/сховати кнопку підказки
     * @param {boolean} [visible=true]
     */
    setHintVisible(visible = true) {
        this.setVisible(this.hintBtn, visible);
    },

    /**
     * Показати/сховати кнопку "Повторити хід опонента"
     * @param {boolean} [visible=true]
     */
    setBackVisible(visible = true) {
        this.setVisible(this.backBtn, visible);
    },

    /**
     * Сховати кнопки "Продовжити, Відмінити, Підказка"
     */
    // hideActions() {
    //     Logger.log('Toolbar.hideActions()');

    //     // this.setContinueVisible(false);
    //     this.setUndoVisible(false);
    //     this.setHintVisible(false);
    //     this.setBackVisible(false);
    // },

    update() {
        Logger.log('Toolbar.update():', `S.flags = ${S.flags.value.toString(2)};`);
        /*
        restart
        continue
        undo
        back
        hint
        */


        // this.setUndoVisible([GameState.BAD_MOVE, GameState.UNEXPECTED_MOVE].includes(S.gameState));
        /*
        відмінити:
        - студент зробив хід, зараз хід опонента
        - хід був помилковим, або не передбаченим
        */

        let isRestartVisible = false;
        const isContinueVisible = S.flags.has(Flags.AWAITING_CONTINUE);
        let isBackVisible = false;
        let isUndoVisible = false;
        let isHintVisible = false;

        const isGameStarted = S.currentNode !== S.rootNode;
        if (S.isLessonLoaded) {
            isRestartVisible = true;

            if (isGameStarted) {
                const isOpponentMoved = S.isStudentTurn;
                isBackVisible = isOpponentMoved;

                const isStudentMoved = !isOpponentMoved;
                isUndoVisible = isStudentMoved && S.flags.has(Flags.BAD_MOVE | Flags.UNEXPECTED_MOVE);
            }

            isHintVisible = S.isStudentTurn && S.hasNext;
        }

        this.setRestartVisible(isRestartVisible);
        this.setContinueVisible(isContinueVisible);
        this.setBackVisible(isBackVisible);
        this.setUndoVisible(isUndoVisible);
        this.setHintVisible(isHintVisible);
    },


    // /**
    //  * Показати панель з кнопками "Продовжити, Відмінити.
    //  * 
    //  * Якщо усі кнопки вимкнено - панель не буде показано.
    //  * 
    //  * @param {boolean} showContinue "Продовжити"
    //  * @param {boolean} showUndo "Відмінити" {default=false}
    //  */
    // showActions(showContinue, showUndo = false) {
    //     Logger.log('Panel.showActions(); ',
    //         `showContinue = ${showContinue};`,
    //         `showUndo = ${showUndo};`
    //     );
    //     // if (!showContinue && !showUndo && !showRestart) return;

    //     // document.getElementById('action-bar').style.display = '';
    //     //
    //     document.getElementById('act-continue').style.display = showContinue ? '' : 'none';
    //     document.getElementById('act-undo').style.display = showUndo ? '' : 'none';
    //     // document.getElementById('act-restart').style.display = showRestart ? '' : 'none';
    // },
}

/* ══════════════════════════════════════════════════════
   UI - дії користувача зі зміни в інтерфейсі
══════════════════════════════════════════════════════ */

const UI = {

    /**
     * Показати модальне вікно для вибору фігури перетворення пішака.
     * 
     * @param {char} color 
     */
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
                if (S.pendMv) { Board.handleStudentMove(S.pendMv.from, S.pendMv.to, p); S.pendMv = null; }
            };
            row.appendChild(img);
        }
        UI.openModal('promo-modal');
    },

    /**
     * Показати підказку:
     * - текст (якщо є)
     * - підсвічує наступні ходи (нейтральні та правильні)
     * 
     * @see #hint-btn
     */
    showHint() {
        Logger.log('UI.showHint();', `Game.isStudentTurn() = ${S.isStudentTurn};`);

        if (!S.isStudentTurn) return;

        const node = S.currentNode;
        const variations = node.variations;

        Logger.log(`node = ${node}`);

        if (!variations.length) return; // кінець, нема чого показувати

        if (!S.hintUsed) {
            S.stats.hints++;
            S.hintUsed = true;
        }
        Panel.showHint(node.hint);
        Panel.updateStats();

        // підказуємо ходи крім поганих, якщо тільки погані - показуємо їх
        // const candidates = variations.filter(v => v.correct !== false);
        // const hintMoves = candidates.length ? candidates : variations;

        const candidates = variations.filter(v => v.correct !== false);
        const hints = candidates.length ? candidates : variations;

        // Підсвічуємо клітинки
        // hintMoves.forEach(v => {
        //     const from = v.move.slice(0, 2);
        //     const to = v.move.slice(2, 4);
        //     $(`[data-sq="${from}"]`).css('box-shadow', 'inset 0 0 0 4px rgba(100,200,255,0.7)');
        //     $(`[data-sq="${to}"]`).css('box-shadow', 'inset 0 0 0 4px rgba(100,200,255,0.35)');
        // });
        HintArrows.draw(hints);

        // Знімаємо підсвітку через 2.5 секунди
        // setTimeout(() => {
        //     // hintMoves.forEach(v => {
        //     //     $(`[data-sq="${v.move.slice(0, 2)}"]`).css('box-shadow', '');
        //     //     $(`[data-sq="${v.move.slice(2, 4)}"]`).css('box-shadow', '');
        //     // });
        //     // Board.render();
        //     HintArrows.clear();
        // }, 2500);
    },

    openModal(id) { document.getElementById(id).classList.add('open'); },
    closeModal(id) { document.getElementById(id).classList.remove('open'); },

    /**
     * Скопіювати вміст поля в буфер обміну.
     * 
     * @param {*} fieldId Поле з якого копіювати
     * @param {*} btn Кнопка на яку натиснули
     */
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
    }
};

const HintArrows = {

    _timeout: null,

    sqCenter(sq) {
        const files = 'abcdefgh';
        const fi = files.indexOf(sq[0]);
        const ri = parseInt(sq[1]) - 1;
        const col = S.flipped ? 7 - fi : fi;
        const row = S.flipped ? ri : 7 - ri;
        const size = 480 / 8;
        return {
            x: col * size + size / 2,
            y: row * size + size / 2,
        };
    },

    draw(moves) {
        this.clear();

        const svg = document.getElementById('arrow-svg');

        moves.forEach(v => {
            const from = v.move.slice(0, 2);
            const to = v.move.slice(2, 4);
            const a = this.sqCenter(from);
            const b = this.sqCenter(to);

            const dx = b.x - a.x, dy = b.y - a.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            const ux = dx / len, uy = dy / len;
            const nx = -uy, ny = ux;

            const bodyW = 9, headW = 18, headL = 22, tail = 6;

            const sx = a.x + ux * tail;
            const sy = a.y + uy * tail;
            const hx = b.x - ux * headL;
            const hy = b.y - uy * headL;

            const pts = [
                [sx + nx * bodyW, sy + ny * bodyW],
                [hx + nx * bodyW, hy + ny * bodyW],
                [hx + nx * headW, hy + ny * headW],
                [b.x, b.y],
                [hx - nx * headW, hy - ny * headW],
                [hx - nx * bodyW, hy - ny * bodyW],
                [sx - nx * bodyW, sy - ny * bodyW],
            ].map(([x, y]) => `${x},${y}`).join(' ');

            const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            arrow.setAttribute('points', pts);
            arrow.setAttribute('fill', 'rgba(100,200,255,0.75)');
            arrow.setAttribute('class', 'hint-arrow');
            svg.appendChild(arrow);
        });

        // Автоматично ховаємо через 2.5 секунди
        this._timeout = setTimeout(() => this.clear(), 2500);
    },

    clear() {
        if (this._timeout) { clearTimeout(this._timeout); this._timeout = null; }
        document.querySelectorAll('.hint-arrow').forEach(e => e.remove());
    }
};