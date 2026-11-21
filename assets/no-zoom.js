/* Stops phones (mostly iOS Safari) from zooming the page while a game is being played.
 * iOS ignores "user-scalable=no" in the viewport tag, so:
 *   - double-tap zoom is turned off with touch-action: manipulation
 *   - pinch zoom is cancelled through Safari's gesture events
 *   - text is never auto-enlarged when the phone is rotated
 * Include it in a game page with  <script src="../assets/no-zoom.js"></script>
 * (iOS also zooms in when a text box with text smaller than 16px is tapped: that one is fixed
 *  in the CSS by giving text boxes 16px text on touch screens.)
 */
(function () {
  'use strict';
  var root = document.documentElement;
  root.style.touchAction = 'manipulation';
  root.style.webkitTextSizeAdjust = '100%';
  root.style.textSizeAdjust = '100%';
  function stop(e) { e.preventDefault(); }
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (name) {
    document.addEventListener(name, stop, { passive: false });
  });
})();
