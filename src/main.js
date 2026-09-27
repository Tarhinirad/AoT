import { Game } from './game/game.js';

const game = new Game(document.getElementById('app'));
game.start();
// Handy for debugging from the console.
window.__skyhook = game;
