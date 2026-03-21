'use strict';

const ChessBoard = (() => {

    let _opts = {
        elementId: 'board',
        flipped: false,
        squareSize: 60,
        onMove: null,        // callback(from, to, promo) — викликається коли зроблено хід
        canMove: null,       // callback(color) → bool — чи може гравець цього кольору ходити
        chess: null,         // chess.js instance
    };

    let _selSq = null;
    let _pendMv = null;

    // ── Drag ──────────────────────────────────────
    const Drag = {
        active: false,
        pending: null,
        fromSq: null,
        ghost: null,
        THRESHOLD: 6,
        _hoveredSq: null,

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
            Drag._highlightHover(Drag.sqFromPoint(e.clientX, e.clientY));
        },

        end(e) {
            if (Drag.pending) {
                const { sq } = Drag.pending;
                Drag.pending = null;
                _click(sq);
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
            _selSq = null;
            if (toSq && toSq !== fromSq) {
                _selSq = fromSq;
                _click(toSq);
            } else {
                render();
            }
        },

        _start(sq, imgEl, e) {
            const wrap = document.getElementById(_opts.elementId).parentElement;
            Drag.active = true;
            Drag.fromSq = sq;
            _selSq = sq;
            render();
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

        sqFromPoint(x, y) {
            const board = document.getElementById(_opts.elementId);
            const rect = board.getBoundingClientRect();
            const col = Math.floor((x - rect.left) / (rect.width / 8));
            const row = Math.floor((y - rect.top) / (rect.height / 8));
            if (col < 0 || col > 7 || row < 0 || row > 7) return null;
            const fi = _opts.flipped ? 7 - col : col;
            const ri = _opts.flipped ? row : 7 - row;
            return 'abcdefgh'[fi] + (ri + 1);
        }
    };

    document.addEventListener('mousemove', e => Drag.move(e));
    document.addEventListener('mouseup', e => Drag.end(e));

    // ── Click logic ───────────────────────────────
    function _click(sq) {
        const ch = _opts.chess;
        const sel = _selSq;

        if (!sel) {
            const p = ch.get(sq);
            const canMove = _opts.canMove ? _opts.canMove(p?.color) : true;
            if (p && canMove) { _selSq = sq; render(); }
            return;
        }

        if (sel === sq) { _selSq = null; render(); return; }

        const moves = ch.moves({ square: sel, verbose: true });
        const m = moves.find(x => x.to === sq);

        if (m) {
            _selSq = null;
            if (m.flags.includes('p')) {
                _pendMv = { from: sel, to: sq };
                _showPromo(ch.turn());
            } else {
                _doMove(sel, sq, null);
            }
            return;
        }

        const p = ch.get(sq);
        const canMove = _opts.canMove ? _opts.canMove(p?.color) : true;
        _selSq = (p && canMove) ? sq : null;
        render();
    }

    function _doMove(from, to, promo) {
        if (_opts.onMove) _opts.onMove(from, to, promo);
    }

    // ── Promotion ────────────────────────────────
    function _showPromo(color) {
        const pieces = ['q', 'r', 'b', 'n'];
        let modal = document.getElementById('_promo-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = '_promo-modal';
            modal.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.7);
        z-index:1000;display:flex;align-items:center;justify-content:center;`;
            document.body.appendChild(modal);
        }
        modal.innerHTML = '';
        const box = document.createElement('div');
        box.style.cssText = `background:#2a2d47;border-radius:9px;padding:20px;
      display:flex;gap:12px;`;
        for (const p of pieces) {
            const img = document.createElement('img');
            img.src = `https://chessboardjs.com/img/chesspieces/wikipedia/${color}${p.toUpperCase()}.png`;
            img.style.cssText = 'width:64px;height:64px;cursor:pointer;padding:6px;border-radius:6px;border:2px solid transparent;';
            img.onmouseover = () => img.style.borderColor = '#d4a843';
            img.onmouseout = () => img.style.borderColor = 'transparent';
            img.onclick = () => {
                modal.remove();
                if (_pendMv) { _doMove(_pendMv.from, _pendMv.to, p); _pendMv = null; }
            };
            box.appendChild(img);
        }
        modal.appendChild(box);
    }

    // ── Render ────────────────────────────────────
    function render(lastMove) {
        const el = document.getElementById(_opts.elementId);
        el.innerHTML = '';
        const ch = _opts.chess;
        const fl = _opts.flipped;
        const sel = _selSq;
        const files = 'abcdefgh';

        const dests = new Set();
        if (sel) ch.moves({ square: sel, verbose: true }).forEach(m => dests.add(m.to));

        const lmFrom = lastMove?.slice(0, 2) ?? null;
        const lmTo = lastMove?.slice(2, 4) ?? null;

        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const fi = fl ? 7 - col : col;
                const ri = fl ? row : 7 - row;
                const sq = files[fi] + (ri + 1);
                const lite = (fi + ri) % 2 === 1;

                const div = document.createElement('div');
                div.className = 'sq ' + (lite ? 'lt' : 'dk');
                div.dataset.sq = sq;

                if (sq === lmFrom || sq === lmTo)
                    div.style.background = lite ? '#cdd26a' : '#aaa23a';
                if (sq === sel)
                    div.style.background = '#7fc97f';

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
                    const canMove = _opts.canMove ? _opts.canMove(piece.color) : true;
                    if (canMove) {
                        p.style.pointerEvents = 'auto';
                        p.addEventListener('mousedown', e => {
                            if (e.button !== 0) return;
                            if (!(_opts.canMove ? _opts.canMove(piece.color) : true)) return;
                            if (piece.color !== ch.turn()) return;
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

                div.addEventListener('click', () => _click(sq));
                el.appendChild(div);
            }
        }
    }

    // ── Public API ────────────────────────────────
    function init(opts) {
        Object.assign(_opts, opts);
        const el = document.getElementById(_opts.elementId);
        el.style.display = 'grid';
        el.style.gridTemplateColumns = 'repeat(8, 1fr)';
        el.style.aspectRatio = '1';
        render();
    }

    return { init, render };

})();