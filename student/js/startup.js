'use strict';

/* ══════════════════════════════════════════════════════
   CLOSE MODAL ON OVERLAY CLICK
══════════════════════════════════════════════════════ */

document.querySelectorAll('.overlay').forEach(el => {
    el.addEventListener('click', e => { if (e.target === el) UI.closeModal(el.id); });
});

/* ══════════════════════════════════════════════════════
   BOOTSTRAP
══════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
    Logger.log('> startup');
    S.chess = new Chess(INIT_FEN);
    S.flipped = false;
    
    // S.lesson = { name: 'Новий урок', student: 'w', startFen: INIT_FEN, rootNode: mkRoot(INIT_FEN) };

    // document.getElementById('app-title').textContent = S.lesson.name;

    Board.render();
    Panel.update();
    Logger.log('/startup');
    Logger.log(' ');
});